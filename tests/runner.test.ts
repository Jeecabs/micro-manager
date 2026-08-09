import assert from "node:assert/strict";
import test from "node:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Context, Model, ToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { AdvisorRunner, type AdvisorRunnerOptions } from "../src/advisor-runner.ts";
import type { AdvisorNote } from "../src/types.ts";

const MODEL: Model<"openai-responses"> = {
  id: "review-model",
  name: "Review Model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 4_096,
};

const readSchema = Type.Object({ path: Type.String() });

function response(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "toolUse"): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function call(name: string, arguments_: Record<string, unknown>, id = `${name}-call`): ToolCall {
  return { type: "toolCall", id, name, arguments: arguments_ };
}

function baseOptions(overrides: Partial<AdvisorRunnerOptions> = {}): AdvisorRunnerOptions {
  return {
    name: "default",
    model: MODEL,
    thinking: "low",
    systemPrompt: "Review independently.",
    tools: [],
    complete: async () => response([], "stop"),
    timeoutMs: 5_000,
    maxOutputTokens: 512,
    maxToolRounds: 3,
    maxContextChars: 20_000,
    maxAttempts: 1,
    onAdvice: () => {},
    retryDelayMs: 0,
    ...overrides,
  };
}

test("uses read-only tools, then delivers one structured advisory", async () => {
  const notes: AdvisorNote[] = [];
  let readCalls = 0;
  const readTool: AgentTool<typeof readSchema> = {
    name: "read",
    label: "Read",
    description: "Read a file",
    parameters: readSchema,
    async execute(_id, args) {
      readCalls++;
      return { content: [{ type: "text", text: `contents of ${args.path}` }], details: {} };
    },
  };
  const responses = [
    response([call("read", { path: "src/queue.ts" })]),
    response([call("advise", { note: "Await queue.flush() before reporting completion.", severity: "concern" })]),
  ];
  const runner = new AdvisorRunner(
    baseOptions({
      name: "Architecture",
      tools: [readTool],
      complete: async () => responses.shift() ?? response([], "stop"),
      onAdvice: (note) => notes.push(note),
    }),
  );

  runner.enqueue("session update");
  await waitFor(() => notes.length === 1);

  assert.equal(readCalls, 1);
  assert.deepEqual(notes[0], {
    note: "Await queue.flush() before reporting completion.",
    severity: "concern",
    advisor: "Architecture",
  });
  await waitFor(() => runner.backlog === 0);
  assert.equal(runner.stats.turns, 2);
  assert.equal(runner.stats.inputTokens, 20);
  assert.equal(runner.stats.cost, 0.06);
  runner.dispose();
});

test("dedupes the same advisory across separate updates", async () => {
  const notes: AdvisorNote[] = [];
  const runner = new AdvisorRunner(
    baseOptions({
      complete: async () => response([call("advise", { note: "Run the focused regression test.", severity: "nit" })]),
      onAdvice: (note) => notes.push(note),
    }),
  );

  runner.enqueue("first update");
  await waitFor(() => runner.backlog === 0);
  runner.enqueue("second update");
  await waitFor(() => runner.backlog === 0);

  assert.equal(notes.length, 1);
  runner.dispose();
});

test("retries a clean bounded update after a provider failure", async () => {
  const notes: AdvisorNote[] = [];
  let attempts = 0;
  const runner = new AdvisorRunner(
    baseOptions({
      maxAttempts: 2,
      complete: async () => {
        attempts++;
        if (attempts === 1) throw new Error("temporary provider failure");
        return response([call("advise", { note: "Check the fallback path.", severity: "concern" })]);
      },
      onAdvice: (note) => notes.push(note),
    }),
  );

  runner.enqueue("retry update");
  await waitFor(() => notes.length === 1);
  assert.equal(attempts, 2);
  assert.equal(runner.stats.state, "running");
  runner.dispose();
});

test("bounds oversized updates and read results before the next model call", async () => {
  const contexts: Context[] = [];
  const notes: AdvisorNote[] = [];
  const readTool: AgentTool<typeof readSchema> = {
    name: "read",
    label: "Read",
    description: "Read a file",
    parameters: readSchema,
    async execute() {
      return { content: [{ type: "text", text: "x".repeat(20_000) }], details: {} };
    },
  };
  const responses = [
    response([call("read", { path: "large.txt" })]),
    response([call("advise", { note: "The large file needs a focused parser.", severity: "nit" })]),
  ];
  const runner = new AdvisorRunner(
    baseOptions({
      tools: [readTool],
      maxContextChars: 8_000,
      maxToolRounds: 1,
      complete: async (_model, context) => {
        contexts.push(context);
        return responses.shift() ?? response([], "stop");
      },
      onAdvice: (note) => notes.push(note),
    }),
  );

  runner.enqueue("u".repeat(20_000));
  await waitFor(() => notes.length === 1);
  const firstUser = contexts[0]?.messages[0];
  assert.equal(firstUser?.role, "user");
  assert.ok(JSON.stringify(firstUser).length < 4_500);
  const toolResult = contexts[1]?.messages.find((message) => message.role === "toolResult");
  assert.ok(JSON.stringify(toolResult).length < 1_000);
  runner.dispose();
});

test("does not execute investigative tools after the configured tool-round limit", async () => {
  let readCalls = 0;
  const readTool: AgentTool<typeof readSchema> = {
    name: "read",
    label: "Read",
    description: "Read a file",
    parameters: readSchema,
    async execute() {
      readCalls++;
      return { content: [{ type: "text", text: "unexpected" }], details: {} };
    },
  };
  const runner = new AdvisorRunner(
    baseOptions({
      tools: [readTool],
      maxToolRounds: 0,
      complete: async () => response([call("read", { path: "src/queue.ts" })]),
    }),
  );

  runner.enqueue("no-tools update");
  await runner.waitForIdle(1_000);
  assert.equal(readCalls, 0);
  assert.equal(runner.stats.turns, 1);
  runner.dispose();
});

test("reports a provider-originated abort as an advisor error", async () => {
  const runner = new AdvisorRunner(
    baseOptions({ complete: async () => ({ ...response([], "aborted"), errorMessage: "provider cancelled" }) }),
  );

  runner.enqueue("aborted update");
  await waitFor(() => runner.stats.state === "error");
  assert.match(runner.stats.lastError ?? "", /provider cancelled/);
  runner.dispose();
});

test("dispose aborts an in-flight provider request without reporting an error", async () => {
  let observedSignal: AbortSignal | undefined;
  const runner = new AdvisorRunner(
    baseOptions({
      complete: async (_model, _context, options) => {
        observedSignal = options?.signal;
        return new Promise<AssistantMessage>((_resolve, reject) => {
          observedSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    }),
  );

  runner.enqueue("slow update");
  await waitFor(() => observedSignal !== undefined);
  runner.dispose();
  await waitFor(() => observedSignal?.aborted === true);
  assert.equal(runner.stats.state, "paused");
  assert.equal(runner.stats.lastError, undefined);
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
