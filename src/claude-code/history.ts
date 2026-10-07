import type { HistoryEntry, TranscriptItem } from "../core/transcript.ts";

/** The fields of a `session.append` event this adapter reads. */
export interface AppendedRow {
  uuid: string;
  door: string;
  origin: { kind: string; name?: string; tool?: string };
  agentId?: string;
  message: { type: string; content: readonly unknown[] };
}

/**
 * The main conversation as review evidence, built from `session.append` rows as the engine
 * stores them (`$.session.messages()` carries no row ids). Thinking, attachments, injected
 * reminders, notices, and this plugin's own rows never become evidence.
 */
export class ClaudeCodeHistory {
  readonly #plugin: string;
  #entries: HistoryEntry[] = [];
  #toolNames = new Map<string, string>();

  constructor(plugin: string) {
    this.#plugin = plugin;
  }

  entries(): readonly HistoryEntry[] {
    return this.#entries;
  }

  clear(): void {
    this.#entries = [];
    this.#toolNames.clear();
  }

  /** Returns `"compacted"` when the row starts a compaction, after which history restarts. */
  record(row: AppendedRow): "compacted" | undefined {
    if (row.agentId !== undefined) return undefined;
    if (row.origin.kind === "plugin" && row.origin.name === this.#plugin) return undefined;
    if (row.door === "compaction" && row.message.type === "system") {
      this.clear();
      return "compacted";
    }
    const items = this.#items(row);
    if (items.length > 0) this.#entries.push({ id: row.uuid, items });
    return undefined;
  }

  #items(row: AppendedRow): TranscriptItem[] {
    const blocks = row.message.content.filter(isRecord);
    if (row.door === "compaction") {
      const text = textOf(blocks);
      return text ? [{ role: "summary", text }] : [];
    }
    if (row.door === "prompt" || row.door === "delivery") {
      const text = textOf(blocks);
      return text ? [{ role: "user", text }] : [];
    }
    if (row.door === "response") {
      return blocks.flatMap((block): TranscriptItem[] => {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          return [{ role: "assistant", text: block.text }];
        }
        if (block.type === "tool_use" && typeof block.name === "string") {
          if (typeof block.id === "string") this.#toolNames.set(block.id, block.name);
          return [{ role: "assistant_tool", tool: block.name, arguments: block.input }];
        }
        return [];
      });
    }
    if (row.door === "tool-result") {
      return blocks.flatMap((block): TranscriptItem[] => {
        if (block.type !== "tool_result") return [];
        const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
        const item: TranscriptItem = {
          role: "tool_result",
          tool: this.#toolNames.get(id) ?? row.origin.tool ?? "unknown",
          error: block.is_error === true,
        };
        const text = typeof block.content === "string" ? block.content.trim() : textOf(asRecords(block.content));
        if (text) item.text = text;
        return [item];
      });
    }
    return [];
  }
}

function textOf(blocks: readonly Record<string, unknown>[]): string {
  return blocks
    .flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : []))
    .join("\n")
    .trim();
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
