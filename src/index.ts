import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMicroManagerExtension } from "./pi/extension.ts";

export * from "./core/index.ts";
export {
  discoverMicroManagerConfiguration,
  hasProjectMicroManagerCandidate,
  type MicroManagerConfigDiscoveryOptions,
} from "./pi/config-files.ts";
export { registerMicroManagerExtension, type MicroManagerExtensionDependencies } from "./pi/extension.ts";

export default function microManagerExtension(pi: ExtensionAPI): void {
  registerMicroManagerExtension(pi);
}
