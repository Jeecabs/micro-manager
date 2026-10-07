import assert from "node:assert/strict";
import test from "node:test";
import { runWorkspaceTool } from "../src/core/tools.ts";
import { ClaudeCodeMicroManager } from "../src/claude-code/adapter.ts";
import type { ClaudeCodeApi, ClaudeCodeModelRequest, ClaudeCodeModelResult } from "../src/claude-code/api.ts";
import { formatCard } from "../src/claude-code/card.ts";
import { ClaudeCodeHistory, type AppendedRow } from "../src/claude-code/history.ts";
import { resolveClaudeCodeModel } from "../src/claude-code/model.ts";
import { dirname, join, normalize, resolve } from "../src/claude-code/paths.ts";
import { createClaudeCodeWorkspace } from "../src/claude-code/workspace.ts";
import { sleep } from "../src/pi/extension.ts";

interface FakeOptions {
  files?: Record<string, string>;
  links?: Record<string, string>;
  replies?: Array<ClaudeCodeModelResult | ((request: ClaudeCodeModelRequest) => Promise<ClaudeCodeModelResult>)>;
  surfaces?: string[];
  rg?: (argv: readonly string[], cwd: string) => { exitCode: number; stdout: string; stderr: string };
}

function fakeApi(options: FakeOptions = {}) {
  const files = new Map(Object.entries(options.files ?? {}));
  const links = new Map(Object.entries(options.links ?? {}));
  const replies = [...(options.replies ?? [])];
  const calls = {
    appends: [] as Array<{ type: string; text: string }>,
    submits: [] as string[],
    logs: [] as string[],
    statuses: [] as Array<string | undefined>,
    redraws: 0,
    requests: [] as ClaudeCodeModelRequest[],
    runs: [] as Array<{ argv: readonly string[]; cwd: string }>,
  };
  const real = (path: string): string => links.get(path) ?? path;
  const isDir = (path: string): boolean => [...files.keys()].some((file) => file.startsWith(`${path}/`));
  const api: ClaudeCodeApi = {
    async completeModel(request) {
      calls.requests.push(request);
      const next = replies.shift() ?? { isAnswered: true, text: '{"calls":[]}', usage: { input_tokens: 1, output_tokens: 1 } };
      return typeof next === "function" ? next(request) : next;
    },
    cwd: async () => "/repo",
    configEnv: async () => ({ CLAUDE_CONFIG_DIR: undefined, HOME: "/home/me", USERPROFILE: undefined }),
    surfaces: async () => options.surfaces ?? ["terminal"],
    exists: async (path) => files.has(path) || isDir(path) || links.has(path),
    async stat(path, statOptions) {
      const target = real(path);
      const kind = files.has(target) ? "file" : isDir(target) ? "dir" : "other";
      if (kind === "other") throw new Error(`ENOENT: ${path}`);
      return {
        kind,
        size: files.get(target)?.length ?? 0,
        isLink: links.has(path),
        ...(statOptions?.resolve ? { realPath: target } : {}),
      };
    },
    async read(path) {
      const text = files.get(real(path));
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    async list(path) {
      const names = new Map<string, "file" | "dir" | "other">();
      for (const link of links.keys()) if (dirname(link) === path) names.set(link.slice(path.length + 1), "other");
      for (const file of files.keys()) {
        if (!file.startsWith(`${path}/`)) continue;
        const [name, ...rest] = file.slice(path.length + 1).split("/");
        names.set(name!, rest.length > 0 ? "dir" : "file");
      }
      return [...names].map(([name, kind]) => ({ name, kind }));
    },
    async run(argv, init) {
      calls.runs.push({ argv, cwd: init.cwd });
      if (!options.rg) throw new Error("spawn rg ENOENT");
      return options.rg(argv, init.cwd);
    },
    async append(type, text) {
      calls.appends.push({ type, text });
    },
    async submit(text) {
      calls.submits.push(text);
    },
    log: (text) => calls.logs.push(text),
    status: (text) => calls.statuses.push(text),
    redraw: () => calls.redraws++,
    sleep,
    every(ms, fn) {
      const timer = setInterval(fn, ms);
      return { cancel: () => clearInterval(timer) };
    },
  };
  return { api, calls };
}

function report(note: string, severity: string): ClaudeCodeModelResult {
  return {
    isAnswered: true,
    text: JSON.stringify({ calls: [{ tool: "report", args: { note, severity } }] }),
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function row(uuid: string, door: string, content: unknown[], extra: Partial<AppendedRow> = {}): AppendedRow {
  return {
    uuid,
    door,
    origin: { kind: door === "response" ? "model" : "composer" },
    message: { type: door === "response" ? "assistant" : "user", content },
    ...extra,
  };
}

const ENABLED = { "/home/me/.claude/MICRO_MANAGER.yml": "enabled: true\nmodel: haiku\nmax_attempts: 1\n" };

test("paths fold dots and keep each platform's separators", () => {
  assert.equal(normalize("/a/./b/../c//d/"), "/a/c/d");
  assert.equal(normalize("/../etc"), "/etc");
  assert.equal(resolve("/repo", "../outside"), "/outside");
  assert.equal(resolve("/repo", "/abs/x"), "/abs/x");
  assert.equal(join("/repo", ".claude", "MICRO_MANAGER.yml"), "/repo/.claude/MICRO_MANAGER.yml");
  assert.equal(dirname("/repo/src"), "/repo");
  assert.equal(dirname("/repo"), "/");
  assert.equal(dirname("/"), "/");
  assert.equal(resolve("C:\\repo", "src\\a.ts"), "C:\\repo\\src\\a.ts");
  assert.equal(dirname("C:\\repo"), "C:\\");
  assert.equal(dirname("C:\\"), "C:\\");
});

test("the record holds one line per note under a face that escalates with severity", () => {
  const notes = [
    { note: "Run the\nfocused test.", severity: "concern", manager: "Tests" },
    { note: "Rename x.", severity: "nit" },
  ] as const;
  assert.equal(formatCard(notes), "ò_ó ! [Tests] Run the focused test.\n¬_¬ · Rename x.");
});

test("history keeps main-loop evidence and drops thinking, subagents, and its own rows", () => {
  const history = new ClaudeCodeHistory("micro-manager");
  history.record(row("u1", "prompt", [{ type: "text", text: "Fix the queue." }]));
  history.record(
    row("a1", "response", [
      { type: "thinking", thinking: "private" },
      { type: "text", text: "Reading it." },
      { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/repo/q.ts" } },
    ]),
  );
  history.record(row("r1", "tool-result", [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "queue code" }] }]));
  history.record(row("s1", "response", [{ type: "text", text: "subagent" }], { agentId: "agent-1" }));
  history.record(row("n1", "note", [{ type: "text", text: "<micro-manager-note>" }], { origin: { kind: "plugin", name: "micro-manager" } }));
  history.record(row("x1", "attachment", [{ type: "text", text: "reminder" }]));

  assert.deepEqual(
    history.entries().map((entry) => [entry.id, entry.items]),
    [
      ["u1", [{ role: "user", text: "Fix the queue." }]],
      [
        "a1",
        [
          { role: "assistant", text: "Reading it." },
          { role: "assistant_tool", tool: "Read", arguments: { file_path: "/repo/q.ts" } },
        ],
      ],
      ["r1", [{ role: "tool_result", tool: "Read", error: false, text: "queue code" }]],
    ],
  );

  assert.equal(history.record({ ...row("c1", "compaction", []), message: { type: "system", content: [] } }), "compacted");
  history.record(row("c2", "compaction", [{ type: "text", text: "Summary so far." }]));
  assert.deepEqual(history.entries(), [{ id: "c2", items: [{ role: "summary", text: "Summary so far." }] }]);
});

test("model selectors map Pi spellings and default to Sonnet", () => {
  const { api } = fakeApi();
  assert.equal(resolveClaudeCodeModel(api, "anthropic/claude-sonnet-4-6", "low")?.label, "claude-sonnet-4-6");
  assert.equal(resolveClaudeCodeModel(api, "haiku", "low")?.label, "haiku");
  assert.equal(resolveClaudeCodeModel(api, undefined, "low")?.label, "sonnet");
  assert.equal(resolveClaudeCodeModel(api, "openai/gpt-5.4", "low"), undefined);
});

test("workspace reads numbered lines and searches with ripgrep inside the root", async () => {
  const { api, calls } = fakeApi({
    files: { "/repo/a.ts": "one\ntwo\nthree", "/outside/secret": "x" },
    links: { "/repo/link": "/outside/secret" },
    rg: (argv) => ({ exitCode: 0, stdout: argv.includes("--files") ? "b.ts\na.ts\n" : "a.ts:2:two\n", stderr: "" }),
  });
  const workspace = createClaudeCodeWorkspace(api, "/repo");
  const signal = new AbortController().signal;
  const text = async (tool: "read" | "grep" | "find" | "ls", args: Record<string, unknown>) => {
    const [block] = await runWorkspaceTool(workspace, tool, args, "c", signal);
    return block?.type === "text" ? block.text : "";
  };

  assert.equal(await text("read", { path: "a.ts", offset: 2, limit: 1 }), "2\ttwo\n[1 more lines; continue with offset=3]");
  assert.equal(await text("grep", { pattern: "two", ignoreCase: true }), "a.ts:2:two");
  assert.deepEqual(calls.runs[0]?.argv.slice(-4), ["--regexp", "two", "--", "/repo"]);
  assert.ok(calls.runs[0]?.argv.includes("--ignore-case"));
  assert.equal(await text("find", { pattern: "*.ts" }), "a.ts\nb.ts");
  assert.equal(await text("ls", {}), "a.ts\nlink");
  await assert.rejects(text("read", { path: "../outside/secret" }), /inside the trusted workspace/);
  await assert.rejects(text("read", { path: "link" }), /link outside the trusted workspace/);
});

test("steers a concern into a running turn and shows it in the transcript", async () => {
  const { api, calls } = fakeApi({ files: ENABLED, replies: [report("Await the flush.", "concern")] });
  const manager = new ClaudeCodeMicroManager("micro-manager", api);
  await manager.start();
  assert.match(await manager.command("status"), /^active[\s\S]*- default: running haiku/);

  manager.turnStarted();
  manager.record(row("u1", "prompt", [{ type: "text", text: "Ship it." }]));
  manager.record(row("a1", "response", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "make" } }]));
  await manager.stepEnded(false);
  await waitFor(() => calls.appends.length === 2);

  assert.equal(calls.requests[0]?.model, "haiku");
  assert.equal(calls.requests[0]?.effort, "low");
  assert.match(calls.requests[0]?.prompt ?? "", /Ship it\.[\s\S]*"tool":"Bash"/);
  assert.deepEqual(calls.logs, ["ò_ó ! Await the flush."]);
  assert.deepEqual(calls.appends[0], { type: "system", text: "ò_ó ! Await the flush." });
  assert.equal(calls.appends[1]?.type, "user");
  assert.match(calls.appends[1]?.text ?? "", /<micro-manager-note severity="concern"/);
  assert.deepEqual(calls.submits, []);
  assert.deepEqual(manager.face(), { text: "(¬_¬) hm.", tone: "warning", animating: false, state: "watching" });
  assert.deepEqual(calls.statuses, [], "a healthy manager keeps the warning line clear");
  manager.dispose();
  assert.equal(manager.face(), undefined);
});

