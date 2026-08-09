import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  discoverAdvisorConfiguration,
  hasProjectAdvisorCandidate,
  parseConfigYaml,
  slugifyAdvisorName,
} from "../src/config.ts";

test("parses strict config and normalizes standard-Pi tool aliases", () => {
  const parsed = parseConfigYaml(`
enabled: true
model: anthropic/claude-sonnet-4-6
thinking: medium
tools: [read, search, glob]
timeout_ms: 12000
max_attempts: 3
advisors:
  - name: Architecture
    model: openai/gpt-5.4:high
    tools: []
    instructions: Watch module seams.
`);

  assert.deepEqual(parsed.settings.tools, ["read", "grep", "find"]);
  assert.equal(parsed.settings.timeoutMs, 12_000);
  assert.equal(parsed.settings.maxAttempts, 3);
  assert.deepEqual(parsed.advisors[0]?.tools, []);
  assert.equal(parsed.advisors[0]?.instructions, "Watch module seams.");
});

test("rejects unknown keys, unsafe tools, and out-of-range limits", () => {
  assert.throws(() => parseConfigYaml("surprise: true\n"), /unknown key: surprise/);
  assert.throws(() => parseConfigYaml("tools: [bash]\n"), /not a read-only advisor tool/);
  assert.throws(() => parseConfigYaml("timeout_ms: 50\n"), /1000 to 120000/);
});

test("discovers user and trusted project config in specificity order", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-advisor-config-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const agentDir = path.join(temp, "agent");
  const repo = path.join(temp, "repo");
  const cwd = path.join(repo, "packages", "app");
  await fs.mkdir(path.join(repo, ".git"), { recursive: true });
  await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });
  await fs.mkdir(agentDir, { recursive: true });

  await fs.writeFile(
    path.join(agentDir, "WATCHDOG.yml"),
    `enabled: false
model: openai/gpt-5.4
instructions: User baseline.
advisors:
  - name: Architecture
    instructions: User architecture rules.
`,
  );
  await fs.writeFile(
    path.join(repo, "WATCHDOG.yml"),
    `enabled: true
timeout_ms: 9000
instructions: Repository baseline.
`,
  );
  await fs.writeFile(
    path.join(cwd, ".pi", "WATCHDOG.yml"),
    `advisors:
  - name: Architecture
    tools: [read]
    instructions: Leaf architecture rules.
`,
  );
  await fs.writeFile(path.join(cwd, ".pi", "WATCHDOG.md"), "Watch durable queue usage.\n");

  assert.equal(await hasProjectAdvisorCandidate(cwd), true);

  const untrusted = await discoverAdvisorConfiguration({ cwd, agentDir, includeProject: false });
  assert.equal(untrusted.settings.enabled, false);
  assert.equal(untrusted.projectConfigDetected, true);
  assert.equal(untrusted.projectConfigLoaded, false);
  assert.equal(untrusted.sources.length, 1);

  const trusted = await discoverAdvisorConfiguration({ cwd, agentDir, includeProject: true });
  assert.equal(trusted.settings.enabled, true);
  assert.equal(trusted.settings.timeoutMs, 9_000);
  assert.equal(trusted.projectConfigLoaded, true);
  assert.match(trusted.sharedInstructions ?? "", /User baseline\.\n\nRepository baseline\./);
  assert.equal(trusted.advisors.length, 1);
  assert.deepEqual(trusted.advisors[0]?.tools, ["read"]);
  assert.equal(trusted.advisors[0]?.model, "openai/gpt-5.4");
  assert.equal(trusted.advisors[0]?.instructions, "Leaf architecture rules.");
  assert.match(trusted.watchdogBlocks[0] ?? "", /durable queue/);
});

test("rejects symlinked config instead of reading outside its owner", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "pi-advisor-symlink-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const agentDir = path.join(temp, "agent");
  const target = path.join(temp, "outside.yml");
  await fs.mkdir(agentDir);
  await fs.writeFile(target, "enabled: true\n");
  await fs.symlink(target, path.join(agentDir, "WATCHDOG.yml"));

  const result = await discoverAdvisorConfiguration({ cwd: temp, agentDir, includeProject: false });
  assert.equal(result.settings.enabled, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0] ?? "", /regular file, not a symlink/);
});

test("slugifies advisor names deterministically", () => {
  assert.equal(slugifyAdvisorName(" Architecture / API "), "architecture-api");
  assert.equal(slugifyAdvisorName("???"), "advisor");
});
