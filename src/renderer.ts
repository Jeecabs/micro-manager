import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { normalizeMicroManagerText } from "./message-format.ts";
import type { MicroManagerMessageDetails, MicroManagerSeverity } from "./types.ts";

export const renderMicroManagerMessage: MessageRenderer<MicroManagerMessageDetails> = (
  message,
  { expanded, outputPad },
  theme,
) => {
  const notes = message.details?.notes ?? [];
  const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
  const blockerCount = notes.filter((note) => note.severity === "blocker").length;
  const summary = blockerCount > 0 ? `${notes.length} notes · ${blockerCount} blocker` : `${notes.length} notes`;
  box.addChild(new Text(`${theme.fg("accent", theme.bold("The Micro Manager"))} ${theme.fg("dim", summary)}`, 0, 0));

  const shown = expanded ? notes : notes.slice(0, 3);
  for (const entry of shown) {
    const severity = entry.severity ?? "nit";
    const source = entry.manager ? ` [${sanitize(entry.manager)}]` : "";
    const prefix = theme.fg(severityColor(severity), `${severity}${source}`);
    box.addChild(new Text(`${prefix}\n${sanitize(entry.note)}`, 0, 0));
  }
  if (shown.length < notes.length) {
    box.addChild(new Text(theme.fg("dim", `… ${notes.length - shown.length} more`), 0, 0));
  }
  if (notes.length === 0) box.addChild(new Text(sanitize(contentText(message.content)), 0, 0));
  return box;
};

function severityColor(severity: MicroManagerSeverity): "muted" | "warning" | "error" {
  if (severity === "blocker") return "error";
  if (severity === "concern") return "warning";
  return "muted";
}

function contentText(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === "string") return content;
  return content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
}

function sanitize(value: string): string {
  return (normalizeMicroManagerText(value) ?? "").replaceAll("\t", "  ");
}
