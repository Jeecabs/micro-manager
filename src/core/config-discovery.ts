import { buildMicroManagerConfiguration, MAX_CONFIG_BYTES, type MicroManagerConfigFile } from "./config.ts";
import type { MicroManagerConfiguration } from "./types.ts";

const FILENAMES = ["MICRO_MANAGER.yml", "MICRO_MANAGER.yaml", "MICRO_MANAGER.md"];

/** The file access configuration discovery needs. Paths use the host's own rules. */
export interface ConfigFileSystem {
  join(...parts: string[]): string;
  dirname(path: string): string;
  resolve(path: string): string;
  exists(path: string): Promise<boolean>;
  /** `isLink` describes the path itself; `kind` and `size` may describe a link's target. */
  stat(path: string): Promise<{ kind: "file" | "dir" | "other"; isLink: boolean; size: number }>;
  read(path: string): Promise<string>;
}

export interface ConfigDiscoveryOptions {
  cwd: string;
  /** The host's user-level directory, such as `~/.pi/agent` or `~/.claude`; absent skips user files. */
  userDir?: string;
  /** The host's project directory name, such as `.pi` or `.claude`. */
  configDirName: string;
  includeProject: boolean;
}

interface ConfigCandidate {
  path: string;
  level: "user" | "project";
  kind: "yaml" | "markdown";
}

/**
 * Loads user files, then project files from the repository root down to `cwd`. At each
 * directory: YAML, Markdown, then the same in the host's config directory.
 */
export async function discoverConfiguration(
  fs: ConfigFileSystem,
  options: ConfigDiscoveryOptions,
): Promise<MicroManagerConfiguration> {
  const projectConfigDetected = await hasProjectConfigCandidate(fs, options.cwd, options.configDirName);
  const candidates: ConfigCandidate[] = [];
  if (options.userDir !== undefined) await appendLocationCandidates(fs, candidates, options.userDir, "user");
  if (options.includeProject) {
    for (const dir of await projectDirectories(fs, options.cwd)) {
      await appendLocationCandidates(fs, candidates, dir, "project");
      await appendLocationCandidates(fs, candidates, fs.join(dir, options.configDirName), "project");
    }
  }

  const files: MicroManagerConfigFile[] = [];
  for (const candidate of candidates) {
    try {
      files.push({ ...candidate, text: await readBoundedRegularFile(fs, candidate.path) });
    } catch (error) {
      files.push({ path: candidate.path, level: candidate.level, error: errorMessage(error) });
    }
  }
  return buildMicroManagerConfiguration(files, { projectConfigDetected });
}

/** Checks file metadata only, so it is safe before project trust. */
export async function hasProjectConfigCandidate(fs: ConfigFileSystem, cwd: string, configDirName: string): Promise<boolean> {
  for (const dir of await projectDirectories(fs, cwd)) {
    for (const location of [dir, fs.join(dir, configDirName)]) {
      for (const filename of FILENAMES) {
        if (await fs.exists(fs.join(location, filename))) return true;
      }
    }
  }
  return false;
}

async function appendLocationCandidates(
  fs: ConfigFileSystem,
  candidates: ConfigCandidate[],
  location: string,
  level: ConfigCandidate["level"],
): Promise<void> {
  const yml = fs.join(location, "MICRO_MANAGER.yml");
  const yaml = fs.join(location, "MICRO_MANAGER.yaml");
  if (await fs.exists(yml)) candidates.push({ path: yml, level, kind: "yaml" });
  else if (await fs.exists(yaml)) candidates.push({ path: yaml, level, kind: "yaml" });

  const markdown = fs.join(location, "MICRO_MANAGER.md");
  if (await fs.exists(markdown)) candidates.push({ path: markdown, level, kind: "markdown" });
}

/** From the Git worktree root down to `cwd`; just `cwd` outside a worktree. */
async function projectDirectories(fs: ConfigFileSystem, cwd: string): Promise<string[]> {
  const resolved = fs.resolve(cwd);
  const walked: string[] = [];
  let current = resolved;
  while (true) {
    walked.push(current);
    if (await fs.exists(fs.join(current, ".git"))) return walked.reverse();
    const parent = fs.dirname(current);
    if (parent === current) return [resolved];
    current = parent;
  }
}

async function readBoundedRegularFile(fs: ConfigFileSystem, path: string): Promise<string> {
  const stat = await fs.stat(path);
  if (stat.kind !== "file" || stat.isLink) throw new Error("must be a regular file, not a symlink");
  if (stat.size > MAX_CONFIG_BYTES) throw new Error(`exceeds ${MAX_CONFIG_BYTES} bytes`);
  return fs.read(path);
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
