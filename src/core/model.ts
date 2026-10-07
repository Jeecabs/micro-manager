/**
 * The review-model seam. A host adapter turns one request into one provider call:
 * Pi through native tool calling, Claude Code through a text protocol.
 */

export interface JsonSchemaProperty {
  type: "string" | "integer" | "number" | "boolean";
  description?: string;
  enum?: readonly string[];
  minLength?: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Readonly<Record<string, JsonSchemaProperty>>;
    required: readonly string[];
  };
}

export interface ReviewToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ReviewMessage =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      calls: ReviewToolCall[];
      /** The adapter's own record of this reply, handed back to it unchanged on later steps. */
      native?: unknown;
    }
  | { role: "tool"; callId: string; name: string; text: string; isError: boolean };

export interface ReviewUsage {
  input: number;
  output: number;
  cost?: number;
}

export interface ReviewRequest {
  system: string;
  messages: readonly ReviewMessage[];
  tools: readonly ToolSpec[];
  maxOutputTokens: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ReviewStep {
  text: string;
  calls: ReviewToolCall[];
  usage: ReviewUsage;
  /** `tool` and `end` are normal; the rest fail the attempt. */
  stop: "end" | "tool" | "length" | "aborted" | "error";
  error?: string;
  native?: unknown;
}

export interface ReviewModel {
  /** Shown in status and on notes, such as `anthropic/claude-sonnet-4-6`. */
  readonly label: string;
  /** Rejects or resolves `aborted` when `signal` aborts. Thinking level is bound by the host. */
  step(request: ReviewRequest): Promise<ReviewStep>;
}

/** Resolves after `ms`; rejects with `signal.reason` once `signal` aborts. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;
