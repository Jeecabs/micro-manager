import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAdvisorExtension } from "./extension.ts";

export { AdvisorRunner } from "./advisor-runner.ts";
export * from "./advisory-format.ts";
export * from "./config.ts";
export * from "./emission-guard.ts";
export { registerAdvisorExtension } from "./extension.ts";
export * from "./transcript.ts";
export * from "./types.ts";

export default function advisorExtension(pi: ExtensionAPI): void {
  registerAdvisorExtension(pi);
}
