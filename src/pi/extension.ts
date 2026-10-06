import {
  CONFIG_DIR_NAME,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { MICRO_MANAGER_COMMAND_ACTIONS, runMicroManagerCommand } from "../core/commands.ts";
import { MicroManagerSession, type Delivery, type MicroManagerHost } from "../core/session.ts";
import type { MicroManagerConfiguration } from "../core/types.ts";
import {
  discoverMicroManagerConfiguration,
  hasProjectMicroManagerCandidate,
  type MicroManagerConfigDiscoveryOptions,
} from "./config-files.ts";
import { resolvePiReviewModel } from "./model.ts";
import { renderMicroManagerMessage } from "./renderer.ts";
import { piHistory } from "./transcript.ts";
import { createPiWorkspace } from "./workspace.ts";

const STATUS_KEY = "micro-manager";
// ponytail: blink is a footer-status timer, not setWorkingIndicator — that would hijack the primary spinner
const BLINK_INTERVAL_MS = 600;

interface ProjectTrustAccess {
  hasStandardResources(cwd: string): boolean;
  getSavedDecision(cwd: string): boolean | null;
  rememberDecision(cwd: string, trusted: boolean): void;
  hasProjectCandidate(cwd: string, configDirName: string): Promise<boolean>;
}

export interface MicroManagerExtensionDependencies {
  discoverConfig?(options: MicroManagerConfigDiscoveryOptions): Promise<MicroManagerConfiguration>;
  trust?: ProjectTrustAccess;
}

export function registerMicroManagerExtension(
  pi: ExtensionAPI,
  dependencies: MicroManagerExtensionDependencies = {},
): void {
  const agentDir = getAgentDir();
  const trustStore = dependencies.trust ? undefined : new ProjectTrustStore(agentDir);
  const trust: ProjectTrustAccess =
    dependencies.trust ??
    {
      hasStandardResources: hasTrustRequiringProjectResources,
      getSavedDecision: (cwd) => trustStore!.get(cwd),
      rememberDecision: (cwd, decision) => trustStore!.set(cwd, decision),
      hasProjectCandidate: hasProjectMicroManagerCandidate,
    };
  const discoverConfig = dependencies.discoverConfig ?? discoverMicroManagerConfiguration;
  let session: MicroManagerSession | undefined;
  let loadEpoch = 0;
  let blinkTimer: ReturnType<typeof setInterval> | undefined;
  let blinkFrame = 0;

  pi.registerFlag("micro-manager", {
    description: "Enable The Micro Manager for this process",
    type: "boolean",
    default: false,
  });

  pi.registerMessageRenderer("micro-manager", renderMicroManagerMessage);

  pi.registerCommand("micro-manager", {
    description: "Inspect or control The Micro Manager",
    getArgumentCompletions: (prefix) => {
      const matches = MICRO_MANAGER_COMMAND_ACTIONS.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const output = await runMicroManagerCommand(session, args, {
        reload: () => loadConfiguration(ctx, true),
        configGuidance: () => configGuidance(ctx),
      });
      if (output.action === "dump" && ctx.mode === "tui") {
        await ctx.ui.editor("The Micro Manager transcript", output.text);
        return;
      }
      outputCommandText(ctx, output.text, output.level);
    },
  });

  pi.on("project_trust", async (event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return { trusted: "undecided" as const };
    try {
      if (trust.getSavedDecision(event.cwd) !== null) return { trusted: "undecided" as const };
      if (!(await trust.hasProjectCandidate(event.cwd, CONFIG_DIR_NAME))) {
        return { trusted: "undecided" as const };
      }
    } catch {
      return { trusted: "undecided" as const };
    }
    const confirmed = await confirmProjectTrust(event.cwd, (title, message) => ctx.ui.confirm(title, message));
    return confirmed
      ? { trusted: "yes" as const, remember: true }
      : { trusted: "no" as const, remember: true };
  });

  pi.on("session_start", async (event, ctx) => {
    const epoch = ++loadEpoch;
    endSession();
    const configuration = await loadConfiguration(ctx, true);
    if (epoch !== loadEpoch || !configuration) return;
    session = new MicroManagerSession(createHost(ctx), {
      configuration,
      ...(pi.getFlag("micro-manager") === true ? { override: true } : {}),
      seed: event.reason === "reload",
    });
    refreshStatus(ctx);
  });

  pi.on("turn_end", () => session?.turnEnded());

  pi.on("agent_settled", async (_event, ctx) => {
    if (ctx.mode === "print" || ctx.mode === "json") await session?.settle();
  });

  pi.on("session_compact", () => session?.reset());
  pi.on("session_tree", () => session?.reset());
  pi.on("model_select", () => session?.primaryModelChanged());

  pi.on("session_shutdown", (_event, ctx) => {
    loadEpoch++;
    endSession();
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  function createHost(ctx: ExtensionContext): MicroManagerHost {
    return {
      resolveModel: (selector, thinking) => resolvePiReviewModel(ctx, selector, thinking),
      workspace: createPiWorkspace(ctx.cwd),
      history: () => piHistory(ctx.sessionManager.getBranch()),
      primary: () => ({
        mode: ctx.mode === "print" || ctx.mode === "json" ? ctx.mode : "interactive",
        idle: ctx.isIdle(),
      }),
      deliver: (delivery) => deliver(delivery),
      changed: () => refreshStatus(ctx),
      sleep,
    };
  }

  function deliver(delivery: Delivery): void {
    const message = {
      customType: "micro-manager",
      content: delivery.content,
      display: true,
      details: delivery.details,
    };
    if (delivery.kind === "record") {
      pi.appendEntry("micro-manager-report", { content: message.content, details: message.details });
    } else if (delivery.kind === "show") {
      pi.sendMessage(message);
    } else if (delivery.kind === "followUp") {
      pi.sendMessage(message, { deliverAs: "followUp" });
    } else {
      pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true });
    }
  }

  function endSession(): void {
    session?.dispose();
    session = undefined;
    stopBlink();
  }

  function outputCommandText(ctx: ExtensionContext, text: string, type: "info" | "warning" | "error"): void {
    if (ctx.hasUI) {
      ctx.ui.notify(text, type);
      return;
    }
    pi.sendMessage({ customType: "micro-manager-status", content: text, display: true });
  }

  async function loadConfiguration(
    ctx: ExtensionContext,
    requestTrust: boolean,
  ): Promise<MicroManagerConfiguration | undefined> {
    const epoch = loadEpoch;
    const includeProject = await resolveProjectTrust(ctx, requestTrust);
    if (epoch !== loadEpoch) return undefined;
    const configuration = await discoverConfig({
      cwd: ctx.cwd,
      agentDir,
      includeProject,
      configDirName: CONFIG_DIR_NAME,
    });
    if (epoch !== loadEpoch) return undefined;
    if (configuration.errors.length > 0 && ctx.hasUI) {
      ctx.ui.notify(`micro-manager config warning: ${configuration.errors[0]}`, "warning");
    }
    return configuration;
  }

  async function resolveProjectTrust(ctx: ExtensionContext, requestTrust: boolean): Promise<boolean> {
    let candidate = false;
    try {
      candidate = await trust.hasProjectCandidate(ctx.cwd, CONFIG_DIR_NAME);
    } catch {
      return false;
    }
    if (!candidate) return false;
    if (ctx.isProjectTrusted() && trust.hasStandardResources(ctx.cwd)) return true;

    let saved: boolean | null;
    try {
      saved = trust.getSavedDecision(ctx.cwd);
    } catch {
      return false;
    }
    if (saved === true && ctx.isProjectTrusted()) return true;
    if (saved !== null || !requestTrust || ctx.mode !== "tui" || !ctx.hasUI || !ctx.isProjectTrusted()) return false;

    const confirmed = await confirmProjectTrust(ctx.cwd, (title, message) => ctx.ui.confirm(title, message));
    try {
      trust.rememberDecision(ctx.cwd, confirmed);
    } catch {
      ctx.ui.notify("Could not save project trust; project micro-manager config remains inactive", "error");
      return false;
    }
    if (!confirmed) return false;
    ctx.ui.notify("Project trust saved. Other project resources can load after Pi restarts.", "warning");
    return true;
  }

  function stopBlink(): void {
    if (!blinkTimer) return;
    clearInterval(blinkTimer);
    blinkTimer = undefined;
    blinkFrame = 0;
  }

  function refreshStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (!session) {
      stopBlink();
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const footer = session.footer(blinkFrame);
    if (footer.animating && !blinkTimer) {
      blinkTimer = setInterval(() => {
        blinkFrame++;
        refreshStatus(ctx);
      }, BLINK_INTERVAL_MS);
      blinkTimer.unref?.();
    } else if (!footer.animating) {
      stopBlink();
    }
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(footer.tone, footer.text));
  }
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function confirmProjectTrust(
  cwd: string,
  confirm: (title: string, message: string) => Promise<boolean>,
): Promise<boolean> {
  return confirm(
    "Trust project and enable The Micro Manager?",
    `Project: ${cwd}\n\nProject MICRO_MANAGER files can select review models, add instructions, and grant read-only access to workspace files. The Micro Manager sends bounded transcript and tool excerpts to the selected model. Trust this project?`,
  );
}

function configGuidance(ctx: ExtensionContext): string {
  return `Create ${ctx.cwd}/${CONFIG_DIR_NAME}/MICRO_MANAGER.yml, then run /micro-manager reload:\n\nenabled: true\nthinking: low\ntools: [read, grep, find, ls]\nmanagers:\n  - name: Architecture\n    # model: anthropic/claude-sonnet-4-6:medium\n    instructions: |\n      Watch module seams and public-interface growth.\n\nOptional review priorities belong in ${ctx.cwd}/${CONFIG_DIR_NAME}/MICRO_MANAGER.md. Project files require project trust. User-level defaults can live in ${getAgentDir()}/MICRO_MANAGER.yml and MICRO_MANAGER.md.`;
}
