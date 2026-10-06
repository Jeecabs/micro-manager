import type { ReviewMessage, ReviewModel, ReviewRequest, ReviewStep, ReviewToolCall, ReviewUsage, ToolSpec } from "./model.ts";

/** One plain completion: a system prompt and one user message in, text out. */
export interface TextCompletionRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export type TextCompletionResult =
  | { ok: true; text: string; usage: ReviewUsage }
  | { ok: false; stop: "error" | "aborted"; error?: string; usage: ReviewUsage };

export type TextCompleter = (request: TextCompletionRequest) => Promise<TextCompletionResult>;

/**
 * A `ReviewModel` for hosts whose model call takes one prompt and returns text, with no
 * history and no native tool calling. The whole private conversation is rendered into the
 * prompt each step, and the reply is one JSON object naming the tool calls.
 */
export function createTextProtocolModel(label: string, complete: TextCompleter): ReviewModel {
  let nextCallId = 0;
  return {
    label,
    async step(request: ReviewRequest): Promise<ReviewStep> {
      const result = await complete({
        system: `${request.system}\n\n${protocolInstructions(request.tools)}`,
        prompt: renderConversation(request.messages),
        maxTokens: request.maxOutputTokens,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      });
      if (!result.ok) {
        const failed: ReviewStep = { text: "", calls: [], usage: result.usage, stop: result.stop };
        if (result.error) failed.error = result.error;
        return failed;
      }
      const calls = (parseProtocolReply(result.text) ?? []).map(
        (call): ReviewToolCall => ({ id: `call-${++nextCallId}`, name: call.tool, arguments: call.args }),
      );
      return { text: result.text, calls, usage: result.usage, stop: calls.length > 0 ? "tool" : "end" };
    },
  };
}

export function protocolInstructions(tools: readonly ToolSpec[]): string {
  const lines = tools.map((tool) => {
    const args = Object.entries(tool.parameters.properties).map(([name, schema]) => {
      const type = schema.enum ? schema.enum.map((value) => JSON.stringify(value)).join(" | ") : schema.type;
      const required = tool.parameters.required.includes(name) ? ", required" : "";
      return `    ${name} (${type}${required}): ${schema.description ?? ""}`.trimEnd();
    });
    return [`- ${tool.name}: ${tool.description}`, ...args].join("\n");
  });
  return `<tool-protocol>
You call tools by replying with JSON. Your entire reply MUST be exactly one JSON object and nothing else: no prose, no markdown fences, no XML.

To call tools: {"calls":[{"tool":"<name>","args":{...}}]}
To stay silent and end this update: {"calls":[]}

Tools:
${lines.join("\n")}

Each call's result arrives in the next message as a <tool-result> element.
</tool-protocol>`;
}

export function renderConversation(messages: readonly ReviewMessage[]): string {
  const parts = messages.map((message) => {
    if (message.role === "user") return `<session-update>\n${escapeText(message.text)}\n</session-update>`;
    if (message.role === "assistant") {
      const calls = message.calls.map((call) => ({ tool: call.name, args: call.arguments }));
      return `<your-reply>\n${JSON.stringify({ calls })}\n</your-reply>`;
    }
    const error = message.isError ? ' error="true"' : "";
    return `<tool-result tool="${escapeText(message.name)}"${error}>\n${escapeText(message.text)}\n</tool-result>`;
  });
  parts.push("Reply now with exactly one JSON object.");
  return parts.join("\n\n");
}

/**
 * Finds the first JSON object in a reply that names tool calls. Models sometimes wrap it
 * in prose or tags, or keep writing after it; everything around the object is ignored.
 * Returns undefined when the reply holds no such object.
 */
export function parseProtocolReply(text: string): Array<{ tool: string; args: Record<string, unknown> }> | undefined {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = matchingBrace(text, start);
    if (end === -1) continue;
    let value: unknown;
    try {
      value = JSON.parse(text.slice(start, end + 1));
    } catch {
      continue;
    }
    const calls = protocolCalls(value);
    if (calls) return calls;
  }
  return undefined;
}

function protocolCalls(value: unknown): Array<{ tool: string; args: Record<string, unknown> }> | undefined {
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.calls)) {
    return value.calls.flatMap((call) =>
      isRecord(call) && typeof call.tool === "string" ? [{ tool: call.tool, args: isRecord(call.args) ? call.args : {} }] : [],
    );
  }
  // Lenient forms a model may fall back to.
  if (typeof value.tool === "string") return [{ tool: value.tool, args: isRecord(value.args) ? value.args : {} }];
  if (isRecord(value.report)) return [{ tool: "report", args: value.report }];
  if (value.done === true) return [];
  return undefined;
}

function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
