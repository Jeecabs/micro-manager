import type { JsonSchemaProperty, ToolSpec } from "./model.ts";
import type { MicroManagerToolName } from "./types.ts";

export type ToolOutputBlock = { type: "text"; text: string } | { type: "image" };

export interface WorkspaceToolRequest {
  tool: MicroManagerToolName;
  args: Record<string, unknown>;
  callId: string;
  signal: AbortSignal;
}

/**
 * The host's read-only view of the trusted workspace. The core validates arguments and
 * confines every path before `run`, so an adapter only maps a call onto its own tools.
 */
export interface Workspace {
  /** Absolute workspace root. */
  readonly root: string;
  /** Resolves a tool path against the root to an absolute, normalized path with the host's path rules. */
  resolve(path: string): string;
  /** Every symbolic link and `..` resolved; rejects when the path does not exist. */
  realPath(path: string): Promise<string>;
  /** Throws when the tool fails; the message reaches the review model. */
  run(request: WorkspaceToolRequest): Promise<readonly ToolOutputBlock[]>;
}

const text = (description: string): JsonSchemaProperty => ({ type: "string", description });
const number = (description: string): JsonSchemaProperty => ({ type: "number", description });
const boolean = (description: string): JsonSchemaProperty => ({ type: "boolean", description });

export const WORKSPACE_TOOL_SPECS: Readonly<Record<MicroManagerToolName, ToolSpec>> = {
  read: {
    name: "read",
    description: "Read a text file in the workspace. Use offset and limit for large files. Output is truncated.",
    parameters: {
      type: "object",
      properties: {
        path: text("Path to the file to read (relative or absolute)"),
        offset: number("Line number to start reading from (1-indexed)"),
        limit: number("Maximum number of lines to read"),
      },
      required: ["path"],
    },
  },
  grep: {
    name: "grep",
    description:
      "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated.",
    parameters: {
      type: "object",
      properties: {
        pattern: text("Search pattern (regex or literal string)"),
        path: text("Directory or file to search (default: workspace root)"),
        glob: text("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"),
        ignoreCase: boolean("Case-insensitive search (default: false)"),
        literal: boolean("Treat pattern as literal string instead of regex (default: false)"),
        context: number("Number of lines to show before and after each match (default: 0)"),
        limit: number("Maximum number of matches to return (default: 100)"),
      },
      required: ["pattern"],
    },
  },
  find: {
    name: "find",
    description:
      "Search for files by glob pattern. Returns matching paths relative to the search directory. Respects .gitignore. Output is truncated.",
    parameters: {
      type: "object",
      properties: {
        pattern: text("Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'"),
        path: text("Directory to search in (default: workspace root)"),
        limit: number("Maximum number of results (default: 1000)"),
      },
      required: ["pattern"],
    },
  },
  ls: {
    name: "ls",
    description: "List directory contents, sorted alphabetically, with '/' after directories. Output is truncated.",
    parameters: {
      type: "object",
      properties: {
        path: text("Directory to list (default: workspace root)"),
        limit: number("Maximum number of entries to return (default: 500)"),
      },
      required: [],
    },
  },
};

export const REPORT_TOOL_SPEC: ToolSpec = {
  name: "report",
  description: "Send one concrete, terse review note to the driving agent. Stay silent when nothing matters.",
  parameters: {
    type: "object",
    properties: {
      note: { type: "string", minLength: 1, description: "One concrete, terse, actionable note for the driving agent." },
      severity: {
        type: "string",
        enum: ["nit", "concern", "blocker"],
        description: "How strongly the driving agent should weigh this note.",
      },
    },
    required: ["note"],
  },
};

/**
 * Checks model-generated arguments against a spec, coercing numeric and boolean strings
 * the way models often send them. Unknown keys are dropped, so a host sees only declared fields.
 */
export function validateToolArguments(spec: ToolSpec, args: unknown): Record<string, unknown> {
  if (!isRecord(args)) throw new Error(`Validation failed for tool "${spec.name}": arguments must be an object`);
  const result: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const name of spec.parameters.required) {
    if (args[name] === undefined) problems.push(`${name}: is required`);
  }
  for (const [name, schema] of Object.entries(spec.parameters.properties)) {
    if (args[name] === undefined) continue;
    const value = coerce(args[name], schema.type);
    const problem = schemaProblem(value, schema);
    if (problem) problems.push(`${name}: ${problem}`);
    else result[name] = value;
  }
  if (problems.length > 0) {
    throw new Error(`Validation failed for tool "${spec.name}":\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  }
  return result;
}

export async function runWorkspaceTool(
  workspace: Workspace,
  tool: MicroManagerToolName,
  rawArgs: unknown,
  callId: string,
  signal: AbortSignal,
): Promise<readonly ToolOutputBlock[]> {
  const args = validateToolArguments(WORKSPACE_TOOL_SPECS[tool], rawArgs);
  await confineToolPath(workspace, args);
  return workspace.run({ tool, args, callId, signal });
}

async function confineToolPath(workspace: Workspace, args: Record<string, unknown>): Promise<void> {
  if (args.path === undefined) return;
  if (typeof args.path !== "string") throw new Error("Tool path must be a string");

  const target = workspace.resolve(args.path);
  // A `..` left in a resolved path means the adapter did not normalize it; refuse rather than trust it.
  if (/(^|[\\/])\.\.([\\/]|$)/.test(target) || !isWithin(workspace.root, target)) {
    throw new Error("Tool path must stay inside the trusted workspace");
  }

  const [realRoot, realTarget] = await Promise.all([workspace.realPath(workspace.root), workspace.realPath(target)]);
  if (!isWithin(realRoot, realTarget)) {
    throw new Error("Tool path must not follow a link outside the trusted workspace");
  }
}

/**
 * Whether `target` is `root` or below it. Both must be absolute and normalized by the host.
 * ponytail: case-sensitive; a host on a case-insensitive filesystem passes canonical realpaths.
 */
export function isWithin(root: string, target: string): boolean {
  const base = root.replace(/[\\/]+$/, "");
  if (target === base || target === root) return true;
  if (!target.startsWith(base)) return false;
  const separator = target.charAt(base.length);
  return separator === "/" || separator === "\\";
}

export function boundToolOutput(blocks: readonly ToolOutputBlock[], maxChars: number): string {
  const parts: string[] = [];
  let remaining = maxChars;
  for (const block of blocks) {
    if (remaining <= 0) break;
    const value = block.type === "text" ? block.text : "[image omitted from micro-manager context]";
    if (value.length <= remaining) {
      parts.push(value);
      remaining -= value.length;
      continue;
    }
    parts.push(`${value.slice(0, Math.max(0, remaining - 24))}\n[tool output truncated]`);
    remaining = 0;
  }
  return parts.join("\n");
}

function coerce(value: unknown, type: JsonSchemaProperty["type"]): unknown {
  if ((type === "number" || type === "integer") && typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

function schemaProblem(value: unknown, schema: JsonSchemaProperty): string | undefined {
  if (schema.type === "string") {
    if (typeof value !== "string") return "must be a string";
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `must contain at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}`;
    }
    if (schema.enum && !schema.enum.includes(value)) return `must be one of: ${schema.enum.join(", ")}`;
    return undefined;
  }
  if (schema.type === "boolean") return typeof value === "boolean" ? undefined : "must be a boolean";
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
  if (schema.type === "integer" && !Number.isInteger(value)) return "must be an integer";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