test("wakes an idle session for a blocker and holds nits until the turn ends", async () => {
  let turnOver!: () => void;
  const ended = new Promise<void>((resolve) => (turnOver = resolve));
  const { api, calls } = fakeApi({
    files: ENABLED,
    // A real review takes about a second, so it lands after the turn has finished.
    replies: [report("Tidy the import.", "nit"), () => ended.then(() => report("The migration drops live data.", "blocker"))],
  });
  const manager = new ClaudeCodeMicroManager("micro-manager", api);
  await manager.start();

  manager.turnStarted();
  manager.record(row("u1", "prompt", [{ type: "text", text: "Refactor." }]));
  await manager.stepEnded(false);
  await waitFor(() => calls.requests.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.appends.length, 0, "a nit waits for the running turn");
  assert.deepEqual(calls.logs, []);

  manager.record(row("a1", "response", [{ type: "text", text: "Done." }]));
  await manager.stepEnded(true);
  manager.turnCompleted();
  turnOver();
  await waitFor(() => calls.appends.length >= 2);
  assert.deepEqual(
    calls.appends.slice(0, 2).map((entry) => entry.type),
    ["system", "user"],
  );
  assert.equal(calls.logs[0], "¬_¬ · Tidy the import.");
  await waitFor(() => calls.submits.length === 1);
  assert.match(calls.submits[0] ?? "", /severity="blocker"/);
  assert.deepEqual(calls.logs, ["¬_¬ · Tidy the import.", "Ò_Ó ✗ The migration drops live data."]);
  manager.dispose();
});

