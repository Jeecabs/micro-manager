import type { MicroManagerSession } from "./session.ts";
import type { MicroManagerConfiguration } from "./types.ts";

export const MICRO_MANAGER_COMMAND_ACTIONS = ["on", "off", "status", "reload", "dump", "config"] as const;
export const MICRO_MANAGER_COMMAND_USAGE = "/micro-manager [on|off|status|reload|dump|config]";

export interface MicroManagerCommandOutput {
  action: (typeof MICRO_MANAGER_COMMAND_ACTIONS)[number] | "usage";
  text: string;
  level: "info" | "warning";
}

export interface MicroManagerCommandHost {
  /** Rediscovers configuration; undefined when the session moved on meanwhile. */
  reload(): Promise<MicroManagerConfiguration | undefined>;
  configGuidance(): string;
}

/** `/micro-manager` behavior shared by every host; the host only shows the result. */
export async function runMicroManagerCommand(
  session: MicroManagerSession | undefined,
  args: string,
  host: MicroManagerCommandHost,
): Promise<MicroManagerCommandOutput> {
  const action = args.trim().toLowerCase() || "status";
  if (action === "status") {
    return { action, text: session?.statusText() ?? "micro-manager: not started", level: "info" };
  }
  if (action === "on") {
    session?.setEnabled(true);
    return session?.reviewing
      ? { action, text: "micro-manager enabled", level: "info" }
      : { action, text: "micro-manager enabled, but no model resolved", level: "warning" };
  }
  if (action === "off") {
    session?.setEnabled(false);
    return { action, text: "micro-manager disabled for this session", level: "info" };
  }
  if (action === "reload") {
    const configuration = await host.reload();
    if (configuration) session?.configure(configuration);
    return (configuration?.errors.length ?? 0) > 0
      ? { action, text: "micro-manager config reloaded with warnings", level: "warning" }
      : { action, text: "micro-manager config reloaded", level: "info" };
  }
  if (action === "dump") {
    return { action, text: session?.dump() || "micro-manager transcript is empty", level: "info" };
  }
  if (action === "config" || action === "configure") {
    return { action: "config", text: host.configGuidance(), level: "info" };
  }
  return { action: "usage", text: `Usage: ${MICRO_MANAGER_COMMAND_USAGE}`, level: "warning" };
}
