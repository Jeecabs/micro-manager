import { REVIEW_FRAME_MS } from "../core/face.ts";
import { runMicroManagerCommand } from "../core/commands.ts";
import { MicroManagerSession, type Delivery, type FooterStatus, type MicroManagerHost } from "../core/session.ts";
import type { MicroManagerNote } from "../core/types.ts";
import type { ClaudeCodeApi } from "./api.ts";
import { formatCard } from "./card.ts";
import { CLAUDE_CODE_CONFIG_DIR_NAME, discoverClaudeCodeConfiguration } from "./config.ts";
import { ClaudeCodeHistory, type AppendedRow } from "./history.ts";
import { resolveClaudeCodeModel } from "./model.ts";
import { createClaudeCodeWorkspace } from "./workspace.ts";

// Claude Code gives a hook 10 seconds; a `claude -p` run waits this long for the final review.
const HEADLESS_SETTLE_MS = 8_000;
const BLINK_INTERVAL_MS = REVIEW_FRAME_MS;
// The band stays glanceable; every note is still in the transcript and with the model.
const BAND_LIMIT = 3;
const SEVERITY_RANK = { nit: 0, concern: 1, blocker: 2 } as const;

/**
 * The Micro Manager inside one Claude Code session. `register.ts` forwards engine events
 * here; everything with an opinion lives in the core `MicroManagerSession`.
 */
export class ClaudeCodeMicroManager {
  readonly #api: ClaudeCodeApi;
  readonly #history: ClaudeCodeHistory;
  #session: MicroManagerSession | undefined;
  #cwd = "";
  #headless = false;
  #busy = false;
  #followUps: Delivery[] = [];
  #band: readonly MicroManagerNote[] = [];
  #problem: string | undefined;
  #blink: { cancel(): void } | undefined;
  #blinkFrame = 0;
  #disposed = false;

  constructor(plugin: string, api: ClaudeCodeApi) {
    this.#api = api;
    this.#history = new ClaudeCodeHistory(plugin);
  }

