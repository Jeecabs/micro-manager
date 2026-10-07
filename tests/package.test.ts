import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const json = async (file: string) => JSON.parse(await fs.readFile(path.join(root, file), "utf8"));

test("the Pi package and the Claude Code plugin release as one version", async () => {
  const pkg = await json("package.json");
  const plugin = await json(".claude-plugin/plugin.json");
  const marketplace = await json(".claude-plugin/marketplace.json");
  assert.equal(plugin.version, pkg.version);
  assert.deepEqual(
    marketplace.plugins.map((entry: { name: string; source: string }) => [entry.name, entry.source]),
    [[plugin.name, "./"]],
  );
});

test("each host's entry point exists", async () => {
  const pkg = await json("package.json");
  for (const entry of pkg.pi.extensions) await fs.access(path.join(root, entry));
  const hooks = await json("hooks/hooks.json");
  for (const module of hooks.modules) await fs.access(path.join(root, "hooks", module));
});
