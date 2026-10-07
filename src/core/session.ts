import { FACES, IDLE_HEAD, REACTION_MS, REACTIONS, REVIEW_FRAMES, type Reaction } from "./face.ts";
import { formatMicroManagerBatchContent, isInterruptingSeverity, microManagerMessageDetails } from "./message-format.ts";
import type { ReviewModel, Sleep } from "./model.ts";
import { buildMicroManagerSystemPrompt } from "./prompt.ts";
import { MicroManagerRunner } from "./runner.ts";
import type { Workspace } from "./tools.ts";
import { TranscriptCursor, type HistoryEntry } from "./transcript.ts";
import {
  THINKING_LEVELS,
  type MicroManagerConfiguration,
  type MicroManagerDefinition,
  type MicroManagerMessageDetails,
  type MicroManagerNote,
  type MicroManagerOverallState,
  type MicroManagerRuntimeStats,
  type MicroManagerSeverity,
  type MicroManagerStatusSnapshot,
  type ThinkingLevel,
} from "./types.ts";

const HEADLESS_SETTLE_CAP_MS = 60_000;
const SEVERITY_RANK: Record<MicroManagerSeverity, number> = { nit: 0, concern: 1, blocker: 2 };

export type PrimaryMode = "interactive" | "json" | "print";

export interface PrimaryState {
  mode: PrimaryMode;
  /** True when the primary agent is not running a turn. */
  idle: boolean;
}

/**
 * What the primary session should experience. `show`: a visible card the agent reads on its
 * next turn. `followUp`: delivered once the running turn finishes. `steer`: folded into the
 * running turn. `wake`: start a correction turn now. `record`: session metadata only (print mode).
 */
export type DeliveryKind = "show" | "followUp" | "steer" | "wake" | "record";

export interface Delivery {
  kind: DeliveryKind;
  notes: readonly MicroManagerNote[];
  /** XML-escaped text for the primary model. */
  content: string;
  details: MicroManagerMessageDetails;
}

/** Everything the core needs from a coding-agent host. */
export interface MicroManagerHost {
  /** `selector` is a model selector without a thinking suffix; undefined means the host's default review model. */
  resolveModel(selector: string | undefined, thinking: ThinkingLevel): ReviewModel | undefined;
  readonly workspace: Workspace;
  /** The primary session's current history, oldest first. */
  history(): readonly HistoryEntry[];
  primary(): PrimaryState;
  /** May return a promise; `settle()` waits for it, so settled notes are stored. */
  deliver(delivery: Delivery): void | Promise<void>;
  /** Status, backlog, or usage changed. */
  changed(): void;
  readonly sleep: Sleep;
}

export interface MicroManagerSessionOptions {
  configuration: MicroManagerConfiguration;
  /** A process-level override of `enabled`, such as Pi's `--micro-manager` flag. */
  override?: boolean;
  /** Start from current history instead of reviewing it on the first turn. */
  seed?: boolean;
}

export type FooterTone = "accent" | "dim" | "muted" | "warning" | "error";

export interface FooterStatus {
  text: string;
  tone: FooterTone;
  /** True while review work runs; redraw with the next frame to move the eyes. */
  animating: boolean;
  /** What the face means; a reaction keeps its tone but the state stays `watching`. */
  state: MicroManagerOverallState;
}

/**
 * One primary session's review: the managers, their queues, the transcript cursor,
 * delivery policy, interruption immunity, and headless buffering.
 */
export class MicroManagerSession {
  readonly #host: MicroManagerHost;
  readonly #cursor = new TranscriptCursor();
  #configuration: MicroManagerConfiguration;
  #override: boolean | undefined;
  #runners: MicroManagerRunner[] = [];
  #inactive: MicroManagerRuntimeStats[] = [];
  #epoch = 0;
  #completedTurns = 0;
  #immuneTurnStart: number | undefined;
  #deliveredNotes = 0;
  #pendingHeadless: MicroManagerNote[] = [];
  #reviewCycle: { turns: number; worst?: MicroManagerSeverity } | undefined;
  #reaction: Reaction | undefined;
  #reactionStop: AbortController | undefined;
  #disposed = false;

  constructor(host: MicroManagerHost, options: MicroManagerSessionOptions) {
    this.#host = host;
    this.#configuration = options.configuration;
    this.#override = options.override;
    this.#rebuild(options.seed ?? false);
  }