test("print runs buffer notes and record them as a notice before the final step closes", async () => {
  const { api, calls } = fakeApi({ files: ENABLED, surfaces: [], replies: [report("Output is invalid.", "blocker")] });
  const manager = new ClaudeCodeMicroManager("micro-manager", api);
  await manager.start();
  manager.turnStarted();
  manager.record(row("u1", "prompt", [{ type: "text", text: "Generate it." }]));
  await manager.stepEnded(true);

  assert.deepEqual(calls.appends, [{ type: "system", text: "Ò_Ó ✗ Output is invalid." }]);
  assert.deepEqual(calls.submits, []);
  assert.deepEqual(calls.logs, [], "print runs keep the live transcript out of it");
  manager.dispose();
});

test("raises the warning line only when no review model resolves", async () => {
  const { api, calls } = fakeApi({ files: { "/home/me/.claude/MICRO_MANAGER.yml": "enabled: true\nmodel: openai/gpt-5.4\n" } });
  const manager = new ClaudeCodeMicroManager("micro-manager", api);
  await manager.start();
  assert.equal(manager.face()?.tone, "warning");
  assert.deepEqual(calls.statuses, ["(?_?) no review model resolved; see /micro-manager status"]);
  manager.dispose();
  assert.equal(calls.statuses.at(-1), undefined);
});

