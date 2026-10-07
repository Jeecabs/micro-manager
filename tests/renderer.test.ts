import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderMicroManagerMessage } from "../src/pi/renderer.ts";

test("removes terminal controls from persisted names and notes", () => {
  const theme = {
    bg: (_color: string, text: string) => text,
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
  const component = renderMicroManagerMessage(
    {
      role: "custom",
      customType: "micro-manager",
      content: "",
      display: true,
      timestamp: Date.now(),
      details: {
        notes: [
          {
            note: "safe\u001b]0;unsafe\u0007 note",
            manager: "\u001b]0;unsafe\u0007Architecture",
            severity: "nit",
          },
        ],
      },
    },
    { expanded: false, outputPad: 0 },
    theme,
  );

  assert.ok(component);
  const rendered = JSON.stringify(component.render(120));
  assert.doesNotMatch(rendered, /[\u001b\u0007\u202e]/);
  assert.match(rendered, /Architecture/);
  assert.match(rendered, /safe note/);
});

test("sorts blockers first so a collapsed card never hides them", () => {
  const theme = {
    bg: (_color: string, text: string) => text,
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
  const nit = { note: "minor", severity: "nit" as const };
  const component = renderMicroManagerMessage(
    {
      role: "custom",
      customType: "micro-manager",
      content: "",
      display: true,
      timestamp: Date.now(),
      details: { notes: [nit, nit, nit, { note: "drops the batch", severity: "blocker" }] },
    },
    { expanded: false, outputPad: 0 },
    theme,
  );

  assert.ok(component);
  const lines = component.render(80);
  const body = lines.filter((line) => line.trim());
  assert.match(body[0]!, /\(ò_ó\) \[micro-manager\]\s+1 blocker · 3 nits/);
  assert.match(body[1]!, /✗ drops the batch/);
  assert.match(body.at(-1)!, /\+1 more/);
});
