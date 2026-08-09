import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseDocument } from "yaml";
import {
  ADVISOR_TOOL_NAMES,
  type AdvisorConfiguration,
  type AdvisorDefinition,
  type AdvisorSettings,
  type AdvisorToolName,
} from "./types.ts";

const MAX_CONFIG_BYTES = 64 * 1024;
const DEFAULT_SETTINGS: AdvisorSettings = {
  enabled: false,
  thinking: "low",
  tools: [...ADVISOR_TOOL_NAMES],
  timeoutMs: 30_000,
  maxInputChars: 24_000,
  maxOutputTokens: 512,
  maxToolRounds: 3,
  maxContextChars: 100_000,
  maxAttempts: 2,
  immuneTurns: 3,
};

const TOP_LEVEL_KEYS = new Set([
  "enabled",
  "model",
  "thinking",
  "tools",
  "timeout_ms",
  "max_input_chars",
  "max_output_tokens",
  "max_tool_rounds",
  "max_context_chars",
  "max_attempts",
  "immune_turns",
  "instructions",
  "advisors",
]);
const ADVISOR_KEYS = new Set(["name", "enabled", "model", "thinking", "tools", "instructions"]);
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const TOOL_ALIASES = new Map<string, AdvisorToolName>([
  ["read", "read"],
  ["grep", "grep"],
  ["search", "grep"],
  ["find", "find"],
  ["glob", "find"],
  ["ls", "ls"],
]);

interface ConfigCandidate {
  path: string;
  level: "user" | "project";
  kind: "yaml" | "markdown";
}

interface PartialSettings {
  enabled?: boolean;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: AdvisorToolName[];
  timeoutMs?: number;
  maxInputChars?: number;
  maxOutputTokens?: number;
  maxToolRounds?: number;
  maxContextChars?: number;
  maxAttempts?: number;
  immuneTurns?: number;
}

interface ParsedAdvisor {
  name: string;
  enabled?: boolean;
  model?: string;
  thinking?: ThinkingLevel;
  tools?: AdvisorToolName[];
  instructions?: string;
}

interface ParsedYaml {
  settings: PartialSettings;
  instructions?: string;
  advisors: ParsedAdvisor[];
}

export interface AdvisorConfigDiscoveryOptions {
  cwd: string;
  agentDir: string;
  includeProject: boolean;
  configDirName?: string;
}

export async function hasProjectAdvisorCandidate(
  cwd: string,
  configDirName = CONFIG_DIR_NAME,
): Promise<boolean> {
  const dirs = await projectDirectories(cwd);
  for (const dir of dirs) {
    for (const location of [dir, path.join(dir, configDirName)]) {
      for (const filename of ["WATCHDOG.yml", "WATCHDOG.yaml", "WATCHDOG.md"]) {
        if (await pathExists(path.join(location, filename))) return true;
      }
    }
  }
  return false;
}

export async function discoverAdvisorConfiguration(
  options: AdvisorConfigDiscoveryOptions,
): Promise<AdvisorConfiguration> {
  const configDirName = options.configDirName ?? CONFIG_DIR_NAME;
  const projectConfigDetected = await hasProjectAdvisorCandidate(options.cwd, configDirName);
  const candidates = await collectCandidates(options.cwd, options.agentDir, options.includeProject, configDirName);
  const settingsPatch: PartialSettings = {};
  const advisorMap = new Map<string, ParsedAdvisor>();
  const sharedInstructions: string[] = [];
  const watchdogBlocks: string[] = [];
  const sources: string[] = [];
  const errors: string[] = [];
  let projectConfigLoaded = false;

  for (const candidate of candidates) {
    try {
      const content = await readBoundedRegularFile(candidate.path);
      sources.push(candidate.path);
      if (candidate.level === "project") projectConfigLoaded = true;
      if (candidate.kind === "markdown") {
        const body = content.trim();
        if (body) {
          watchdogBlocks.push(`Especially pay attention to:\n<attention>\n${body}\n</attention>`);
        }
        continue;
      }

      const parsed = parseConfigYaml(content, candidate.path);
      Object.assign(settingsPatch, parsed.settings);
      if (parsed.instructions) sharedInstructions.push(parsed.instructions);
      for (const advisor of parsed.advisors) advisorMap.set(slugifyAdvisorName(advisor.name), advisor);
    } catch (error) {
      errors.push(`${candidate.path}: ${errorMessage(error)}`);
    }
  }

  const settings = mergeSettings(settingsPatch);
  const advisors = [...advisorMap.values()].map((advisor) => materializeAdvisor(advisor, settings));
  const result: AdvisorConfiguration = {
    settings,
    advisors,
    watchdogBlocks,
    sources,
    errors,
    projectConfigDetected,
    projectConfigLoaded,
  };
  const instructions = sharedInstructions.join("\n\n").trim();
  if (instructions) result.sharedInstructions = instructions;
  return result;
}

