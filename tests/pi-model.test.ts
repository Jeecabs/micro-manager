import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Context, Model, ModelsApiStreamOptions } from "@earendil-works/pi-ai";
import type { ReviewMessage, ReviewRequest } from "../src/core/model.ts";
import { REPORT_TOOL_SPEC } from "../src/core/tools.ts";
import { createPiReviewModel } from "../src/pi/model.ts";

const MODEL: Model<"anthropic-messages"> = {
  id: "claude-test",
  name: "Claude Test",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://example.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 300,
};

function reply(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: {
      input: 7,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 10,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
    },
    stopReason,
    timestamp: 1,
  };
}

function request(messages: ReviewMessage[]): ReviewRequest {
  return {
    system: "Review.",
    messages,
    tools: [REPORT_TOOL_SPEC],
    maxOutputTokens: 512,
    timeoutMs: 1_000,
    signal: new AbortController().signal,
  };
}

test("maps a review step onto Pi's model registry and hands the provider's reply back intact", async () => {
  const calls: Array<{ context: Context; options: ModelsApiStreamOptions<any> | undefined }> = [];
  const first = reply(
    [
      { type: "thinking", thinking: "private", thinkingSignature: "sig" },
      { type: "toolCall", id: "c1", name: "read", arguments: { path: "a.ts" } },
    ],
    "toolUse",
  );
  const replies = [first, reply([{ type: "text", text: "done" }], "stop")];
  const reviewModel = createPiReviewModel(MODEL, "high", async (_model, context, options) => {
    calls.push({ context, options });
    return replies.shift()!;
  });

  assert.equal(reviewModel.label, "anthropic/claude-test");
  const step = await reviewModel.step(request([{ role: "user", text: "update" }]));
  assert.equal(step.stop, "tool");
  assert.deepEqual(step.calls, [{ id: "c1", name: "read", arguments: { path: "a.ts" } }]);
  assert.deepEqual(step.usage, { input: 7, output: 3, cost: 0.5 });
  assert.equal(calls[0]?.context.systemPrompt, "Review.");
  assert.equal(calls[0]?.context.tools?.[0]?.name, "report");
  assert.equal(calls[0]?.options?.maxTokens, 300);
  assert.equal(calls[0]?.options?.reasoning, "high");
  assert.equal(calls[0]?.options?.cacheRetention, "none");

  const second = await reviewModel.step(
    request([
      { role: "user", text: "update" },
      { role: "assistant", text: step.text, calls: step.calls, native: step.native },
      { role: "tool", callId: "c1", name: "read", text: "contents", isError: false },
    ]),
  );
  assert.equal(second.stop, "end");
  assert.equal(second.text, "done");
  assert.equal(calls[1]?.context.messages[1], first);
  assert.deepEqual(calls[1]?.context.messages[2], {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "read",
    content: [{ type: "text", text: "contents" }],
    isError: false,
    timestamp: (calls[1]?.context.messages[2] as { timestamp: number }).timestamp,
  });
});

test("passes provider failures through as failed steps", async () => {
  const reviewModel = createPiReviewModel(MODEL, "off", async () => ({
    ...reply([], "error"),
    errorMessage: "overloaded",
  }));
  const step = await reviewModel.step(request([{ role: "user", text: "update" }]));
  assert.equal(step.stop, "error");
  assert.equal(step.error, "overloaded");
});
