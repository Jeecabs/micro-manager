import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

export const MICRO_MANAGER_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;
export type MicroManagerToolName = (typeof MICRO_MANAGER_TOOL_NAMES)[number];

export const MICRO_MANAGER_SEVERITIES = ["nit", "concern", "blocker"] as const;
export type MicroManagerSeverity = (typeof MICRO_MANAGER_SEVERITIES)[number];

export interface MicroManagerNote {
  note: string;
  severity?: MicroManagerSeverity;
  manager?: string;
  model?: string;
}

export interface MicroManagerMessageDetails {
  notes: MicroManagerNote[];
}

export interface MicroManagerDefinition {
  name: string;
  enabled: boolean;
  model?: string;
  thinking: ThinkingLevel;
  tools: MicroManagerToolName[];
  instructions?: string;
}

export interface MicroManagerSettings {
  enabled: boolean;
  model?: string;
  thinking: ThinkingLevel;
  tools: MicroManagerToolName[];
  timeoutMs: number;
  maxInputChars: number;
  maxOutputTokens: number;
  maxToolRounds: number;
  maxContextChars: number;
  maxAttempts: number;
  immuneTurns: number;
}

export interface MicroManagerConfiguration {
  settings: MicroManagerSettings;
  managers: MicroManagerDefinition[];
  sharedInstructions?: string;
  priorityBlocks: string[];
  sources: string[];
  errors: string[];
  projectConfigDetected: boolean;
  projectConfigLoaded: boolean;
}

export type MicroManagerRuntimeState = "running" | "paused" | "error" | "no_model";

export interface MicroManagerRuntimeStats {
  name: string;
  state: MicroManagerRuntimeState;
  model?: Model<any>;
  backlog: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  lastError?: string;
}

export type MicroManagerOverallState = "off" | "watching" | "reviewing" | "error" | "no_model";

export interface MicroManagerStatusManager {
  name: string;
  state: MicroManagerRuntimeState;
  model?: string;
  backlog: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  lastError?: string;
}

export interface MicroManagerStatusSnapshot {
  state: MicroManagerOverallState;
  managers: MicroManagerStatusManager[];
  sources: string[];
  warnings: string[];
  projectConfigIgnored: boolean;
  delivered: number;
}

export interface MicroManagerReportEntry {
  content: string;
  details: MicroManagerMessageDetails;
}
