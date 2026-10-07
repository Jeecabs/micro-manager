import type { Register } from "claude-code";
import { SEVERITY_GLYPHS } from "../core/message-format.ts";
import type { FooterStatus } from "../core/session.ts";
import { ClaudeCodeMicroManager } from "./adapter.ts";
import { SEVERITY_FACES, worstSeverity } from "./card.ts";

// The Claude Code entry point. A mod may only spell `$` at its call sites, so this file
// hands the adapter closures over `session.start`'s `$` and forwards events; nothing else.

const PLUGIN = "micro-manager";
const SEVERITY_COLORS = { nit: "subtle", concern: "warning", blocker: "error" } as const;
const FACE_COLORS = { accent: "claude", dim: "inactive", muted: "subtle", warning: "warning", error: "error" } as const;
// ponytail: a longer manager name is cut so the notes keep their column
const MANAGER_COLUMNS = 16;

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

  on("prompt.submit", async ($, e, next) => {
    if (e.origin.kind === "composer" || e.origin.kind === "bridge") manager?.promptSubmitted();
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

  // Delivered notes wait in the band above the prompt until the person's next prompt.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const notes = manager?.band() ?? [];
    if (notes.length === 0 || e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e);
    const { Box, Markdown, Text } = $.ui.resolve(e);
    const worst = worstSeverity(notes);
    const managerWidth = Math.min(MANAGER_COLUMNS, Math.max(0, ...notes.map((note) => note.manager?.length ?? 0)));
    return (
      <Box gap={2}>
        <Text bold color={SEVERITY_COLORS[worst]}>
          {SEVERITY_FACES[worst]}
        </Text>
        <Box flexDirection="column" flexShrink={1}>
          {notes.map((note, index) => {
            const severity = note.severity ?? "nit";
            return (
              <Box key={`note-${index}`} gap={1}>
                <Text color={SEVERITY_COLORS[severity]}>{SEVERITY_GLYPHS[severity]}</Text>
                {managerWidth > 0 ? (
                  <Box width={managerWidth} flexShrink={0}>
                    <Text bold wrap="truncate-end">
                      {note.manager ?? ""}
                    </Text>
                  </Box>
                ) : null}
                <Box flexShrink={1}>
                  <Markdown text={note.note} />
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  });
};

function faceColor(face: FooterStatus) {
  return face.animating ? "claude" : FACE_COLORS[face.tone];
}
