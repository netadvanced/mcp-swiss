import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  moduleRegistry,
  TOOL_ANNOTATIONS,
  type ActiveModule,
  type ToolDefinition,
  type ToolHandler,
} from "./registry.js";
import { VERSION } from "./utils/http.js";

export const SERVER_NAME = "mcp-swiss-ng";

export interface ServerOptions {
  /** Modules whose tools are listed from the start. */
  modules: ActiveModule[];
  /**
   * Discovery mode: expose swiss_discover / swiss_call and let the agent load
   * further modules at runtime (announced via notifications/tools/list_changed).
   */
  discovery?: boolean;
}

// ── Discovery meta-tools ─────────────────────────────────────────────────────

export const DISCOVER_TOOL: ToolDefinition = {
  name: "swiss_discover",
  description:
    "Swiss open-data catalog. Call with no args to list modules; pass modules to load their tools.",
  inputSchema: {
    type: "object",
    properties: {
      modules: {
        type: "array",
        items: { type: "string", enum: Object.keys(moduleRegistry) },
        description: "Modules to load",
      },
    },
  },
};

export const CALL_TOOL: ToolDefinition = {
  name: "swiss_call",
  description:
    "Run a tool from a loaded module. Only needed if your client does not refresh its tool list.",
  inputSchema: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Tool name" },
      arguments: { type: "object", description: "Tool arguments" },
    },
    required: ["tool"],
  },
};

/**
 * Anything can be thrown in JS, and `String(value)` on a plain object yields
 * "[object Object]", which tells the agent nothing. Dig out something readable.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Error";
  if (typeof error === "string") return error || "Unknown error";
  if (error == null) return "Unknown error";
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // circular or non-serialisable — fall through
    }
    return "Unknown error";
  }
  return String(error);
}

// ── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build one MCP server instance. stdio uses a single instance; the HTTP
 * transport creates one per session so discovery state stays per-client.
 */
export function createServer({ modules, discovery = false }: ServerOptions): Server {
  const loaded = new Map<string, ActiveModule>();
  const toolHandlers = new Map<string, ToolHandler>();
  const tools: ToolDefinition[] = [];

  const loadModule = (mod: ActiveModule): boolean => {
    if (loaded.has(mod.name)) return false;
    loaded.set(mod.name, mod);
    for (const tool of mod.tools) {
      tools.push(tool);
      toolHandlers.set(tool.name, mod.handler);
    }
    return true;
  };
  modules.forEach(loadModule);

  const server = new Server(
    { name: SERVER_NAME, version: VERSION },
    { capabilities: { tools: { listChanged: discovery } } }
  );

  const listTools = () => {
    const visible = discovery ? [DISCOVER_TOOL, CALL_TOOL, ...tools] : tools;
    return visible.map((t) => ({ ...t, annotations: TOOL_ANNOTATIONS }));
  };

  const discover = async (args: Record<string, unknown>): Promise<string> => {
    const requested = Array.isArray(args.modules) ? args.modules.map(String) : [];
    const unknown = requested.filter((m) => !moduleRegistry[m]);
    if (unknown.length) {
      throw new Error(
        `Unknown modules: ${unknown.join(", ")}. Available: ${Object.keys(moduleRegistry).join(", ")}`
      );
    }

    if (!requested.length) {
      return JSON.stringify({
        modules: Object.entries(moduleRegistry).map(([name, m]) => ({
          name,
          description: m.description,
          tools: m.tools.map((t) => t.name),
          loaded: loaded.has(name),
        })),
        hint: "Call swiss_discover with {modules: [...]} to load tools.",
      });
    }

    const added = requested.filter((name) => loadModule({ name, ...moduleRegistry[name] }));
    if (added.length) {
      // Clients that support list_changed re-fetch tools/list; others use swiss_call.
      await server.sendToolListChanged().catch(() => undefined);
    }
    return JSON.stringify({
      loaded: requested,
      newly_loaded: added,
      tools: requested.flatMap((name) =>
        moduleRegistry[name].tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }))
      ),
      hint: "Call these tools directly, or via swiss_call if they are not in your tool list yet.",
    });
  };

  const runTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    if (discovery && name === DISCOVER_TOOL.name) return discover(args);
    if (discovery && name === CALL_TOOL.name) {
      const target = typeof args.tool === "string" ? args.tool.trim() : "";
      if (!target) {
        throw new Error("swiss_call needs a tool name. Use swiss_discover to list the available tools.");
      }
      if (target === DISCOVER_TOOL.name || target === CALL_TOOL.name) {
        throw new Error(`swiss_call cannot invoke ${target}`);
      }
      const inner = (args.arguments ?? {}) as Record<string, unknown>;
      return runTool(target, inner);
    }
    const handler = toolHandlers.get(name);
    if (!handler) {
      const owner = Object.entries(moduleRegistry).find(([, m]) =>
        m.tools.some((t) => t.name === name)
      );
      if (owner) {
        throw new Error(
          discovery
            ? `Tool ${name} belongs to module '${owner[0]}' — load it with swiss_discover first`
            : `Tool ${name} belongs to module '${owner[0]}', which is not enabled on this server`
        );
      }
      throw new Error(`Unknown tool: ${name}`);
    }
    return handler(name, args);
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools() }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await runTool(name, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text: result }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${errorMessage(error)}` }],
        isError: true,
      };
    }
  });

  return server;
}
