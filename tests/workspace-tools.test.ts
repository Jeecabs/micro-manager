import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { isWithin, runWorkspaceTool } from "../src/core/tools.ts";
import { createPiWorkspace } from "../src/pi/workspace.ts";

test("read-only tools reject paths and links outside the trusted workspace", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "micro-manager-workspace-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const root = path.join(temp, "workspace");
  const outside = path.join(temp, "outside.txt");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "inside.txt"), "inside\n");
  await fs.writeFile(outside, "outside\n");
  await fs.symlink(outside, path.join(root, "linked.txt"));

  const workspace = createPiWorkspace(root);
  const signal = new AbortController().signal;
  const read = (target: string) => runWorkspaceTool(workspace, "read", { path: target }, "call", signal);

  const inside = await read("inside.txt");
  assert.match(inside[0]?.type === "text" ? inside[0].text : "", /inside/);

  await assert.rejects(read(outside), /inside the trusted workspace/);
  await assert.rejects(read("../outside.txt"), /inside the trusted workspace/);
  await assert.rejects(read("linked.txt"), /link outside the trusted workspace/);
});

test("isWithin needs a separator after the root, on either platform", () => {
  assert.equal(isWithin("/ws", "/ws"), true);
  assert.equal(isWithin("/ws/", "/ws/a/b"), true);
  assert.equal(isWithin("/ws", "/ws-other/file"), false);
  assert.equal(isWithin("/", "/etc/hosts"), true);
  assert.equal(isWithin("C:\\ws", "C:\\ws\\file"), true);
  assert.equal(isWithin("C:\\ws", "C:\\wsx"), false);
});
