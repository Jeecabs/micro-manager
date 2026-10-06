import {
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type ModelsApiStreamOptions,
  type Tool,
  type ToolCall,
  uuidv7,
} from "@earendil-works/pi-ai";
import { clampThinkingLevel } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ReviewMessage, ReviewModel, ReviewRequest, ReviewStep } from "../core/model.ts";
import type { ThinkingLevel } from "../core/types.ts";

export type PiComplete = (
  model: Model<any>,
  context: Context,
  options?: ModelsApiStreamOptions<any>,
) => Promise<AssistantMessage>;

/** Resolves `provider/id`, or a bare id that exactly one provider registers. */
export function resolvePiReviewModel(
  ctx: ExtensionContext,
  selector: string | undefined,
  thinking: ThinkingLevel,
): ReviewModel | undefined {
  const complete: PiComplete = (model, context, options) => ctx.modelRegistry.complete(model, context, options);
  if (selector === undefined) return ctx.model ? createPiReviewModel(ctx.model, thinking, complete) : undefined;
  let model: Model<any> | undefined;
  const slash = selector.indexOf("/");
  if (slash > 0) {
    model = ctx.modelRegistry.find(selector.slice(0, slash), selector.slice(slash + 1));
  } else {
    const matches = ctx.modelRegistry.getAll().filter((candidate) => candidate.id === selector);
    if (matches.length === 1) model = matches[0];
  }
  return model ? createPiReviewModel(model, thinking, complete) : undefined;
}

/** Native tool calling through Pi's model registry, which keeps provider auth and headers. */
export function createPiReviewModel(model: Model<any>, thinking: ThinkingLevel, complete: PiComplete): ReviewModel {
  const sessionId = uuidv7();
  return {
    label: `${model.provider}/${model.id}`,
    async step(request: ReviewRequest): Promise<ReviewStep> {
      const tools: Tool[] = request.tools.map((spec) => ({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters as unknown as Tool["parameters"],
      }));
      const context: Context = {
        systemPrompt: request.system,
        messages: request.messages.map((message) => toPiMessage(message, model)),
        tools,
      };
      const level = clampThinkingLevel(model, thinking);
      const options: ModelsApiStreamOptions<any> = {
        signal: request.signal,
        sessionId,
        cacheRetention: "none",
        maxTokens: Math.min(request.maxOutputTokens, model.maxTokens),
        maxRetries: 0,
        timeoutMs: request.timeoutMs,
        ...(level === "off" ? {} : { reasoning: level }),
      };
      return fromPiResponse(await complete(model, context, options));
    },
  };
}

function toPiMessage(message: ReviewMessage, model: Model<any>): Message {
  const timestamp = Date.now();
  if (message.role === "user") return { role: "user", content: [{ type: "text", text: message.text }], timestamp };
  if (message.role === "tool") {
    return {
      role: "toolResult",
      toolCallId: message.callId,
      toolName: message.name,
      content: message.text ? [{ type: "text", text: message.text }] : [],
      isError: message.isError,
      timestamp,
    };
  }
  // Providers need their own reply back intact (thinking signatures, reasoning items).
  if (message.native) return message.native as AssistantMessage;
  return {
    role: "assistant",
    content: [
      ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
      ...message.calls.map((call): ToolCall => ({ type: "toolCall", id: call.id, name: call.name, arguments: call.arguments })),
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: message.calls.length > 0 ? "toolUse" : "stop",
    timestamp,
  };
}

function fromPiResponse(response: AssistantMessage): ReviewStep {
  const calls = response.content.flatMap((block) =>
    block.type === "toolCall" ? [{ id: block.id, name: block.name, arguments: block.arguments }] : [],
  );
  const { stopReason } = response;
  const step: ReviewStep = {
    text: response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim(),
    calls,
    usage: { input: response.usage.input, output: response.usage.output, cost: response.usage.cost.total },
    stop:
      stopReason === "aborted" || stopReason === "error" || stopReason === "length"
        ? stopReason
        : calls.length > 0
          ? "tool"
          : "end",
    native: response,
  };
  if (response.errorMessage) step.error = response.errorMessage;
  return step;
}
