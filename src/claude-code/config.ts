import { discoverConfiguration, type ConfigFileSystem } from "../core/config-discovery.ts";
import type { MicroManagerConfiguration } from "../core/types.ts";
import type { ClaudeCodeApi } from "./api.ts";
import { dirname, join, normalize } from "./paths.ts";

export const CLAUDE_CODE_CONFIG_DIR_NAME = ".claude";

/** `CLAUDE_CONFIG_DIR`, else `~/.claude`; undefined when no home directory is known. */
export async function claudeCodeUserDir(api: ClaudeCodeApi): Promise<string | undefined> {
  const env = await api.configEnv();
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;
  const home = env.HOME ?? env.USERPROFILE;
  return home ? join(home, CLAUDE_CODE_CONFIG_DIR_NAME) : undefined;
}

/**
 * Same files and rules as Pi, with `.claude` in place of `.pi`. Claude Code loads mods only
 * in workspaces the person trusted, so project files load whenever the mod runs.
 */
export async function discoverClaudeCodeConfiguration(api: ClaudeCodeApi, cwd: string): Promise<MicroManagerConfiguration> {
  const fs: ConfigFileSystem = {
    join,
    dirname,
    resolve: normalize,
    exists: (path) => api.exists(path),
    async stat(path) {
      const stat = await api.stat(path);
      return { kind: stat.kind, isLink: stat.isLink, size: stat.size };
    },
    read: (path) => api.read(path),
  };
  const userDir = await claudeCodeUserDir(api);
  return discoverConfiguration(fs, {
    cwd,
    ...(userDir ? { userDir } : {}),
    configDirName: CLAUDE_CODE_CONFIG_DIR_NAME,
    includeProject: true,
  });
}
