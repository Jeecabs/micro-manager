import type { AgentTool } from "@earendil-works/pi-agent-core";
import { validateToolArguments } from "@earendil-works/pi-ai";
import {
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolOutputBlock, Workspace, WorkspaceToolRequest } from "../core/tools.ts";
import type { MicroManagerToolName } from "../core/types.ts";

/** The trusted workspace through Pi's own read-only tools. The core confines paths first. */
export function createPiWorkspace(cwd: string): Workspace {
  const root = path.resolve(cwd);
  const tools = new Map<MicroManagerToolName, AgentTool>();
  return {
    root,
    resolve: (target) => path.resolve(root, target),
    realPath: (target) => fs.realpath(target),
    async run({ tool: name, args, callId, signal }: WorkspaceToolRequest): Promise<readonly ToolOutputBlock[]> {
      let tool = tools.get(name);
      if (!tool) {
        tool = createTool(name, root);
        tools.set(name, tool);
      }
      const prepared = tool.prepareArguments ? (tool.prepareArguments(args) as Record<string, unknown>) : args;
      const validated = validateToolArguments(tool, { type: "toolCall", id: callId, name, arguments: prepared });
      const result = await tool.execute(callId, validated, signal);
      return (result.content ?? []).map((block) =>
        block.type === "text" ? { type: "text", text: block.text } : { type: "image" },
      );
    },
  };
}

function createTool(name: MicroManagerToolName, cwd: string): AgentTool {
  if (name === "read") return createReadTool(cwd);
  if (name === "grep") return createGrepTool(cwd);
  if (name === "find") return createFindTool(cwd);
  return createLsTool(cwd);
}