test("reviews with Sonnet at the lowest effort when the config names no model", async () => {
  const { api, calls } = fakeApi({ files: { "/home/me/.claude/MICRO_MANAGER.yml": "enabled: true\n" } });
  const manager = new ClaudeCodeMicroManager("micro-manager", api);
  await manager.start();
  assert.match(await manager.command("status"), /- default: running sonnet/);
  manager.record(row("u1", "prompt", [{ type: "text", text: "Go." }]));
  await manager.stepEnded(false);
  await waitFor(() => calls.requests.length === 1);
  assert.equal(calls.requests[0]?.model, "sonnet");
  assert.equal(calls.requests[0]?.effort, "low");
  manager.dispose();
});

test("stays quiet until enabled, then starts from current history", async () => {
  const { api, calls } = fakeApi({ files: { "/repo/.claude/MICRO_MANAGER.yml": "model: haiku\n" } });
  const manager = new ClaudeCodeMicroManager("micro-manager", api);
  await manager.start();
  manager.record(row("u1", "prompt", [{ type: "text", text: "Old work." }]));
  await manager.stepEnded(true);
  assert.equal(calls.requests.length, 0);
  assert.match(await manager.command("status"), /disabled[\s\S]*config: \/repo\/\.claude\/MICRO_MANAGER\.yml/);

  assert.equal(await manager.command("on"), "enabled");
  manager.record(row("u2", "prompt", [{ type: "text", text: "New work." }]));
  await manager.stepEnded(true);
  await waitFor(() => calls.requests.length === 1);
  assert.doesNotMatch(calls.requests[0]?.prompt ?? "", /Old work/);
  assert.match(calls.requests[0]?.prompt ?? "", /New work/);
  manager.dispose();
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