export function parseConfigYaml(content: string, source = "WATCHDOG.yml"): ParsedYaml {
  const document = parseDocument(content, { prettyErrors: true, strict: true, uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(document.errors.map((error) => error.message).join("; "));
  const value: unknown = document.toJS({ maxAliasCount: 20 });
  if (value === null || value === undefined) return { settings: {}, advisors: [] };
  if (!isRecord(value)) throw new Error("expected a YAML mapping");
  assertKnownKeys(value, TOP_LEVEL_KEYS, source);

  const settings: PartialSettings = {};
  if ("enabled" in value) settings.enabled = booleanValue(value.enabled, "enabled");
  if ("model" in value) settings.model = nonEmptyString(value.model, "model");
  if ("thinking" in value) settings.thinking = thinkingValue(value.thinking, "thinking");
  if ("tools" in value) settings.tools = toolsValue(value.tools, "tools");
  if ("timeout_ms" in value) settings.timeoutMs = integerValue(value.timeout_ms, "timeout_ms", 1_000, 120_000);
  if ("max_input_chars" in value) {
    settings.maxInputChars = integerValue(value.max_input_chars, "max_input_chars", 2_000, 100_000);
  }
  if ("max_output_tokens" in value) {
    settings.maxOutputTokens = integerValue(value.max_output_tokens, "max_output_tokens", 64, 4_096);
  }
  if ("max_tool_rounds" in value) {
    settings.maxToolRounds = integerValue(value.max_tool_rounds, "max_tool_rounds", 0, 8);
  }
  if ("max_context_chars" in value) {
    settings.maxContextChars = integerValue(value.max_context_chars, "max_context_chars", 8_000, 500_000);
  }
  if ("max_attempts" in value) settings.maxAttempts = integerValue(value.max_attempts, "max_attempts", 1, 3);
  if ("immune_turns" in value) settings.immuneTurns = integerValue(value.immune_turns, "immune_turns", 0, 20);

  const result: ParsedYaml = { settings, advisors: [] };
  if ("instructions" in value) result.instructions = nonEmptyString(value.instructions, "instructions");
  if ("advisors" in value) {
    if (!Array.isArray(value.advisors)) throw new Error("advisors must be an array");
    result.advisors = value.advisors.map((entry, index) => parseAdvisor(entry, index));
  }
  return result;
}

export function slugifyAdvisorName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "advisor";
}

function parseAdvisor(value: unknown, index: number): ParsedAdvisor {
  const field = `advisors[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be a mapping`);
  assertKnownKeys(value, ADVISOR_KEYS, field);
  const advisor: ParsedAdvisor = { name: nonEmptyString(value.name, `${field}.name`) };
  if ("enabled" in value) advisor.enabled = booleanValue(value.enabled, `${field}.enabled`);
  if ("model" in value) advisor.model = nonEmptyString(value.model, `${field}.model`);
  if ("thinking" in value) advisor.thinking = thinkingValue(value.thinking, `${field}.thinking`);
  if ("tools" in value) advisor.tools = toolsValue(value.tools, `${field}.tools`);
  if ("instructions" in value) {
    advisor.instructions = nonEmptyString(value.instructions, `${field}.instructions`);
  }
  return advisor;
}

