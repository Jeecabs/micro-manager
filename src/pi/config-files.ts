import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { discoverConfiguration, hasProjectConfigCandidate, type ConfigFileSystem } from "../core/config-discovery.ts";
import type { MicroManagerConfiguration } from "../core/types.ts";

export interface MicroManagerConfigDiscoveryOptions {
  cwd: string;
  agentDir: string;
  includeProject: boolean;
  configDirName?: string;
}

const nodeConfigFileSystem: ConfigFileSystem = {
  join: (...parts) => path.join(...parts),
  dirname: (target) => path.dirname(target),
  resolve: (target) => path.resolve(target),
  async exists(target) {
    try {
      await fs.lstat(target);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
  },
  async stat(target) {
    const stat = await fs.lstat(target);
    return {
      kind: stat.isFile() ? "file" : stat.isDirectory() ? "dir" : "other",
      isLink: stat.isSymbolicLink(),
      size: stat.size,
    };
  },
  read: (target) => fs.readFile(target, "utf8"),
};

export function hasProjectMicroManagerCandidate(cwd: string, configDirName = CONFIG_DIR_NAME): Promise<boolean> {
  return hasProjectConfigCandidate(nodeConfigFileSystem, cwd, configDirName);
}

export function discoverMicroManagerConfiguration(
  options: MicroManagerConfigDiscoveryOptions,
): Promise<MicroManagerConfiguration> {
  return discoverConfiguration(nodeConfigFileSystem, {
    cwd: options.cwd,
    userDir: options.agentDir,
    configDirName: options.configDirName ?? CONFIG_DIR_NAME,
    includeProject: options.includeProject,
  });
}
