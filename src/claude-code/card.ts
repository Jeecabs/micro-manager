import { normalizeMicroManagerText, SEVERITY_GLYPHS } from "../core/message-format.ts";
import type { MicroManagerNote, MicroManagerSeverity } from "../core/types.ts";

// ponytail: Latin-1 faces only; wider glyphs fall back to non-mono fonts and break alignment
export const SEVERITY_FACES: Record<MicroManagerSeverity, string> = { nit: "¬_¬", concern: "ò_ó", blocker: "Ò_Ó" };

/**
 * Delivered notes as plain text, one line per note: `ò_ó ! [Architecture] note`, the face
 * escalating with severity. The live transcript shows each line as the note reaches the model;
 * a notice row keeps them for the transcript file, `claude -p` and the verbose transcript.
 */
export function formatCard(notes: readonly MicroManagerNote[]): string {
  return notes
    .map((entry) => {
      const source = entry.manager ? `[${entry.manager}] ` : "";
      const note = (normalizeMicroManagerText(entry.note) ?? "").replace(/\s*\n\s*/g, " ");
      const severity = entry.severity ?? "nit";
      return `${SEVERITY_FACES[severity]} ${SEVERITY_GLYPHS[severity]} ${source}${note}`;
    })
    .join("\n");
}
