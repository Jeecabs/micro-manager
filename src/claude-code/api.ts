/**
 * The part of the Claude Code mods API (`$`) this adapter uses. A mod may not store or pass
 * `$` itself, so `register.ts` implements this interface with closures over the `$` of
 * `session.start`, and everything else stays testable without the engine.
 */
export interface ClaudeCodeApi {
  /** `$.model.complete`; resolves a result for every provider outcome, rejects only on a refused request. */
  completeModel(request: ClaudeCodeModelRequest, signal: AbortSignal): Promise<ClaudeCodeModelResult>;
  cwd(): Promise<string>;
  /** The environment variables configuration discovery reads; `$.env.get` takes literal names only. */
  configEnv(): Promise<Record<"CLAUDE_CONFIG_DIR" | "HOME" | "USERPROFILE", string | undefined>>;
  /** Empty in a plain `claude -p` run. */
  surfaces(): Promise<readonly string[]>;
  exists(path: string): Promise<boolean>;
  /** Follows links for `kind` and `size`; `isLink` describes the path itself. */
  stat(path: string, options?: { resolve: boolean }): Promise<ClaudeCodeFileStat>;
  read(path: string): Promise<string>;
  list(path: string): Promise<readonly ClaudeCodeDirEntry[]>;
  run(argv: readonly string[], init: { cwd: string; timeoutMs: number }): Promise<ClaudeCodeProcessResult>;
  /**
   * `type: "user"`: a hidden row the model reads at its next step. `"system"`: a notice row the
   * model never reads, kept in the transcript file and shown only in the verbose transcript.
   */
  append(type: "user" | "system", text: string): Promise<void>;
  /** Starts a turn with this prompt once the session is idle. */
  submit(text: string): Promise<void>;
  /** A warning line under the prompt on every surface; undefined removes it. */
  status(text: string | undefined): void;
  /** Redraws the band and the footer face from the adapter's current state. */
  redraw(): void;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** `$.clock.every`: calls `fn` every `ms` until cancelled or the module reloads. */
  every(ms: number, fn: () => void): { cancel(): void };
}

export type ClaudeCodeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeCodeModelRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  effort: ClaudeCodeEffort;
  timeoutMs: number;
}

export interface ClaudeCodeModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export type ClaudeCodeModelResult =
  | { isAnswered: true; text: string; usage: ClaudeCodeModelUsage }
  | { isAnswered: false; reason: string; status?: number | null; error?: string; usage?: ClaudeCodeModelUsage };

export interface ClaudeCodeFileStat {
  kind: "file" | "dir" | "other";
  size: number;
  isLink: boolean;
  realPath?: string;
}

export interface ClaudeCodeDirEntry {
  name: string;
  kind: "file" | "dir" | "other";
}

export interface ClaudeCodeProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
