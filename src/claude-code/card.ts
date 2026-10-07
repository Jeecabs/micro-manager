import { MICRO_MANAGER_GLYPH, normalizeMicroManagerText, SEVERITY_GLYPHS } from "../core/message-format.ts";
import type { MicroManagerNote, MicroManagerSeverity } from "../core/types.ts";

// ponytail: Latin-1 faces only; wider glyphs fall back to non-mono fonts and break the band
export const SEVERITY_FACES: Record<MicroManagerSeverity, string> = { nit: "¬_¬", concern: "ò_ó", blocker: "Ò_Ó" };

/**
 * The plain-text record of delivered notes, one line per note: `¬_¬ ! [Architecture] note`.
 * Claude Code stores it as a notice row: the transcript file, `claude -p` and the verbose
 * transcript keep it; the live view shows the band instead.
 */
export function formatCard(notes: readonly MicroManagerNote[]): string {
  return notes
    .map((entry) => {
      const source = entry.manager ? `[${entry.manager}] ` : "";
      const note = (normalizeMicroManagerText(entry.note) ?? "").replace(/\s*\n\s*/g, " ");
      return `${MICRO_MANAGER_GLYPH} ${SEVERITY_GLYPHS[entry.severity ?? "nit"]} ${source}${note}`;
    })
    .join("\n");
}

export function worstSeverity(notes: readonly MicroManagerNote[]): MicroManagerSeverity {
  if (notes.some((entry) => entry.severity === "blocker")) return "blocker";
  if (notes.some((entry) => entry.severity === "concern")) return "concern";
  return "nit";
}
