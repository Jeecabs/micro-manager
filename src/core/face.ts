import type { MicroManagerSeverity } from "./types.ts";

// ponytail: faces stay ASCII/Latin-1 — ಠ and ✖ render double-width in some fonts and break alignment
export const FACES = {
  watching: "(¬_¬)",
  nit: "(-_-)",
  concern: "(¬_¬)",
  blocker: "(ò_ó)",
  error: "(×_×)",
  confused: "(?_?)",
  asleep: "(-_-)",
} as const;

// Footer heads share one 6-cell frame so the eyes can move without shifting neighbouring statuses.
export const IDLE_HEAD = "(¬_¬ )";
export const REVIEW_FRAMES = [
  "(¬_¬ )",
  "(¬_¬ )",
  "(¬_¬ )",
  "(¬_¬ )",
  "( ¬_¬)",
  "( ¬_¬)",
  "( ¬_¬)",
  "( -_-)",
  "( ¬_¬)",
  "( ¬_¬)",
] as const;
export const REVIEW_FRAME_MS = 400;

export type Reaction = MicroManagerSeverity | "clean";
export const REACTION_MS = 5_000;

export const REACTIONS: Record<Reaction, { face: string; word: string; color: "muted" | "warning" | "error" }> = {
  clean: { face: FACES.watching, word: "fine.", color: "muted" },
  nit: { face: FACES.nit, word: "sigh.", color: "muted" },
  concern: { face: FACES.concern, word: "hm.", color: "warning" },
  blocker: { face: FACES.blocker, word: "stop.", color: "error" },
};
