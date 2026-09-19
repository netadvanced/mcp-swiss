import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startHttpServer, defaultAllowedHosts, type HttpServerOptions } from "../../src/http-server.js";
import { createServer } from "../../src/server.js";
import { resolveModules } from "../../src/registry.js";

let httpServer: HttpServer | undefined;

afterEach(async () => {
  if (httpServer) {
    httpServer.closeAllConnections();
    await new Promise((r) => httpServer!.close(r));
    httpServer = undefined;
  }
});

async function start(extra: Partial<HttpServerOptions> = {}) {
  httpServer = await startHttpServer({
    port: 0,
    host: "127.0.0.1",
    createMcpServer: () => createServer({ modules: resolveModules(new Set(["holidays"])) }),
    ...extra,
  });
  const { port } = httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function connectClient(base: string, headers: Record<string, string> = {}) {
  const client = new Client({ name: "test", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } });
  await client.connect(transport);
  return { client, transport };
}

const initBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
});
const mcpHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

describe("HTTP transport", () => {
  it("serves /health", async () => {
    const base = await start();
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.sessions).toBe(0);
  });

  it("returns 404 for unknown paths", async () => {
    const base = await start();
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("runs a full MCP session with the SDK client", async () => {
    const base = await start();
    const { client, transport } = await connectClient(base);
    expect(transport.sessionId).toBeTruthy();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("is_holiday_today");

    const health = await (await fetch(`${base}/health`)).json();
    expect(health.sessions).toBe(1);

    await transport.terminateSession();
    const after = await (await fetch(`${base}/health`)).json();
    expect(after.sessions).toBe(0);
  });

  it("isolates sessions", async () => {
    const base = await start();
    const a = await connectClient(base);
    const b = await connectClient(base);
    expect(a.transport.sessionId).not.toBe(b.transport.sessionId);
  });

  it("rejects non-initialize requests without a session", async () => {
    const base = await start();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown session id", async () => {
    const base = await start();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders, "Mcp-Session-Id": "does-not-exist" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 on malformed JSON", async () => {
    const base = await start();
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: "{not json" });
    expect(res.status).toBe(400);
  });

  it("requires the bearer token when configured", async () => {
    const base = await start({ authToken: "s3cret" });
    const denied = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initBody });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toBe("Bearer");

    const wrong = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders, Authorization: "Bearer nope" },
      body: initBody,
    });
    expect(wrong.status).toBe(401);

    const { client } = await connectClient(base, { Authorization: "Bearer s3cret" });
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });

  it("rejects foreign Host headers when an allow-list is set", async () => {
    const base = await start({ allowedHosts: ["mcp.example.ch"] });
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initBody });
    expect(res.status).toBe(403);
  });

  it("answers CORS preflight when an origin is configured", async () => {
    const base = await start({ corsOrigin: "https://inspector.example" });
    const res = await fetch(`${base}/mcp`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://inspector.example");
    expect(res.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");
  });

  it("expires idle sessions", async () => {
    const base = await start({ sessionTtlMs: 50 });
    await connectClient(base);
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(0);
  });
});

describe("defaultAllowedHosts", () => {
  it("locks loopback binds to loopback Host headers", () => {
    expect(defaultAllowedHosts("127.0.0.1", 3000)).toEqual([
      "127.0.0.1:3000",
      "localhost:3000",
      "[::1]:3000",
    ]);
  });

  it("returns undefined for public binds (configure MCP_ALLOWED_HOSTS instead)", () => {
    expect(defaultAllowedHosts("0.0.0.0", 3000)).toBeUndefined();
  });
});