function materializeAdvisor(advisor: ParsedAdvisor, settings: AdvisorSettings): AdvisorDefinition {
  const result: AdvisorDefinition = {
    name: advisor.name,
    enabled: advisor.enabled ?? true,
    thinking: advisor.thinking ?? settings.thinking,
    tools: [...(advisor.tools ?? settings.tools)],
  };
  const model = advisor.model ?? settings.model;
  if (model) result.model = model;
  if (advisor.instructions) result.instructions = advisor.instructions;
  return result;
}

function mergeSettings(patch: PartialSettings): AdvisorSettings {
  const settings: AdvisorSettings = {
    ...DEFAULT_SETTINGS,
    ...patch,
    tools: [...(patch.tools ?? DEFAULT_SETTINGS.tools)],
  };
  if (!patch.model) delete settings.model;
  return settings;
}

async function collectCandidates(
  cwd: string,
  agentDir: string,
  includeProject: boolean,
  configDirName: string,
): Promise<ConfigCandidate[]> {
  const candidates: ConfigCandidate[] = [];
  await appendLocationCandidates(candidates, agentDir, "user");
  if (!includeProject) return candidates;

  const dirs = await projectDirectories(cwd);
  for (const dir of dirs) {
    await appendLocationCandidates(candidates, dir, "project");
    await appendLocationCandidates(candidates, path.join(dir, configDirName), "project");
  }
  return candidates;
}

async function appendLocationCandidates(
  candidates: ConfigCandidate[],
  location: string,
  level: ConfigCandidate["level"],
): Promise<void> {
  const yml = path.join(location, "WATCHDOG.yml");
  const yaml = path.join(location, "WATCHDOG.yaml");
  if (await pathExists(yml)) candidates.push({ path: yml, level, kind: "yaml" });
  else if (await pathExists(yaml)) candidates.push({ path: yaml, level, kind: "yaml" });

  const markdown = path.join(location, "WATCHDOG.md");
  if (await pathExists(markdown)) candidates.push({ path: markdown, level, kind: "markdown" });
}

async function projectDirectories(cwd: string): Promise<string[]> {
  const resolved = path.resolve(cwd);
  const walked: string[] = [];
  let current = resolved;
  while (true) {
    walked.push(current);
    if (await pathExists(path.join(current, ".git"))) return walked.reverse();
    const parent = path.dirname(current);
    if (parent === current) return [resolved];
    current = parent;
  }
}

async function readBoundedRegularFile(filePath: string): Promise<string> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("must be a regular file, not a symlink");
  if (stat.size > MAX_CONFIG_BYTES) throw new Error(`exceeds ${MAX_CONFIG_BYTES} bytes`);
  return fs.readFile(filePath, "utf8");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function assertKnownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${field} contains unknown ${unknown.length === 1 ? "key" : "keys"}: ${unknown.join(", ")}`);
}

function toolsValue(value: unknown, field: string): AdvisorToolName[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const tools: AdvisorToolName[] = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") throw new Error(`${field}[${index}] must be a string`);
    const normalized = TOOL_ALIASES.get(item.trim().toLowerCase());
    if (!normalized) throw new Error(`${field}[${index}] is not a read-only advisor tool: ${item}`);
    if (!tools.includes(normalized)) tools.push(normalized);
  }
  return tools;
}

function thinkingValue(value: unknown, field: string): ThinkingLevel {
  if (typeof value !== "string" || !THINKING_LEVELS.has(value as ThinkingLevel)) {
    throw new Error(`${field} must be one of: ${[...THINKING_LEVELS].join(", ")}`);
  }
  return value as ThinkingLevel;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function integerValue(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
