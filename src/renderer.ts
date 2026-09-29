import { keyText, type EntryRenderer, type MessageRenderer, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { FACES } from "./face.ts";
import { normalizeMicroManagerText } from "./message-format.ts";
import {
  MICRO_MANAGER_SEVERITIES,
  type MicroManagerMessageDetails,
  type MicroManagerNote,
  type MicroManagerOverallState,
  type MicroManagerReportEntry,
  type MicroManagerSeverity,
  type MicroManagerStatusManager,
  type MicroManagerStatusSnapshot,
} from "./types.ts";

type Color = Parameters<Theme["fg"]>[0];

// ponytail: gutter glyphs stay inside Pi's own glyph set so they share its font fallback behaviour
const SEVERITY_GLYPHS: Record<MicroManagerSeverity, string> = { nit: "·", concern: "!", blocker: "✗" };
const SEVERITY_RANK: Record<MicroManagerSeverity, number> = { nit: 0, concern: 1, blocker: 2 };
const COLLAPSED_NOTES = 3;
const COLLAPSED_NOTE_LINES = 2;
const MAX_NAME_COLUMN = 16;
const MIN_COLUMN_LAYOUT_WIDTH = 56;

export const renderMicroManagerMessage: MessageRenderer<MicroManagerMessageDetails> = (
  message,
  { expanded, outputPad },
  theme,
) => {
  const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(new ReportCard(message.details?.notes ?? [], expanded, theme, sanitize(contentText(message.content))));
  return box;
};

/** Print mode stores reports as session entries; this shows them when the session is resumed in the TUI. */
export const renderMicroManagerReportEntry: EntryRenderer<MicroManagerReportEntry> = (entry, { expanded }, theme) => {
  if (!entry.data) return undefined;
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(new ReportCard(entry.data.details?.notes ?? [], expanded, theme, sanitize(entry.data.content ?? "")));
  return box;
};

export const renderMicroManagerStatus: EntryRenderer<MicroManagerStatusSnapshot> = (entry, { expanded }, theme) => {
  if (!entry.data) return undefined;
  const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
  box.addChild(new StatusCard(entry.data, expanded, theme));
  return box;
};

export function severityColor(severity: MicroManagerSeverity): "muted" | "warning" | "error" {
  if (severity === "blocker") return "error";
  if (severity === "concern") return "warning";
  return "muted";
}

class ReportCard implements Component {
  readonly #notes: MicroManagerNote[];
  readonly #expanded: boolean;
  readonly #theme: Theme;
  readonly #fallback: string;

  constructor(notes: readonly MicroManagerNote[], expanded: boolean, theme: Theme, fallback: string) {
    this.#notes = [...notes].sort((a, b) => rank(b) - rank(a));
    this.#expanded = expanded;
    this.#theme = theme;
    this.#fallback = fallback;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const theme = this.#theme;
    const worst = this.#notes.length > 0 ? (this.#notes[0]!.severity ?? "nit") : undefined;
    const face = worst ? theme.fg(severityColor(worst), theme.bold(FACES[worst])) : theme.fg("accent", theme.bold(FACES.watching));
    const lines = [headerLine(theme, face, this.#tallies(), width)];
    if (this.#notes.length === 0) {
      lines.push(...wrapTextWithAnsi(this.#fallback, width));
      return lines;
    }

    const shown = this.#expanded ? this.#notes : this.#notes.slice(0, COLLAPSED_NOTES);
    const managers = shown.map((entry) => (entry.manager ? sanitize(entry.manager) : ""));
    const column = nameColumn(managers, width);
    let clipped = false;

    shown.forEach((entry, index) => {
      const severity = entry.severity ?? "nit";
      const manager = managers[index]!;
      const inline = column === 0 && manager ? `${theme.fg("dim", manager)} ` : "";
      const indent = 2 + column;
      const body = sanitize(entry.note);
      let wrapped = wrapTextWithAnsi(inline + styleInlineCode(this.#expanded ? body : body.replace(/\s+/g, " "), theme), width - indent);
      if (!this.#expanded && wrapped.length > COLLAPSED_NOTE_LINES) {
        wrapped = wrapped.slice(0, COLLAPSED_NOTE_LINES);
        wrapped[COLLAPSED_NOTE_LINES - 1] = `${truncateToWidth(wrapped[COLLAPSED_NOTE_LINES - 1]!.trimEnd(), width - indent - 1, "")}…`;
        clipped = true;
      }
      const lead = `${theme.fg(severityColor(severity), SEVERITY_GLYPHS[severity])} ${nameCell(theme, manager, column)}`;
      wrapped.forEach((line, lineIndex) => lines.push((lineIndex === 0 ? lead : " ".repeat(indent)) + line));
      if (this.#expanded && entry.model) {
        lines.push(" ".repeat(indent) + theme.fg("dim", truncateToWidth(sanitize(entry.model), width - indent, "…")));
      }
    });

    const hidden = this.#notes.length - shown.length;
    if (hidden > 0 || clipped) {
      const key = keyText("app.tools.expand");
      const more = hidden > 0 ? `+${hidden} more · ` : "";
      lines.push(theme.fg("dim", truncateToWidth(`${more}${key ? `${key} to expand` : "expand to read all"}`, width, "…")));
    }
    return lines;
  }

  #tallies(): string[] {
    const theme = this.#theme;
    const counts: Record<MicroManagerSeverity, number> = { nit: 0, concern: 0, blocker: 0 };
    for (const entry of this.#notes) counts[entry.severity ?? "nit"]++;
    const present = [...MICRO_MANAGER_SEVERITIES].reverse().filter((severity) => counts[severity] > 0);
    if (present.length === 0) return [];
    const worded = present
      .map((severity) => theme.fg(severityColor(severity), `${counts[severity]} ${plural(severity, counts[severity])}`))
      .join(theme.fg("dim", " · "));
    const compact = present
      .map((severity) => theme.fg(severityColor(severity), `${SEVERITY_GLYPHS[severity]}${counts[severity]}`))
      .join(" ");
    return [worded, compact];
  }
}

const STATE_LOOK: Record<MicroManagerOverallState, { face: string; word: string; color: Color }> = {
  watching: { face: FACES.watching, word: "watching", color: "accent" },
  reviewing: { face: FACES.watching, word: "reviewing", color: "accent" },
  off: { face: FACES.asleep, word: "off", color: "dim" },
  error: { face: FACES.error, word: "error", color: "error" },
  no_model: { face: FACES.confused, word: "no model", color: "warning" },
};

const STATE_HINT: Partial<Record<MicroManagerOverallState, string>> = {
  off: "/micro-manager on to start reviewing this session",
  no_model: "set model: in MICRO_MANAGER.yml, then /micro-manager reload",
  error: "/micro-manager dump to inspect · /micro-manager reload to retry",
};

class StatusCard implements Component {
  readonly #status: MicroManagerStatusSnapshot;
  readonly #expanded: boolean;
  readonly #theme: Theme;

  constructor(status: MicroManagerStatusSnapshot, expanded: boolean, theme: Theme) {
    this.#status = status;
    this.#expanded = expanded;
    this.#theme = theme;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const theme = this.#theme;
    const status = this.#status;
    const look = STATE_LOOK[status.state] ?? STATE_LOOK.watching;
    const count = status.managers.length > 1 ? theme.fg("dim", ` · ${status.managers.length} managers`) : "";
    const state = theme.fg(look.color, look.word);
    const lines = [headerLine(theme, theme.fg(look.color, theme.bold(look.face)), [state + count, state], width)];

    const names = status.managers.map((manager) => sanitize(manager.name));
    const column = nameColumn(names, width);
    status.managers.forEach((manager, index) => {
      const [glyph, color] = managerGlyph(manager);
      const name = names[index]!;
      const indent = 2 + column;
      const inline = column === 0 ? `${theme.fg("dim", name)} ` : "";
      const lead = `${theme.fg(color, glyph)} ${nameCell(theme, name, column)}`;
      lines.push(lead + truncateToWidth(inline + this.#managerDetail(manager), width - indent, "…"));
      if (manager.lastError && manager.state === "error") {
        const error = wrapTextWithAnsi(theme.fg("error", sanitize(manager.lastError)), width - indent);
        for (const line of this.#expanded ? error : error.slice(0, 2)) lines.push(" ".repeat(indent) + line);
      }
    });

    const meta = [
      status.delivered > 0 ? `${status.delivered} ${status.delivered === 1 ? "note" : "notes"} delivered` : "",
      status.sources.length > 0 ? status.sources.map(sanitize).join(", ") : "no config file",
    ].filter(Boolean);
    const metaLines = wrapTextWithAnsi(theme.fg("dim", meta.join(" · ")), width);
    lines.push(...(this.#expanded ? metaLines : [truncateToWidth(theme.fg("dim", meta.join(" · ")), width, "…")]));

    if (status.projectConfigIgnored) {
      lines.push(truncateToWidth(theme.fg("warning", "! project config ignored until this project is trusted"), width, "…"));
    }
    if (status.warnings.length > 0) {
      lines.push(theme.fg("warning", `! ${status.warnings.length} config ${status.warnings.length === 1 ? "warning" : "warnings"}`));
      if (this.#expanded) {
        for (const warning of status.warnings) lines.push(...wrapTextWithAnsi(theme.fg("warning", `  ${sanitize(warning)}`), width));
      }
    }
    const hint = STATE_HINT[status.state];
    if (hint) lines.push(truncateToWidth(theme.fg("dim", hint), width, "…"));
    return lines;
  }

  #managerDetail(manager: MicroManagerStatusManager): string {
    const theme = this.#theme;
    const parts = [manager.model ? sanitize(manager.model) : ""];
    if (manager.state === "paused") parts.push(theme.fg("dim", "paused"));
    if (manager.state === "no_model") parts.push(theme.fg("warning", "no model resolved"));
    if (manager.backlog > 0) {
      parts.push(theme.fg("accent", manager.backlog > 1 ? `reviewing · ${manager.backlog - 1} queued` : "reviewing"));
    }
    if (manager.turns > 0) {
      parts.push(
        this.#expanded
          ? `${compactNumber(manager.inputTokens)} in / ${compactNumber(manager.outputTokens)} out`
          : `${compactNumber(manager.inputTokens + manager.outputTokens)} tokens`,
      );
      parts.push(`$${manager.cost.toFixed(manager.cost < 0.1 ? 4 : 2)}`);
    }
    return parts.filter(Boolean).join(theme.fg("dim", " · "));
  }
}

function managerGlyph(manager: MicroManagerStatusManager): [string, Color] {
  if (manager.state === "error") return ["✗", "error"];
  if (manager.state === "no_model") return ["?", "warning"];
  if (manager.state === "paused") return ["○", "dim"];
  return ["◉", "accent"];
}

function headerLine(theme: Theme, face: string, rightOptions: readonly string[], width: number): string {
  const label = `${face} ${theme.fg("customMessageLabel", theme.bold("[micro-manager]"))}`;
  for (const right of rightOptions) {
    const gap = width - visibleWidth(label) - visibleWidth(right);
    if (right && gap >= 2) return label + " ".repeat(gap) + right;
  }
  return truncateToWidth(label, width, "…");
}

function nameColumn(names: readonly string[], width: number): number {
  const longest = Math.max(0, ...names.map((name) => visibleWidth(name)));
  return width >= MIN_COLUMN_LAYOUT_WIDTH && longest > 0 ? Math.min(longest, MAX_NAME_COLUMN) + 2 : 0;
}

function nameCell(theme: Theme, name: string, column: number): string {
  return column > 0 ? theme.fg("dim", truncateToWidth(name, column - 2, "…", true)) + "  " : "";
}

function compactNumber(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function rank(entry: Pick<MicroManagerNote, "severity">): number {
  return SEVERITY_RANK[entry.severity ?? "nit"];
}

function plural(severity: MicroManagerSeverity, count: number): string {
  return count === 1 ? severity : `${severity}s`;
}

function styleInlineCode(text: string, theme: Theme): string {
  return text.replace(/`([^`\n]+)`/g, (_match, code: string) => theme.fg("mdCode", code));
}

function contentText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
}

function sanitize(value: string): string {
  return (normalizeMicroManagerText(value) ?? "").replaceAll("\t", "  ");
}
