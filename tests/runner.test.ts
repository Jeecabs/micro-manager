import assert from "node:assert/strict";
import test from "node:test";
import type { ReviewModel, ReviewRequest, ReviewStep, ReviewToolCall } from "../src/core/model.ts";
import { MicroManagerRunner, type MicroManagerRunnerOptions } from "../src/core/runner.ts";
import type { Workspace, WorkspaceToolRequest } from "../src/core/tools.ts";
import type { MicroManagerNote } from "../src/core/types.ts";
import { sleep } from "../src/pi/extension.ts";

function step(calls: ReviewToolCall[] = [], stop: ReviewStep["stop"] = calls.length > 0 ? "tool" : "end"): ReviewStep {
  return { text: "", calls, usage: { input: 10, output: 5, cost: 0.03 }, stop };
}

function call(name: string, args: Record<string, unknown>, id = `${name}-call`): ReviewToolCall {
  return { id, name, arguments: args };
}

function model(respond: (request: ReviewRequest) => ReviewStep | Promise<ReviewStep>): ReviewModel {
  return { label: "test/review-model", step: async (request) => respond(request) };
}

function workspace(run: (request: WorkspaceToolRequest) => string = (request) => `contents of ${request.args.path}`): Workspace {
  return {
    root: "/ws",
    resolve: (target) => (target.startsWith("/") ? target : `/ws/${target}`),
    realPath: async (target) => target,
    run: async (request) => [{ type: "text", text: run(request) }],
  };
}

function baseOptions(overrides: Partial<MicroManagerRunnerOptions> = {}): MicroManagerRunnerOptions {
  return {
    name: "default",
    model: model(() => step()),
    systemPrompt: "Review independently.",
    tools: [],
    workspace: workspace(),
    sleep,
    timeoutMs: 5_000,
    maxOutputTokens: 512,
    maxToolRounds: 3,
    maxContextChars: 20_000,
    maxAttempts: 1,
    onReport: () => {},
    retryDelayMs: 0,
    ...overrides,
  };
}

test("uses read-only tools, then delivers one structured management note", async () => {
  const notes: MicroManagerNote[] = [];
  let readCalls = 0;
  const steps = [
    step([call("read", { path: "src/queue.ts" })]),
    step([call("report", { note: "Await queue.flush() before reporting completion.", severity: "concern" })]),
  ];
  const runner = new MicroManagerRunner(
    baseOptions({
      name: "Architecture",
      tools: ["read"],
      workspace: workspace((request) => {
        readCalls++;
        return `contents of ${request.args.path}`;
      }),
      model: model(() => steps.shift() ?? step()),
      onReport: (note) => notes.push(note),
    }),
  );

  runner.enqueue("session update");
  await waitFor(() => notes.length === 1);

  assert.equal(readCalls, 1);
  assert.deepEqual(notes[0], {
    note: "Await queue.flush() before reporting completion.",
    severity: "concern",
    manager: "Architecture",
  });
  await waitFor(() => runner.backlog === 0);
  assert.equal(runner.stats.turns, 2);
  assert.equal(runner.stats.inputTokens, 20);
  assert.equal(runner.stats.cost, 0.06);
  assert.equal(runner.stats.model, "test/review-model");
  runner.dispose();
});

test("returns tool failures to the review model instead of running them", async () => {
  const requests: ReviewRequest[] = [];
  let ran = 0;
  const steps = [
    step([
      call("grep", { pattern: "x" }, "not-granted"),
      call("read", {}, "missing-path"),
      call("read", { path: "../secrets.txt" }, "escapes"),
    ]),
    step(),
  ];
  const runner = new MicroManagerRunner(
    baseOptions({
      tools: ["read"],
      workspace: workspace(() => {
        ran++;
        return "unexpected";
      }),
      model: model((request) => {
        requests.push(request);
        return steps.shift() ?? step();
      }),
    }),
  );

  runner.enqueue("update");
  await waitFor(() => runner.backlog === 0);

  assert.equal(ran, 0);
  assert.deepEqual(
    requests[0]?.tools.map((tool) => tool.name),
    ["report", "read"],
  );
  const results = requests[1]?.messages.filter((message) => message.role === "tool") ?? [];
  assert.deepEqual(
    results.map((message) => [message.role === "tool" && message.callId, message.role === "tool" && message.isError]),
    [
      ["not-granted", true],
      ["missing-path", true],
      ["escapes", true],
    ],
  );
  assert.match(JSON.stringify(results), /not available.*path: is required.*inside the trusted workspace/s);
  runner.dispose();
});