  async start(): Promise<void> {
    this.#cwd = await this.#api.cwd();
    this.#headless = (await this.#api.surfaces()).length === 0;
    const configuration = await discoverClaudeCodeConfiguration(this.#api, this.#cwd);
    if (this.#disposed) return;
    this.#session = new MicroManagerSession(this.#host(), { configuration });
    this.#refreshStatus();
  }

  /** Every `session.append` row, before it is stored. */
  record(row: AppendedRow): void {
    if (this.#history.record(row) === "compacted") this.#session?.reset();
  }

  /** Notes for the band above the prompt, oldest first; they stay until the person's next prompt. */
  band(): readonly MicroManagerNote[] {
    return this.#band;
  }

  /** The footer face; undefined before the session starts. */
  face(): FooterStatus | undefined {
    return this.#disposed ? undefined : this.#session?.footer(this.#blinkFrame);
  }

  /** The person sent a prompt, so they have seen the band. */
  promptSubmitted(): void {
    if (this.#band.length === 0) return;
    this.#band = [];
    this.#api.redraw();
  }

  /** A main-loop turn began. */
  turnStarted(): void {
    this.#busy = true;
  }

  /**
   * A main-loop model response finished streaming; its rows are stored, and the previous
   * step's tool results with them. In `-p`, the final step waits for review here: Claude Code
   * keeps a headless run's rows only while its turn is still open.
   */
  async stepEnded(final: boolean): Promise<void> {
    this.#session?.turnEnded();
    if (final && this.#headless) await this.#session?.settle(HEADLESS_SETTLE_MS);
  }

  /** The main-loop turn ended: deliver the notes held for it. */
  turnCompleted(): void {
    this.#busy = false;
    const held = this.#followUps;
    this.#followUps = [];
    for (const delivery of held) void this.#deliver({ ...delivery, kind: "show" });
  }

  /** `/clear`: the conversation starts over under a new session id. */
  cleared(): void {
    this.#history.clear();
    this.#followUps = [];
    this.#band = [];
    this.#session?.reset();
    this.#api.redraw();
  }

  async command(args: string): Promise<string> {
    const output = await runMicroManagerCommand(this.#session, args, {
      reload: async () => (this.#disposed ? undefined : discoverClaudeCodeConfiguration(this.#api, this.#cwd)),
      configGuidance: () => this.#configGuidance(),
    });
    // Claude Code prints a command's answer under the plugin's name already.
    return output.text.replace(/^micro-manager:? /, "");
  }

  dispose(): void {
    this.#disposed = true;
    this.#session?.dispose();
    this.#session = undefined;
    this.#stopBlink();
    this.#band = [];
    this.#api.status(undefined);
    this.#api.redraw();
  }

  #host(): MicroManagerHost {
    return {
      resolveModel: (selector, thinking) => resolveClaudeCodeModel(this.#api, selector, thinking),
      workspace: createClaudeCodeWorkspace(this.#api, this.#cwd),
      history: () => this.#history.entries(),
      primary: () => ({ mode: this.#headless ? "print" : "interactive", idle: !this.#busy }),
      deliver: (delivery) => this.#deliver(delivery),
      changed: () => this.#refreshStatus(),
      sleep: (ms, signal) => this.#api.sleep(ms, signal),
    };
  }

  async #deliver(delivery: Delivery): Promise<void> {
    if (delivery.kind === "followUp" && this.#busy) {
      this.#followUps.push(delivery);
      return;
    }
    if (delivery.kind !== "record") {
      this.#band = trimBand([...this.#band, ...delivery.notes]);
      this.#api.redraw();
    }
    // ponytail: a failed append drops that note; the engine refuses appends only to runs no plugin may shape
    try {
      await this.#api.append("system", formatCard(delivery.notes));
      if (delivery.kind === "record") return;
      if (delivery.kind === "wake") await this.#api.submit(delivery.content);
      else await this.#api.append("user", delivery.content);
    } catch {
      // See above.
    }
  }

  #refreshStatus(): void {
    if (!this.#session || this.#disposed) return;
    const footer = this.#session.footer(this.#blinkFrame);
    if (footer.animating && !this.#blink) {
      this.#blink = this.#api.every(BLINK_INTERVAL_MS, () => {
        this.#blinkFrame++;
        this.#refreshStatus();
      });
    } else if (!footer.animating) {
      this.#stopBlink();
    }
    // The face lives in the footer; the warning line is for trouble alone.
    const problem =
      footer.state === "error"
        ? `${footer.text} a review failed; see /micro-manager status`
        : footer.state === "no_model"
          ? `${footer.text} no review model resolved; see /micro-manager status`
          : undefined;
    if (problem !== this.#problem) {
      this.#problem = problem;
      this.#api.status(problem);
    }
    this.#api.redraw();
  }

  #stopBlink(): void {
    this.#blink?.cancel();
    this.#blink = undefined;
    this.#blinkFrame = 0;
  }

  #configGuidance(): string {
    const project = `${this.#cwd}/${CLAUDE_CODE_CONFIG_DIR_NAME}`;
    return `Create ${project}/MICRO_MANAGER.yml or ~/${CLAUDE_CODE_CONFIG_DIR_NAME}/MICRO_MANAGER.yml, then run /micro-manager reload:\n\nenabled: true\nthinking: low\ntools: [read, grep, find, ls]\nmanagers:\n  - name: Architecture\n    # model: opus\n    instructions: |\n      Watch module seams and public-interface growth.\n\nManagers review with Sonnet at low effort unless model says otherwise. Optional review priorities belong in MICRO_MANAGER.md beside it.`;
  }
}

/** Drops the oldest of the mildest notes first, so a later nit never hides an unread blocker. */
export function trimBand(notes: MicroManagerNote[]): MicroManagerNote[] {
  const rank = (note: MicroManagerNote) => SEVERITY_RANK[note.severity ?? "nit"];
  while (notes.length > BAND_LIMIT) {
    const mildest = Math.min(...notes.map(rank));
    notes.splice(notes.findIndex((note) => rank(note) === mildest), 1);
  }
  return notes;
}
