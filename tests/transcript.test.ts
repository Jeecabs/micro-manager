import assert from "node:assert/strict";
import test from "node:test";
import { serializeTranscriptItems, TranscriptCursor } from "../src/core/transcript.ts";
import { piHistory } from "../src/pi/transcript.ts";

const entries = [
  {
    type: "message",
    id: "u1",
    message: { role: "user", content: [{ type: "text", text: "Fix the queue." }] },
  },
  {
    type: "message",
    id: "a1",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "Hidden chain of thought" },
        { type: "text", text: "I will inspect it." },
        {
          type: "toolCall",
          id: "call-1",
          name: "read",
          arguments: { path: "src/queue.ts", token: "sk-supersecretvalue123" },
        },
      ],
    },
  },
  {
    type: "message",
    id: "t1",
    message: {
      role: "toolResult",
      toolName: "read",
      isError: false,
      content: [{ type: "text", text: "Authorization: Bearer secret-token-value" }],
    },
  },
  {
    type: "message",
    id: "manager-1",
    message: { role: "custom", customType: "micro-manager", content: "Do not recurse." },
  },
];

function excerpt(source: readonly unknown[], maxChars: number): string {
  return serializeTranscriptItems(piHistory(source).flatMap((entry) => entry.items), maxChars) ?? "";
}

test("renders useful transcript evidence while omitting thinking and prior report", () => {
  const text = excerpt(entries, 20_000);
  assert.match(text, /Fix the queue/);
  assert.match(text, /src\/queue\.ts/);
  assert.match(text, /\[REDACTED\]/);
  assert.match(text, /Bearer \[REDACTED\]/);
  assert.doesNotMatch(text, /sk-supersecretvalue123/);
  assert.doesNotMatch(text, /Hidden chain of thought/);
  assert.doesNotMatch(text, /Do not recurse/);
});

test("cursor emits only new entries on append-only history", () => {
  const cursor = new TranscriptCursor();
  const first = cursor.next(piHistory(entries), 20_000);
  assert.match(first?.text ?? "", /Fix the queue/);
  const nextEntries = [
    ...entries,
    {
      type: "message",
      id: "a2",
      message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Queue fixed." }] },
    },
  ];
  const second = cursor.next(piHistory(nextEntries), 20_000);
  assert.equal(second?.reset, false);
  assert.match(second?.text ?? "", /Queue fixed/);
  assert.doesNotMatch(second?.text ?? "", /Fix the queue/);
  assert.equal(cursor.next(piHistory(nextEntries), 20_000), undefined);
});

test("cursor replays bounded current history after a branch rewrite", () => {
  const cursor = new TranscriptCursor();
  cursor.seed(piHistory(entries));
  const rewritten = [
    {
      type: "message",
      id: "new-user",
      message: { role: "user", content: "Take another approach." },
    },
  ];
  const delta = cursor.next(piHistory(rewritten), 20_000);
  assert.equal(delta?.reset, true);
  assert.match(delta?.text ?? "", /another approach/);
});

test("total excerpt respects its hard character budget", () => {
  const huge = [
    {
      type: "message",
      id: "huge",
      message: { role: "toolResult", toolName: "read", content: "x".repeat(100_000), isError: false },
    },
  ];
  const text = excerpt(huge, 2_000);
  assert.ok(text.length <= 2_000, `expected <= 2000 chars, got ${text.length}`);
  assert.match(text, /…/);
});
