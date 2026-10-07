import { MicroManagerEmissionGuard } from "./emission-guard.ts";
import { isMicroManagerSeverity, normalizeMicroManagerText } from "./message-format.ts";
import type { ReviewMessage, ReviewModel, ReviewStep, ReviewToolCall, Sleep, ToolSpec } from "./model.ts";
import {
  boundToolOutput,
  REPORT_TOOL_SPEC,
  runWorkspaceTool,
  validateToolArguments,
  WORKSPACE_TOOL_SPECS,
  type Workspace,
} from "./tools.ts";
import type { MicroManagerNote, MicroManagerRuntimeStats, MicroManagerToolName } from "./types.ts";

const MAX_TOOL_CALLS_PER_RESPONSE = 8;
const MAX_PENDING_UPDATES = 5;

type ToolMessage = Extract<ReviewMessage, { role: "tool" }>;

export interface MicroManagerRunnerOptions {
  name: string;
  model: ReviewModel;
  systemPrompt: string;
  tools: readonly MicroManagerToolName[];
  workspace: Workspace;
  sleep: Sleep;
  timeoutMs: number;
  maxOutputTokens: number;
  maxToolRounds: number;
  maxContextChars: number;
  maxAttempts: number;
  onReport(note: MicroManagerNote): void;
  onStateChange?(): void;
  retryDelayMs?: number;
}

export class MicroManagerRunner {
  readonly #guard = new MicroManagerEmissionGuard();
  readonly #maxAttempts: number;
  readonly #maxContextChars: number;
  readonly #maxOutputTokens: number;
  readonly #maxToolRounds: number;
  readonly #model: ReviewModel;
  readonly #name: string;
  readonly #onReport: (note: MicroManagerNote) => void;
  readonly #onStateChange: (() => void) | undefined;
  readonly #retryDelayMs: number;
  readonly #sleep: Sleep;
  readonly #systemPrompt: string;
  readonly #timeoutMs: number;
  readonly #toolNames: ReadonlySet<string>;
  readonly #toolResultChars: number;
  readonly #toolSpecs: ToolSpec[];
  readonly #workspace: Workspace;
  #busy = false;
  #disposed = false;
  #epoch = 0;
  #idleWaiters: Array<() => void> = [];
  #iterationAbort: AbortController | undefined;
  #messages: ReviewMessage[] = [];
  #pending: string[] = [];
  #stats: MicroManagerRuntimeStats;

  constructor(options: MicroManagerRunnerOptions) {
    this.#name = options.name;
    this.#model = options.model;
    this.#systemPrompt = options.systemPrompt;
    this.#toolNames = new Set(options.tools);
    this.#toolSpecs = [REPORT_TOOL_SPEC, ...options.tools.map((name) => WORKSPACE_TOOL_SPECS[name])];
    this.#workspace = options.workspace;
    this.#sleep = options.sleep;
    this.#timeoutMs = options.timeoutMs;
    this.#maxOutputTokens = options.maxOutputTokens;
    this.#maxToolRounds = options.maxToolRounds;
    this.#maxContextChars = options.maxContextChars;
    this.#maxAttempts = options.maxAttempts;
    this.#retryDelayMs = options.retryDelayMs ?? 500;
    this.#toolResultChars = Math.max(
      500,
      Math.min(
        8_000,
        Math.floor(options.maxContextChars / (2 * Math.max(1, options.maxToolRounds) * MAX_TOOL_CALLS_PER_RESPONSE)),
      ),
    );
    this.#onReport = options.onReport;
    this.#onStateChange = options.onStateChange;
    this.#stats = {
      name: options.name,
      state: "running",
      model: options.model.label,
      backlog: 0,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  get stats(): MicroManagerRuntimeStats {
    return { ...this.#stats, backlog: this.backlog };
  }

  get backlog(): number {
    return this.#pending.length + (this.#busy ? 1 : 0);
  }

  dump(): string {
    return this.#messages
      .map((message) => {
        if (message.role === "user") return `## Update\n\n${message.text}`;
        if (message.role === "assistant") return `## The Micro Manager\n\n${message.text || "(tool calls or silence)"}`;
        return `## Tool: ${message.name}${message.isError ? " (error)" : ""}\n\n${message.text}`;
      })
      .join("\n\n");
  }

  /** Resolves true once the backlog drains, false when `timeoutMs` passes first. */
  async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.#disposed || this.backlog === 0) return this.backlog === 0;
    const stop = new AbortController();
    const idle = new Promise<boolean>((resolve) => this.#idleWaiters.push(() => resolve(true)));
    const timedOut = this.#sleep(Math.max(0, timeoutMs), stop.signal).then(
      () => false,
      () => false,
    );
    try {
      return await Promise.race([idle, timedOut]);
    } finally {
      stop.abort();
    }
  }

