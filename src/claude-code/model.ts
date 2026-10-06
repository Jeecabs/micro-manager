import type { ReviewModel, ReviewUsage } from "../core/model.ts";
import { createTextProtocolModel } from "../core/text-protocol.ts";
import type { ThinkingLevel } from "../core/types.ts";
import type { ClaudeCodeApi, ClaudeCodeEffort, ClaudeCodeModelUsage } from "./api.ts";

const EFFORTS: Record<ThinkingLevel, ClaudeCodeEffort> = {
  off: "low",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

/** Sonnet follows the JSON tool protocol reliably; with the default `low` thinking it runs at the lowest effort. */
export const CLAUDE_CODE_DEFAULT_MODEL = "sonnet";

/**
 * Resolves a selector for `$.model.complete`: an alias (`haiku`), a model id, or
 * `anthropic/<id>` as a shared Pi config spells it. Other providers do not resolve, and
 * the manager shows `no_model`. Undefined selects Sonnet.
 */
export function resolveClaudeCodeModel(
  api: ClaudeCodeApi,
  selector: string | undefined,
  thinking: ThinkingLevel,
): ReviewModel | undefined {
  const model = selector === undefined ? CLAUDE_CODE_DEFAULT_MODEL : claudeModelId(selector);
  if (!model) return undefined;
  const effort = EFFORTS[thinking];
  return createTextProtocolModel(model, async (request) => {
    const result = await api.completeModel(
      { model, system: request.system, prompt: request.prompt, maxTokens: request.maxTokens, effort, timeoutMs: request.timeoutMs },
      request.signal,
    );
    const usage = toUsage(result.usage);
    if (result.isAnswered) return { ok: true, text: result.text, usage };
    if (result.reason === "aborted") return { ok: false, stop: "aborted", usage };
    if (result.reason === "empty-reply") return { ok: true, text: "", usage };
    const detail = [result.status, result.error].filter((part) => part !== undefined && part !== null).join(" ");
    return { ok: false, stop: "error", error: `${model}: ${result.reason}${detail ? ` (${detail})` : ""}`, usage };
  });
}

function claudeModelId(selector: string): string | undefined {
  const slash = selector.indexOf("/");
  if (slash === -1) return selector;
  return selector.slice(0, slash) === "anthropic" ? selector.slice(slash + 1) : undefined;
}

function toUsage(usage: ClaudeCodeModelUsage | undefined): ReviewUsage {
  if (!usage) return { input: 0, output: 0 };
  return {
    input: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    output: usage.output_tokens,
  };
}
