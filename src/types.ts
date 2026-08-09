import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

export const ADVISOR_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;
export type AdvisorToolName = (typeof ADVISOR_TOOL_NAMES)[number];

export const ADVISOR_SEVERITIES = ["nit", "concern", "blocker"] as const;
export type AdvisorSeverity = (typeof ADVISOR_SEVERITIES)[number];

export interface AdvisorNote {
  note: string;
  severity?: AdvisorSeverity;
  advisor?: string;
}

export interface AdvisorMessageDetails {
  notes: AdvisorNote[];
}

export interface AdvisorDefinition {
  name: string;
  enabled: boolean;
  model?: string;
  thinking: ThinkingLevel;
  tools: AdvisorToolName[];
  instructions?: string;
}

export interface AdvisorSettings {
  enabled: boolean;
  model?: string;
  thinking: ThinkingLevel;
  tools: AdvisorToolName[];
  timeoutMs: number;
  maxInputChars: number;
  maxOutputTokens: number;
  maxToolRounds: number;
  maxContextChars: number;
  maxAttempts: number;
  immuneTurns: number;
}

export interface AdvisorConfiguration {
  settings: AdvisorSettings;
  advisors: AdvisorDefinition[];
  sharedInstructions?: string;
  watchdogBlocks: string[];
  sources: string[];
  errors: string[];
  projectConfigDetected: boolean;
  projectConfigLoaded: boolean;
}

export type AdvisorRuntimeState = "running" | "paused" | "error" | "no_model";

export interface AdvisorRuntimeStats {
  name: string;
  state: AdvisorRuntimeState;
  model?: Model<any>;
  backlog: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  lastError?: string;
}
