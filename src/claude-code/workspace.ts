import type { ToolOutputBlock, Workspace, WorkspaceToolRequest } from "../core/tools.ts";
import type { ClaudeCodeApi } from "./api.ts";
import { resolve } from "./paths.ts";

const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_LINE_CHARS = 2_000;
const PROCESS_TIMEOUT_MS = 15_000;

/**
 * The trusted workspace through `$.fs` and ripgrep. The core has already validated and
 * confined every path; `grep` and `find` need `rg` on PATH, since native builds of
 * Claude Code register no Grep or Glob tool a mod could call.
 */
export function createClaudeCodeWorkspace(api: ClaudeCodeApi, root: string): Workspace {
  return {
    root,
    resolve: (target) => resolve(root, target),
    async realPath(target) {
      const stat = await api.stat(target, { resolve: true });
      if (!stat.realPath) throw new Error(`No such file or directory: ${target}`);
      return stat.realPath;
    },
    async run(request: WorkspaceToolRequest): Promise<readonly ToolOutputBlock[]> {
      return [{ type: "text", text: await runTool(api, root, request) }];
    },
  };
}

async function runTool(api: ClaudeCodeApi, root: string, { tool, args }: WorkspaceToolRequest): Promise<string> {
  const target = typeof args.path === "string" ? resolve(root, args.path) : root;
  if (tool === "read") return readFile(api, target, number(args.offset, 1), number(args.limit, 2_000));
  if (tool === "ls") return listDirectory(api, target, number(args.limit, 500));
  if (tool === "grep") {
    const argv = ["rg", "--line-number", "--no-heading", "--color=never", "--max-columns=500"];
    if (args.ignoreCase === true) argv.push("--ignore-case");
    if (args.literal === true) argv.push("--fixed-strings");
    if (typeof args.context === "number" && args.context > 0) argv.push(`--context=${Math.floor(args.context)}`);
    if (typeof args.glob === "string") argv.push(`--glob=${args.glob}`);
    argv.push("--regexp", String(args.pattern), "--", target);
    return limitLines(await ripgrep(api, argv, root), number(args.limit, 100), "No matches found");
  }
  const files = await ripgrep(api, ["rg", "--files", "--color=never", `--glob=${String(args.pattern)}`], target);
  return limitLines(files.split("\n").filter(Boolean).sort().join("\n"), number(args.limit, 1_000), "No files found");
}

async function readFile(api: ClaudeCodeApi, path: string, offset: number, limit: number): Promise<string> {
  const stat = await api.stat(path);
  if (stat.kind === "dir") throw new Error(`${path} is a directory; use ls`);
  if (stat.kind !== "file") throw new Error(`No such file: ${path}`);
  if (stat.size > MAX_READ_BYTES) throw new Error(`${path} is too large to read (${stat.size} bytes)`);
  const text = await api.read(path);
  if (text.includes("\u0000")) return "[binary file omitted from micro-manager context]";

  const lines = text.split(/\r?\n/);
  const start = Math.max(1, Math.floor(offset));
  const shown = lines
    .slice(start - 1, start - 1 + Math.max(1, Math.floor(limit)))
    .map((line, index) => `${start + index}\t${line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line}`);
  const remaining = lines.length - (start - 1 + shown.length);
  if (remaining > 0) shown.push(`[${remaining} more lines; continue with offset=${start + shown.length}]`);
  return shown.join("\n");
}

async function listDirectory(api: ClaudeCodeApi, path: string, limit: number): Promise<string> {
  const entries = [...(await api.list(path))]
    .map((entry) => (entry.kind === "dir" ? `${entry.name}/` : entry.name))
    .sort((left, right) => left.localeCompare(right));
  if (entries.length === 0) return "(empty directory)";
  return limitLines(entries.join("\n"), limit, "(empty directory)");
}

async function ripgrep(api: ClaudeCodeApi, argv: readonly string[], cwd: string): Promise<string> {
  let result;
  try {
    result = await api.run(argv, { cwd, timeoutMs: PROCESS_TIMEOUT_MS });
  } catch (error) {
    throw new Error(`${argv[0]} failed; grep and find need ripgrep (rg) on PATH: ${errorMessage(error)}`);
  }
  // Exit 1 means no matches; 2 means an error, though partial output may still be useful.
  if (result.exitCode === 2 && !result.stdout.trim()) throw new Error(result.stderr.trim() || "ripgrep failed");
  return result.stdout.trimEnd();
}

function limitLines(text: string, limit: number, empty: string): string {
  if (!text) return empty;
  const lines = text.split("\n");
  const max = Math.max(1, Math.floor(limit));
  if (lines.length <= max) return text;
  return `${lines.slice(0, max).join("\n")}\n[${lines.length - max} more results; narrow the search]`;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
