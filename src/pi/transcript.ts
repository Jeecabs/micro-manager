import type { HistoryEntry, TranscriptItem } from "../core/transcript.ts";

const PRIMARY_CONTEXT_TYPES = new Set(["plan-mode-context", "plan-mode-reference"]);

/**
 * Maps Pi session-branch entries to review evidence. Hidden reasoning, images, and prior
 * micro-manager messages never become items; redaction happens later, in the core.
 */
export function piHistory(entries: readonly unknown[]): HistoryEntry[] {
  return entries.map((entry, index) => ({ id: entryIdentity(entry, index), items: extractEntryItems(entry) }));
}

function extractEntryItems(entry: unknown): TranscriptItem[] {
  if (!isRecord(entry)) return [];
  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return [{ role: "summary", text: entry.summary }];
  }
  if (entry.type !== "message" || !isRecord(entry.message)) return [];
  const message = entry.message;
  if (message.role === "user") return extractUserItem(message);
  if (message.role === "assistant") return extractAssistantItems(message);
  if (message.role === "toolResult") return extractToolResultItem(message);
  if (message.role === "custom") return extractPrimaryContextItem(message);
  return [];
}

function extractUserItem(message: Record<string, unknown>): TranscriptItem[] {
  const text = textContent(message.content);
  return text ? [{ role: "user", text }] : [];
}

function extractAssistantItems(message: Record<string, unknown>): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const content = Array.isArray(message.content) ? message.content : [];
  for (const block of content) {
    const item = extractAssistantBlock(block, message.stopReason);
    if (item) items.push(item);
  }
  return items;
}

function extractAssistantBlock(block: unknown, stopReason: unknown): TranscriptItem | undefined {
  if (!isRecord(block)) return undefined;
  if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
    const item: TranscriptItem = { role: "assistant", text: block.text };
    if (typeof stopReason === "string") item.stopReason = stopReason;
    return item;
  }
  if (block.type !== "toolCall" || typeof block.name !== "string") return undefined;
  const item: TranscriptItem = { role: "assistant_tool", tool: block.name };
  if ("arguments" in block) item.arguments = block.arguments;
  return item;
}

function extractToolResultItem(message: Record<string, unknown>): TranscriptItem[] {
  const text = textContent(message.content);
  const item: TranscriptItem = {
    role: "tool_result",
    tool: typeof message.toolName === "string" ? message.toolName : "unknown",
    error: message.isError === true,
  };
  if (text) item.text = text;
  return [item];
}

function extractPrimaryContextItem(message: Record<string, unknown>): TranscriptItem[] {
  if (
    typeof message.customType !== "string" ||
    !PRIMARY_CONTEXT_TYPES.has(message.customType) ||
    typeof message.content !== "string"
  ) {
    return [];
  }
  return [{ role: "primary_context", kind: message.customType, text: message.content }];
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string" ? [block.text] : [],
    )
    .join("\n")
    .trim();
}

function entryIdentity(entry: unknown, index: number): string {
  if (isRecord(entry) && typeof entry.id === "string") return entry.id;
  return `index:${index}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