  enqueue(update: string): void {
    if (this.#disposed || !update.trim()) return;
    if (this.#pending.length >= MAX_PENDING_UPDATES) {
      const last = this.#pending.length - 1;
      this.#pending[last] = `${this.#pending[last]}\n\n${update}`;
    } else {
      this.#pending.push(update);
    }
    this.#notifyState();
    void this.#drain();
  }

  reset(): void {
    if (this.#disposed) return;
    this.#epoch++;
    this.#iterationAbort?.abort("micro-manager reset");
    this.#pending = [];
    this.#messages = [];
    this.#guard.reset();
    this.#stats.state = "running";
    delete this.#stats.lastError;
    this.#notifyState();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#epoch++;
    this.#iterationAbort?.abort("micro-manager disposed");
    this.#pending = [];
    this.#stats.state = "paused";
    this.#notifyState();
  }

  async #drain(): Promise<void> {
    if (this.#busy || this.#disposed) return;
    this.#busy = true;
    this.#notifyState();
    try {
      while (!this.#disposed && this.#pending.length > 0) {
        const update = this.#pending.splice(0).join("\n\n");
        const epoch = this.#epoch;
        const abort = new AbortController();
        this.#iterationAbort = abort;
        try {
          await this.#reviewWithRetries(update, abort.signal, epoch);
          if (epoch !== this.#epoch) continue;
          this.#stats.state = "running";
          delete this.#stats.lastError;
        } catch (error) {
          if (epoch !== this.#epoch || abort.signal.aborted || this.#disposed) continue;
          this.#stats.state = "error";
          this.#stats.lastError = errorMessage(error);
        } finally {
          if (this.#iterationAbort === abort) this.#iterationAbort = undefined;
          this.#notifyState();
        }
      }
    } finally {
      this.#busy = false;
      this.#notifyState();
    }
  }

  async #reviewWithRetries(update: string, parentSignal: AbortSignal, epoch: number): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      if (parentSignal.aborted || epoch !== this.#epoch) return;
      const snapshot = this.#messages;
      const snapshotLength = snapshot.length;
      try {
        await this.#review(update, parentSignal, epoch);
        return;
      } catch (error) {
        lastError = error;
        if (parentSignal.aborted || epoch !== this.#epoch) throw error;
        this.#messages.length = this.#messages === snapshot ? snapshotLength : 0;
        if (attempt >= this.#maxAttempts) throw error;
        if (this.#retryDelayMs > 0) await this.#sleep(this.#retryDelayMs, parentSignal);
      }
    }
    throw lastError;
  }

  async #review(update: string, parentSignal: AbortSignal, epoch: number): Promise<void> {
    const updateMessage: ReviewMessage = {
      role: "user",
      text: boundUpdate(update, Math.max(1_000, Math.floor(this.#maxContextChars / 2))),
    };
    if (contextChars([...this.#messages, updateMessage]) > this.#maxContextChars) {
      this.#messages = [];
      this.#guard.reset();
    }
    this.#guard.beginUpdate();
    this.#messages.push(updateMessage);

    const timeout = new AbortController();
    const attemptDone = new AbortController();
    this.#sleep(this.#timeoutMs, attemptDone.signal).then(
      () => timeout.abort("micro-manager update timed out"),
      () => {},
    );
    const signal = AbortSignal.any([parentSignal, timeout.signal]);
    try {
      for (let round = 0; round <= this.#maxToolRounds; round++) {
        signal.throwIfAborted();
        if (epoch !== this.#epoch || contextChars(this.#messages) > this.#maxContextChars) return;
        let step: ReviewStep;
        try {
          step = await this.#model.step({
            system: this.#systemPrompt,
            messages: [...this.#messages],
            tools: this.#toolSpecs,
            maxOutputTokens: this.#maxOutputTokens,
            timeoutMs: this.#timeoutMs,
            signal,
          });
        } catch (error) {
          signal.throwIfAborted();
          throw error;
        }
        signal.throwIfAborted();
        if (epoch !== this.#epoch) return;
        this.#recordUsage(step);
        this.#messages.push({
          role: "assistant",
          text: step.text,
          calls: step.calls,
          ...(step.native === undefined ? {} : { native: step.native }),
        });

        if (step.stop === "aborted") {
          signal.throwIfAborted();
          throw new Error(step.error || "micro-manager provider aborted the request");
        }
        if (step.stop === "error") throw new Error(step.error || "micro-manager provider returned an error");
        if (step.stop === "length") throw new Error("micro-manager response reached its output-token limit");

        if (step.calls.length === 0) return;
        const toolLimitReached = round >= this.#maxToolRounds;
        const results = await Promise.all(
          step.calls.map((call, index) => {
            if (index >= MAX_TOOL_CALLS_PER_RESPONSE && call.name !== "report") {
              return { message: errorResult(call, "Micro-manager tool-call limit reached for this response"), reported: false };
            }
            if (toolLimitReached && call.name !== "report") {
              return { message: errorResult(call, "Micro-manager read-only tool-round limit reached"), reported: false };
            }
            return this.#executeToolCall(call, signal);
          }),
        );
        signal.throwIfAborted();
        if (epoch !== this.#epoch) return;
        this.#messages.push(...results.map((entry) => entry.message));
        if (results.some((entry) => entry.reported) || toolLimitReached) return;
      }
    } finally {
      attemptDone.abort();
    }
  }

  async #executeToolCall(call: ReviewToolCall, signal: AbortSignal): Promise<{ message: ToolMessage; reported: boolean }> {
    if (call.name === "report") return this.#executeReport(call);
    if (!this.#toolNames.has(call.name)) {
      return { message: errorResult(call, `Tool ${call.name} is not available`), reported: false };
    }
    try {
      const output = await runWorkspaceTool(
        this.#workspace,
        call.name as MicroManagerToolName,
        call.arguments,
        call.id,
        signal,
      );
      return { message: textResult(call, boundToolOutput(output, this.#toolResultChars)), reported: false };
    } catch (error) {
      return { message: errorResult(call, errorMessage(error)), reported: false };
    }
  }

  #executeReport(call: ReviewToolCall): { message: ToolMessage; reported: boolean } {
    try {
      const args = validateToolArguments(REPORT_TOOL_SPEC, call.arguments);
      const note = normalizeMicroManagerText(String(args.note));
      const severity = isMicroManagerSeverity(args.severity) ? args.severity : undefined;
      if (note && this.#guard.accept(note)) {
        const report: MicroManagerNote = { note };
        if (severity) report.severity = severity;
        if (this.#name !== "default") report.manager = this.#name;
        this.#onReport(report);
      }
      return { message: textResult(call, "Recorded."), reported: true };
    } catch (error) {
      return { message: errorResult(call, errorMessage(error)), reported: true };
    }
  }

  #recordUsage(step: ReviewStep): void {
    this.#stats.turns++;
    this.#stats.inputTokens += step.usage.input;
    this.#stats.outputTokens += step.usage.output;
    if (step.usage.cost !== undefined) this.#stats.cost = (this.#stats.cost ?? 0) + step.usage.cost;
  }

  #notifyState(): void {
    this.#stats.backlog = this.backlog;
    if (this.backlog === 0 || this.#disposed) {
      const waiters = this.#idleWaiters;
      this.#idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
    this.#onStateChange?.();
  }
}

function textResult(call: ReviewToolCall, text: string): ToolMessage {
  return { role: "tool", callId: call.id, name: call.name, text, isError: false };
}

function errorResult(call: ReviewToolCall, text: string): ToolMessage {
  const bounded = text.length > 2_000 ? `${text.slice(0, 1_976)}\n[error truncated]` : text;
  return { ...textResult(call, bounded), isError: true };
}

function boundUpdate(update: string, maxChars: number): string {
  if (update.length <= maxChars) return update;
  const suffix = "\n\n[earlier update content truncated]";
  return `${update.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

// ponytail: counts what the core sees, not adapter `native` records; reasoning is capped by max_output_tokens
function contextChars(messages: readonly ReviewMessage[]): number {
  try {
    return JSON.stringify(messages, (key, value) => (key === "native" ? undefined : value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
