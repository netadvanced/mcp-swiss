import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";

import { moduleRegistry } from "../../src/registry.js";

// The shipped entry point, not src/: this is what `npx mcp-swiss-ng` runs.
const SERVER_PATH = resolve(__dirname, "../../dist/index.js");
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")) as { version: string };

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: { type?: string };
  annotations?: Record<string, boolean>;
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

/**
 * One long-lived `node dist/index.js` speaking newline-delimited JSON-RPC on
 * stdio, so a whole session runs over a single process like a real client's.
 */
class StdioSession {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (res: JsonRpcResponse) => void>();
  private buffer = "";
  private nextId = 1;
  private exited = false;
  readonly notifications: JsonRpcNotification[] = [];
  stderr = "";

  constructor(args: string[] = []) {
    this.proc = spawn(process.execPath, [SERVER_PATH, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => this.consume(chunk));
    this.proc.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.proc.on("exit", () => {
      this.exited = true;
    });
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as JsonRpcResponse & JsonRpcNotification;
      if (typeof message.id === "number") {
        this.waiting.get(message.id)?.(message);
        this.waiting.delete(message.id);
      } else if (message.method) {
        this.notifications.push(message);
      }
    }
  }

  request(method: string, params?: Record<string, unknown>, timeoutMs = 10_000): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolveResponse, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms. stderr: ${this.stderr}`));
      }, timeoutMs);
      this.waiting.set(id, (res) => {
        clearTimeout(timer);
        resolveResponse(res);
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  get alive(): boolean {
    return !this.exited;
  }

  private write(message: Record<string, unknown>): void {
    this.proc.stdin.write(JSON.stringify(message) + "\n");
  }

  async stop(): Promise<void> {
    if (this.exited) return;
    this.proc.stdin.end();
    this.proc.kill();
    await once(this.proc, "exit");
  }
}

/** initialize → notifications/initialized, the sequence every client performs. */
async function handshake(session: StdioSession, protocolVersion = LATEST_PROTOCOL_VERSION) {
  const response = await session.request("initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "protocol-test", version: "0" },
  });
  session.notify("notifications/initialized");
  return response;
}

function tools(response: JsonRpcResponse): Tool[] {
  return (response.result as { tools: Tool[] }).tools;
}

function toolResult(response: JsonRpcResponse): ToolResult {
  return response.result as unknown as ToolResult;
}

const registryToolNames = Object.values(moduleRegistry).flatMap((m) => m.tools.map((t) => t.name));

describe("stdio lifecycle", () => {
  let session: StdioSession;
  let initialize: JsonRpcResponse;

  beforeAll(async () => {
    session = new StdioSession();
    initialize = await handshake(session);
  });

  afterAll(async () => {
    await session.stop();
  });

  it("negotiates a protocol version and reports who it is", () => {
    expect(initialize.error).toBeUndefined();
    const result = initialize.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools?: { listChanged?: boolean } };
    };
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(result.protocolVersion);
    expect(result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(result.serverInfo).toEqual({ name: "mcp-swiss-ng", version: pkg.version });
    expect(result.capabilities.tools).toBeDefined();
    // listChanged is a discovery-mode promise only.
    expect(result.capabilities.tools?.listChanged).toBe(false);
  });

  it("lists every registered tool, annotated read-only", async () => {
    const listed = tools(await session.request("tools/list"));
    expect(listed).toHaveLength(82);
    // The default run must expose the whole registry: a module missing from
    // presets.full would show up here and nowhere else.
    expect(listed.map((t) => t.name).sort()).toEqual([...registryToolNames].sort());

    for (const tool of listed) {
      expect(tool.description.length, tool.name).toBeGreaterThan(0);
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
    }
  });

  it("runs a tool and returns its payload as text content", async () => {
    // list_cantons answers from a constant, so the suite stays offline.
    const result = toolResult(await session.request("tools/call", { name: "list_cantons", arguments: {} }));
    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    const cantons = JSON.parse(result.content[0].text) as Array<{ code: string; name: string }>;
    expect(cantons).toHaveLength(26);
    expect(cantons.map((c) => c.code)).toContain("ZH");
  });

  it("reports a failing tool as isError instead of a transport error", async () => {
    // Argument validation rejects a non-numeric ehraid before ZEFIX is called.
    const response = await session.request("tools/call", {
      name: "get_company",
      arguments: { ehraid: "CHE-105.829.940" },
    });
    expect(response.error).toBeUndefined();
    const result = toolResult(response);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ehraid must be a number");

    // The connection survives a tool failure.
    expect(session.alive).toBe(true);
    expect(tools(await session.request("tools/list")).length).toBeGreaterThan(0);
  });

  it("reports an unknown tool as isError", async () => {
    const result = toolResult(
      await session.request("tools/call", { name: "this_tool_does_not_exist", arguments: {} })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool: this_tool_does_not_exist");
  });

  it("answers an unsupported method with -32601 and keeps serving", async () => {
    const response = await session.request("resources/list");
    expect(response.result).toBeUndefined();
    expect(response.error?.code).toBe(-32601);

    expect(session.alive).toBe(true);
    expect(tools(await session.request("tools/list")).length).toBeGreaterThan(0);
  });
});

describe("stdio discovery mode", () => {
  let session: StdioSession;
  let initialize: JsonRpcResponse;

  beforeAll(async () => {
    session = new StdioSession(["--discovery"]);
    initialize = await handshake(session);
  });

  afterAll(async () => {
    await session.stop();
  });

  it("starts on the meta-tools and advertises listChanged", async () => {
    const capabilities = (initialize.result as { capabilities: { tools?: { listChanged?: boolean } } }).capabilities;
    expect(capabilities.tools?.listChanged).toBe(true);
    expect(tools(await session.request("tools/list")).map((t) => t.name)).toEqual([
      "swiss_discover",
      "swiss_call",
    ]);
  });

  it("loading a module adds its tools and notifies the client", async () => {
    const result = toolResult(
      await session.request("tools/call", { name: "swiss_discover", arguments: { modules: ["gwr"] } })
    );
    expect(result.isError).toBeFalsy();
    expect((JSON.parse(result.content[0].text) as { newly_loaded: string[] }).newly_loaded).toEqual(["gwr"]);

    await vi.waitFor(() =>
      expect(session.notifications.map((n) => n.method)).toContain("notifications/tools/list_changed")
    );

    const names = tools(await session.request("tools/list")).map((t) => t.name);
    expect(names).toEqual(["swiss_discover", "swiss_call", ...moduleRegistry.gwr.tools.map((t) => t.name)]);
  });
});
