import { describe, it, expect, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import {
  startHttpServer,
  defaultAllowedHosts,
  publicBindProblems,
  type HttpServerOptions,
} from "../../src/http-server.js";
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

  it("expires idle sessions without an open stream", async () => {
    const base = await start({ sessionTtlMs: 50 });
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initBody });
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    await res.text();
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(1);
    await new Promise((r) => setTimeout(r, 250));
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(0);
  });

  it("keeps a session with an open event stream alive", async () => {
    const base = await start({ sessionTtlMs: 50 });
    const { client } = await connectClient(base); // the SDK client holds a GET stream
    await new Promise((r) => setTimeout(r, 250));
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(1);
    // still usable, i.e. the sweeper did not close it underneath us
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });

  it("caps concurrent sessions with 429 + Retry-After", async () => {
    const base = await start({ maxSessions: 2 });
    for (let i = 0; i < 2; i++) {
      const ok = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initBody });
      expect(ok.status).toBe(200);
      await ok.text();
    }
    const denied = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initBody });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("60");
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(2);
  });

  it("keeps the cap under concurrent initializes", async () => {
    const base = await start({ maxSessions: 3 });
    const attempts = Array.from({ length: 12 }, () =>
      fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initBody })
    );
    const results = await Promise.all(attempts);
    await Promise.all(results.map((r) => r.text()));

    const accepted = results.filter((r) => r.status === 200).length;
    const rejected = results.filter((r) => r.status === 429).length;
    expect(accepted).toBe(3);
    expect(rejected).toBe(9);
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(3);
  });

  it("does not count or strand a handshake that never completes", async () => {
    const base = await start({ maxSessions: 2 });
    // An initialize the SDK rejects: no session is created, and the slot must
    // be released rather than held by an orphaned server.
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // missing the SSE Accept
        body: initBody,
      });
      await res.text();
    }
    expect((await (await fetch(`${base}/health`)).json()).sessions).toBe(0);

    // The cap is still fully available afterwards.
    const ok = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initBody });
    expect(ok.status).toBe(200);
    await ok.text();
  });

  it("rejects a token of the wrong length without leaking it", async () => {
    const base = await start({ authToken: "correct-horse-battery-staple" });
    for (const attempt of ["", "short", "correct-horse-battery-stapl", "correct-horse-battery-staplee"]) {
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...mcpHeaders, Authorization: `Bearer ${attempt}` },
        body: initBody,
      });
      expect(res.status).toBe(401);
      await res.text();
    }
  });

  it("returns 413 for an oversized body", async () => {
    const base = await start();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: mcpHeaders,
      body: "x".repeat(1_100_000),
    });
    expect(res.status).toBe(413);
  });

  it("hides internal errors behind a generic 500", async () => {
    const base = await start({
      createMcpServer: () => {
        throw new Error("secret internal detail");
      },
    });
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: mcpHeaders, body: initBody });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret internal detail");
  });

  it("omits the session count from /health when asked", async () => {
    const base = await start({ exposeSessionCount: false });
    expect(await (await fetch(`${base}/health`)).json()).toEqual({
      status: "ok",
      version: expect.any(String),
    });
  });
});

describe("publicBindProblems", () => {
  it("allows a loopback bind with no token or allow-list", () => {
    expect(publicBindProblems({ host: "127.0.0.1" })).toEqual([]);
    expect(publicBindProblems({ host: "localhost" })).toEqual([]);
  });

  it("requires a token and an allow-list on a public bind", () => {
    expect(publicBindProblems({ host: "0.0.0.0" })).toEqual([
      "MCP_AUTH_TOKEN is not set",
      "MCP_ALLOWED_HOSTS is not set",
    ]);
    expect(publicBindProblems({ host: "0.0.0.0", authToken: "t" })).toEqual([
      "MCP_ALLOWED_HOSTS is not set",
    ]);
    expect(publicBindProblems({ host: "0.0.0.0", authToken: "t", allowedHosts: [] })).toEqual([
      "MCP_ALLOWED_HOSTS is not set",
    ]);
    expect(
      publicBindProblems({ host: "0.0.0.0", authToken: "t", allowedHosts: ["mcp.example.ch:3000"] })
    ).toEqual([]);
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
