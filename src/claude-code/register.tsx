import type { Register } from "claude-code";
import type { FooterStatus } from "../core/session.ts";
import { ClaudeCodeMicroManager } from "./adapter.ts";

// The Claude Code entry point. A mod may only spell `$` at its call sites, so this file
// hands the adapter closures over `session.start`'s `$` and forwards events; nothing else.

const PLUGIN = "micro-manager";
const FACE_COLORS = { accent: "claude", dim: "inactive", muted: "subtle", warning: "warning", error: "error" } as const;

let manager: ClaudeCodeMicroManager | undefined;

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    manager?.dispose();
    const current = new ClaudeCodeMicroManager(PLUGIN, {
      completeModel: (request, signal) => $.model.complete(request, { signal }),
      cwd: () => $.session.cwd(),
      configEnv: async () => ({
        CLAUDE_CONFIG_DIR: await $.env.get("CLAUDE_CONFIG_DIR"),
        HOME: await $.env.get("HOME"),
        USERPROFILE: await $.env.get("USERPROFILE"),
      }),
      surfaces: () => $.session.surfaces(),
      exists: (path) => $.fs.exists(path),
      stat: (path, options) => (options ? $.fs.stat(path, options) : $.fs.stat(path)),
      read: (path) => $.fs.read(path),
      list: (path) => $.fs.list(path),
      run: (argv, init) => $.process.run(argv, init),
      append: async (type, text) => {
        await $.session.append({ message: { type, content: [{ type: "text", text }] } });
      },
      submit: async (text) => {
        await $.prompt.submit({ text });
      },
      log: (text) => $.ui.log(text),
      status: (text) => $.ui.status(text),
      redraw: () => $.ui.invalidate("ui.render"),
      sleep: (ms, signal) => $.clock.sleep(ms, { signal }),
      every: (ms, fn) => $.clock.every(ms, fn),
    });
    manager = current;
    await $.command.register({
      name: PLUGIN,
      description: "Inspect or control The Micro Manager",
      argumentHint: "[on|off|status|reload|dump|config]",
      immediate: true,
    });
    await current.start();
    return result;
  });

  on("session.append", async ($, e, next) => {
    try {
      manager?.record(e);
    } catch {
      // Evidence is best effort; the row is stored whatever happens here.
    }
    return next(e);
  });

  on("turn.start", async ($, e, next) => {
    manager?.turnStarted();
    return next(e);
  });

  on("turn.step", async function* ($, e, next) {
    const result = yield* next(e);
    if (e.agentId === undefined) await manager?.stepEnded(result.toolUses.length === 0);
    return result;
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined) manager?.turnCompleted();
    return result;
  });

  on("session.end", async ($, e, next) => {
    if (e.reason === "clear") {
      manager?.cleared();
    } else {
      manager?.dispose();
      manager = undefined;
    }
    return next(e);
  });

  on("command.run", { command: PLUGIN }, async ($, e) => ({
    text: (await manager?.command(e.args)) ?? "not started",
  })).catch(() => ({ text: "the command failed; see claude --debug" }));

  // The face sits at the right end of the footer and blinks while a review runs.
  on("ui.render", { component: "SessionMode" }, async ($, e, next) => {
    const face = manager?.face();
    if (!face) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box gap={2}>
        {await next(e)}
        <Text color={faceColor(face)}>{face.text}</Text>
      </Box>
    );
  });
};

function faceColor(face: FooterStatus) {
  return face.animating ? "claude" : FACE_COLORS[face.tone];
}