test("dedupes the same management note across separate updates", async () => {
  const notes: MicroManagerNote[] = [];
  const runner = new MicroManagerRunner(
    baseOptions({
      model: model(() => step([call("report", { note: "Run the focused regression test.", severity: "nit" })])),
      onReport: (note) => notes.push(note),
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
  const notes: MicroManagerNote[] = [];
  let attempts = 0;
  const runner = new MicroManagerRunner(
    baseOptions({
      maxAttempts: 2,
      model: model(() => {
        attempts++;
        if (attempts === 1) throw new Error("temporary provider failure");
        return step([call("report", { note: "Check the fallback path.", severity: "concern" })]);
      }),
      onReport: (note) => notes.push(note),
    }),
  );

  runner.enqueue("retry update");
  await waitFor(() => notes.length === 1);
  assert.equal(attempts, 2);
  assert.equal(runner.stats.state, "running");
  runner.dispose();
});

test("retry rolls back without sparse messages after a context reset", async () => {
  const requests: ReviewRequest[] = [];
  let calls = 0;
  const runner = new MicroManagerRunner(
    baseOptions({
      maxAttempts: 2,
      maxContextChars: 8_000,
      model: model((request) => {
        requests.push(request);
        calls++;
        if (calls === 2) throw new Error("temporary provider failure");
        return step();
      }),
    }),
  );

  runner.enqueue("a".repeat(4_000));
  await waitFor(() => runner.backlog === 0);
  runner.enqueue("b".repeat(4_000));
  await waitFor(() => runner.backlog === 0);

  const retry = requests[2];
  assert.ok(retry);
  assert.equal(retry.messages.length, 1);
  assert.ok(retry.messages.every((message) => message !== undefined));
  runner.dispose();
});

test("bounds oversized updates and read results before the next model call", async () => {
  const requests: ReviewRequest[] = [];
  const notes: MicroManagerNote[] = [];
  const steps = [
    step([call("read", { path: "large.txt" })]),
    step([call("report", { note: "The large file needs a focused parser.", severity: "nit" })]),
  ];
  const runner = new MicroManagerRunner(
    baseOptions({
      tools: ["read"],
      workspace: workspace(() => "x".repeat(20_000)),
      maxContextChars: 8_000,
      maxToolRounds: 1,
      model: model((request) => {
        requests.push(request);
        return steps.shift() ?? step();
      }),
      onReport: (note) => notes.push(note),
    }),
  );

  runner.enqueue("u".repeat(20_000));
  await waitFor(() => notes.length === 1);
  const firstUser = requests[0]?.messages[0];
  assert.equal(firstUser?.role, "user");
  assert.ok(JSON.stringify(firstUser).length < 4_500);
  const toolResult = requests[1]?.messages.find((message) => message.role === "tool");
  assert.ok(JSON.stringify(toolResult).length < 1_000);
  runner.dispose();
});

test("replaces image output with an omission marker", async () => {
  const requests: ReviewRequest[] = [];
  const steps = [step([call("read", { path: "diagram.png" })]), step()];
  const runner = new MicroManagerRunner(
    baseOptions({
      tools: ["read"],
      workspace: { ...workspace(), run: async () => [{ type: "image" }] },
      model: model((request) => {
        requests.push(request);
        return steps.shift() ?? step();
      }),
    }),
  );

  runner.enqueue("update");
  await waitFor(() => runner.backlog === 0);
  const result = requests[1]?.messages.find((message) => message.role === "tool");
  assert.equal(result?.role === "tool" && result.text, "[image omitted from micro-manager context]");
  runner.dispose();
});

test("resets before serialized message overhead can silently drop an update", async () => {
  const maxContextChars = 8_000;
  const requests: ReviewRequest[] = [];
  const runner = new MicroManagerRunner(
    baseOptions({
      maxContextChars,
      model: model((request) => {
        requests.push(request);
        return step();
      }),
    }),
  );

  runner.enqueue("a".repeat(3_950));
  await waitFor(() => runner.backlog === 0);
  const stored = { role: "assistant", text: "", calls: [] };
  const priorChars = JSON.stringify([...(requests[0]?.messages ?? []), stored]).length;
  const remaining = maxContextChars - priorChars;
  assert.ok(remaining >= 1_000 && remaining <= maxContextChars / 2);

  runner.enqueue("b".repeat(remaining));
  await waitFor(() => runner.backlog === 0);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.messages.length, 1);
  runner.dispose();
});

test("does not execute investigative tools after the configured tool-round limit", async () => {
  let readCalls = 0;
  const runner = new MicroManagerRunner(
    baseOptions({
      tools: ["read"],
      workspace: workspace(() => {
        readCalls++;
        return "unexpected";
      }),
      maxToolRounds: 0,
      model: model(() => step([call("read", { path: "src/queue.ts" })])),
    }),
  );

  runner.enqueue("no-tools update");
  assert.equal(await runner.waitForIdle(1_000), true);
  assert.equal(readCalls, 0);
  assert.equal(runner.stats.turns, 1);
  runner.dispose();
});

test("reports a provider-originated abort as a micro-manager error", async () => {
  const runner = new MicroManagerRunner(
    baseOptions({ model: model(() => ({ ...step([], "aborted"), error: "provider cancelled" })) }),
  );

  runner.enqueue("aborted update");
  await waitFor(() => runner.stats.state === "error");
  assert.match(runner.stats.lastError ?? "", /provider cancelled/);
  runner.dispose();
});

test("times out a slow attempt with the configured budget", async () => {
  const runner = new MicroManagerRunner(
    baseOptions({
      timeoutMs: 20,
      model: model(
        (request) =>
          new Promise<ReviewStep>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(new Error("aborted by signal")), { once: true });
          }),
      ),
    }),
  );

  runner.enqueue("slow update");
  await waitFor(() => runner.stats.state === "error");
  assert.match(runner.stats.lastError ?? "", /timed out/);
  runner.dispose();
});