  get configuration(): MicroManagerConfiguration {
    return this.#configuration;
  }

  get enabled(): boolean {
    return this.#override ?? this.#configuration.settings.enabled;
  }

  /** Enabled with at least one manager whose model resolved. */
  get reviewing(): boolean {
    return this.enabled && this.#runners.length > 0;
  }

  /** Applies reloaded configuration. History so far is not replayed. */
  configure(configuration: MicroManagerConfiguration): void {
    this.#configuration = configuration;
    this.#rebuild(true);
  }

  /** Session-level on or off. Turning on starts from current history. */
  setEnabled(enabled: boolean): void {
    this.#override = enabled;
    if (enabled) {
      this.#rebuild(true);
      return;
    }
    this.#stopRunners();
    this.#clearReaction();
    this.#changed();
  }

  /** The primary model changed; managers that inherit it restart from current history. */
  primaryModelChanged(): void {
    if (this.enabled && configuredDefinitions(this.#configuration).some((definition) => !definition.model)) {
      this.#rebuild(true);
    }
  }

  /** A primary turn ended. Queues new history for every manager and returns at once. */
  turnEnded(): void {
    this.#completedTurns++;
    if (!this.reviewing) return;
    const delta = this.#cursor.next(this.#host.history(), this.#configuration.settings.maxInputChars);
    if (!delta) return;
    if (delta.reset) for (const runner of this.#runners) runner.reset();
    for (const runner of this.#runners) runner.enqueue(delta.text);
    this.#changed();
  }

  /** History was compacted or rewritten. Managers drop their private context. */
  reset(): void {
    this.#cursor.reset();
    this.#reviewCycle = undefined;
    this.#clearReaction();
    this.#pendingHeadless = [];
    for (const runner of this.#runners) runner.reset();
    this.#immuneTurnStart = undefined;
    this.#changed();
  }

  /**
   * Print and JSON modes: waits for final review work, then delivers buffered notes.
   * `maxWaitMs` lowers the 60-second cap for hosts that bound how long a hook may run.
   */
  async settle(maxWaitMs = HEADLESS_SETTLE_CAP_MS): Promise<void> {
    const { mode } = this.#host.primary();
    if (mode === "interactive" || this.#runners.length === 0) return;
    const { timeoutMs, maxAttempts } = this.#configuration.settings;
    const waitMs = Math.min(HEADLESS_SETTLE_CAP_MS, maxWaitMs, timeoutMs * maxAttempts);
    await Promise.all(this.#runners.map((runner) => runner.waitForIdle(waitMs)));
    if (this.#disposed || this.#pendingHeadless.length === 0) return;
    const notes = this.#pendingHeadless;
    this.#pendingHeadless = [];
    await this.#host.deliver(delivery(mode === "print" ? "record" : "show", notes));
  }

  stats(): MicroManagerRuntimeStats[] {
    return [...this.#runners.map((runner) => runner.stats), ...this.#inactive];
  }

  statusText(): string {
    const configuration = this.#configuration;
    const state = this.enabled ? (this.#runners.length > 0 ? "active" : "enabled, unavailable") : "disabled";
    const lines = [`micro-manager: ${state}`];
    lines.push(`config: ${configuration.sources.length > 0 ? configuration.sources.join(", ") : "none"}`);
    if (configuration.projectConfigDetected && !configuration.projectConfigLoaded) {
      lines.push("project config: ignored until project trust is granted");
    }
    if (configuration.errors.length > 0) lines.push(`warnings: ${configuration.errors.length}`);
    if (this.#deliveredNotes > 0) lines.push(`notes delivered: ${this.#deliveredNotes}`);
    for (const stat of this.stats()) {
      const model = stat.model ? ` ${stat.model}` : "";
      const cost = stat.cost === undefined ? "" : `, $${stat.cost.toFixed(4)}`;
      const usage = stat.turns > 0 ? `, ${stat.inputTokens} in/${stat.outputTokens} out${cost}` : "";
      const backlog = stat.backlog > 0 ? `, backlog ${stat.backlog}` : "";
      lines.push(`- ${stat.name}: ${stat.state}${model}${usage}${backlog}`);
      if (stat.lastError) lines.push(`  ${stat.lastError}`);
    }
    return lines.join("\n");
  }

  /** Overall state for status cards; `reviewing` while any backlog exists. */
  overallState(): MicroManagerOverallState {
    const stats = this.stats();
    if (!this.enabled) return "off";
    if (stats.some((stat) => stat.state === "error")) return "error";
    if (this.#runners.length === 0) return stats.some((stat) => stat.state === "no_model") ? "no_model" : "off";
    return stats.some((stat) => stat.backlog > 0) ? "reviewing" : "watching";
  }

  statusSnapshot(): MicroManagerStatusSnapshot {
    const configuration = this.#configuration;
    return {
      state: this.overallState(),
      managers: this.stats().map((stat) => ({
        name: stat.name,
        state: stat.state,
        ...(stat.model ? { model: stat.model } : {}),
        backlog: stat.backlog,
        turns: stat.turns,
        inputTokens: stat.inputTokens,
        outputTokens: stat.outputTokens,
        ...(stat.cost === undefined ? {} : { cost: stat.cost }),
        ...(stat.lastError ? { lastError: stat.lastError } : {}),
      })),
      sources: [...configuration.sources],
      warnings: [...configuration.errors],
      projectConfigIgnored: configuration.projectConfigDetected && !configuration.projectConfigLoaded,
      delivered: this.#deliveredNotes,
    };
  }

  /** The footer face. While `animating`, a host redraws with increasing `frame`s. */
  footer(frame: number): FooterStatus {
    const stats = this.stats();
    const hasError = stats.some((stat) => stat.state === "error");
    const backlog = stats.reduce((sum, stat) => sum + stat.backlog, 0);
    const count = this.#runners.length > 1 ? ` ×${this.#runners.length}` : "";
    if (this.enabled && !hasError && backlog > 0) {
      return { text: REVIEW_FRAMES[frame % REVIEW_FRAMES.length]! + count, tone: "accent", animating: true, state: "reviewing" };
    }
    if (!this.enabled) return { text: `${FACES.asleep} zz`, tone: "dim", animating: false, state: "off" };
    if (hasError) return { text: FACES.error, tone: "error", animating: false, state: "error" };
    if (this.#runners.length === 0) return { text: FACES.confused, tone: "warning", animating: false, state: "no_model" };
    if (this.#reaction) {
      const look = REACTIONS[this.#reaction];
      return { text: `${look.face} ${look.word}`, tone: look.color, animating: false, state: "watching" };
    }
    return { text: IDLE_HEAD + count, tone: "muted", animating: false, state: "watching" };
  }

  dump(): string {
    return this.#runners
      .map((runner) => `# ${runner.stats.name}\n\n${runner.dump() || "(empty)"}`)
      .join("\n\n---\n\n");
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pendingHeadless = [];
    this.#stopRunners();
    this.#clearReaction();
    this.#cursor.reset();
  }

  #rebuild(seed: boolean): void {
    if (this.#disposed) return;
    this.#stopRunners();
    const epoch = this.#epoch;
    this.#inactive = [];
    this.#pendingHeadless = [];
    if (this.enabled) {
      const configuration = this.#configuration;
      for (const definition of configuredDefinitions(configuration)) {
        if (!definition.enabled) {
          this.#inactive.push(emptyStats(definition.name, "paused"));
          continue;
        }
        const selector = definition.model === undefined ? undefined : splitThinkingSuffix(definition.model);
        const model = this.#host.resolveModel(selector?.selector, selector?.thinking ?? definition.thinking);
        if (!model) {
          this.#inactive.push(emptyStats(definition.name, "no_model"));
          continue;
        }
        this.#runners.push(
          new MicroManagerRunner({
            name: definition.name,
            model,
            systemPrompt: buildMicroManagerSystemPrompt(definition, {
              priorityBlocks: configuration.priorityBlocks,
              ...(configuration.sharedInstructions ? { sharedInstructions: configuration.sharedInstructions } : {}),
            }),
            tools: definition.tools,
            workspace: this.#host.workspace,
            sleep: this.#host.sleep,
            timeoutMs: configuration.settings.timeoutMs,
            maxOutputTokens: configuration.settings.maxOutputTokens,
            maxToolRounds: configuration.settings.maxToolRounds,
            maxContextChars: configuration.settings.maxContextChars,
            maxAttempts: configuration.settings.maxAttempts,
            onReport: (note) => {
              if (epoch === this.#epoch) this.#route({ ...note, model: model.label });
            },
            onStateChange: () => {
              if (epoch === this.#epoch) this.#changed();
            },
          }),
        );
      }
    }
    if (seed) this.#cursor.seed(this.#host.history());
    this.#changed();
  }

  #stopRunners(): void {
    this.#epoch++;
    const current = this.#runners;
    this.#runners = [];
    for (const runner of current) runner.dispose();
  }

  /** Every state change goes through here so the face can notice a review cycle ending. */
  #changed(): void {
    this.#observeReviewCycle();
    this.#host.changed();
  }

  /** A review cycle runs while any backlog exists; the face reacts once it drains after real model work. */
  #observeReviewCycle(): void {
    const stats = this.stats();
    const turns = this.#runners.reduce((sum, runner) => sum + runner.stats.turns, 0);
    if (stats.some((stat) => stat.backlog > 0)) {
      this.#reviewCycle ??= { turns };
      return;
    }
    const cycle = this.#reviewCycle;
    this.#reviewCycle = undefined;
    if (!cycle || stats.some((stat) => stat.state === "error") || !this.enabled || turns <= cycle.turns) return;
    this.#react(cycle.worst ?? "clean");
  }

  #react(kind: Reaction): void {
    this.#clearReaction();
    this.#reaction = kind;
    const stop = new AbortController();
    this.#reactionStop = stop;
    // ponytail: the core has no timers, so the reaction expires through the host's abortable sleep
    this.#host.sleep(REACTION_MS, stop.signal).then(
      () => {
        if (this.#reactionStop !== stop) return;
        this.#reactionStop = undefined;
        this.#reaction = undefined;
        this.#host.changed();
      },
      () => {},
    );
  }

  #clearReaction(): void {
    this.#reactionStop?.abort();
    this.#reactionStop = undefined;
    this.#reaction = undefined;
  }

  #route(note: MicroManagerNote): void {
    this.#deliveredNotes++;
    const severity = note.severity ?? "nit";
    if (this.#reviewCycle && SEVERITY_RANK[severity] >= SEVERITY_RANK[this.#reviewCycle.worst ?? "nit"]) {
      this.#reviewCycle.worst = severity;
    }
    const primary = this.#host.primary();
    if (primary.mode !== "interactive") {
      this.#pendingHeadless.push(note);
      this.#changed();
      return;
    }
    const immune =
      this.#immuneTurnStart !== undefined &&
      this.#completedTurns < this.#immuneTurnStart + this.#configuration.settings.immuneTurns;
    const kind = chooseDelivery(note.severity, primary.idle, immune);
    if (kind === "steer" || kind === "wake") this.#immuneTurnStart = this.#completedTurns + 1;
    this.#host.deliver(delivery(kind, [note]));
  }
}

/** Interactive delivery policy. Immunity turns would-be interruptions into quiet notes. */
export function chooseDelivery(
  severity: MicroManagerSeverity | undefined,
  idle: boolean,
  immune: boolean,
): Exclude<DeliveryKind, "record"> {
  if (!isInterruptingSeverity(severity) || immune) return idle ? "show" : "followUp";
  if (!idle) return "steer";
  return severity === "blocker" ? "wake" : "show";
}

/** Splits `provider/model:level` into a selector and a thinking override. */
export function splitThinkingSuffix(value: string): { selector: string; thinking?: ThinkingLevel } {
  const colon = value.lastIndexOf(":");
  if (colon <= value.indexOf("/")) return { selector: value };
  const suffix = value.slice(colon + 1);
  if (!(THINKING_LEVELS as readonly string[]).includes(suffix)) return { selector: value };
  return { selector: value.slice(0, colon), thinking: suffix as ThinkingLevel };
}

function configuredDefinitions(configuration: MicroManagerConfiguration): MicroManagerDefinition[] {
  if (configuration.managers.length > 0) return configuration.managers;
  const definition: MicroManagerDefinition = {
    name: "default",
    enabled: true,
    thinking: configuration.settings.thinking,
    tools: [...configuration.settings.tools],
  };
  if (configuration.settings.model) definition.model = configuration.settings.model;
  return [definition];
}

function delivery(kind: DeliveryKind, notes: readonly MicroManagerNote[]): Delivery {
  return {
    kind,
    notes,
    content: formatMicroManagerBatchContent(notes),
    details: microManagerMessageDetails(notes),
  };
}

function emptyStats(name: string, state: "paused" | "no_model"): MicroManagerRuntimeStats {
  return { name, state, backlog: 0, turns: 0, inputTokens: 0, outputTokens: 0 };
}