test("waitForIdle gives up when the backlog outlasts its budget", async () => {
  let release: ((value: ReviewStep) => void) | undefined;
  const runner = new MicroManagerRunner(
    baseOptions({ model: model(() => new Promise<ReviewStep>((resolve) => (release = resolve))) }),
  );

  runner.enqueue("held update");
  assert.equal(await runner.waitForIdle(20), false);
  release!(step());
  assert.equal(await runner.waitForIdle(1_000), true);
  runner.dispose();
});

test("leaves cost unset when the host reports tokens only", async () => {
  const runner = new MicroManagerRunner(
    baseOptions({ model: model(() => ({ text: "", calls: [], usage: { input: 3, output: 1 }, stop: "end" })) }),
  );

  runner.enqueue("update");
  await waitFor(() => runner.backlog === 0);
  assert.equal(runner.stats.inputTokens, 3);
  assert.equal(runner.stats.cost, undefined);
  runner.dispose();
});

test("reset ignores a late response from a completion that does not honor abort", async () => {
  const notes: MicroManagerNote[] = [];
  let calls = 0;
  let release: ((value: ReviewStep) => void) | undefined;
  const runner = new MicroManagerRunner(
    baseOptions({
      model: model(() => {
        calls++;
        if (calls !== 2) return step();
        return new Promise<ReviewStep>((resolve) => {
          release = resolve;
        });
      }),
      onReport: (note) => notes.push(note),
    }),
  );

  runner.enqueue("first update");
  await waitFor(() => runner.backlog === 0);
  runner.enqueue("update that will be reset");
  await waitFor(() => release !== undefined);
  runner.reset();
  runner.enqueue("fresh update");
  release!(step([call("report", { note: "Stale report from the old context.", severity: "blocker" })]));
  await waitFor(() => runner.backlog === 0);

  assert.equal(calls, 3);
  assert.deepEqual(notes, []);
  runner.dispose();
});

test("dispose aborts an in-flight provider request without reporting an error", async () => {
  let observedSignal: AbortSignal | undefined;
  const runner = new MicroManagerRunner(
    baseOptions({
      model: model((request) => {
        observedSignal = request.signal;
        return new Promise<ReviewStep>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }),
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
