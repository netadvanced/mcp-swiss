import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { VERSION } from "./utils/http.js";

export interface HttpServerOptions {
  port: number;
  host: string;
  /** Builds a fresh MCP server for each session. */
  createMcpServer: () => Server;
  /** Optional bearer token required on /mcp (MCP_AUTH_TOKEN). */
  authToken?: string;
  /** Host headers accepted on /mcp; enables DNS-rebinding protection when set. */
  allowedHosts?: string[];
  /** Access-Control-Allow-Origin value for browser clients (MCP_CORS_ORIGIN). */
  corsOrigin?: string;
  /** Idle sessions are closed after this many ms (default 30 min). */
  sessionTtlMs?: number;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
  lastSeen: number;
}

const MAX_BODY_BYTES = 1_000_000;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function tokenMatches(header: string | undefined, token: string): boolean {
  const presented = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** Default Host allow-list when bound to loopback, so a local server can't be DNS-rebound. */
export function defaultAllowedHosts(host: string, port: number): string[] | undefined {
  const loopback = ["127.0.0.1", "localhost", "::1"];
  if (!loopback.includes(host)) return undefined;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

/**
 * Streamable HTTP transport (MCP spec 2025-03-26+). Stateful: one MCP server
 * per session, keyed by the Mcp-Session-Id header. Endpoints:
 *   POST/GET/DELETE /mcp  — MCP traffic
 *   GET /health           — liveness probe
 */
export function startHttpServer(opts: HttpServerOptions): Promise<HttpServer> {
  const sessions = new Map<string, Session>();
  const ttl = opts.sessionTtlMs ?? 30 * 60_000;

  const closeSession = (id: string) => {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    s.transport.close().catch(() => undefined);
    s.server.close().catch(() => undefined);
  };

  const sweeper = setInterval(() => {
    const cutoff = Date.now() - ttl;
    for (const [id, s] of sessions) if (s.lastSeen < cutoff) closeSession(id);
  }, Math.min(ttl, 60_000));
  sweeper.unref();

  const handleMcp = async (req: IncomingMessage, res: ServerResponse) => {
    if (opts.authToken && !tokenMatches(req.headers.authorization, opts.authToken)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return rpcError(res, 401, "Unauthorized");
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const body = req.method === "POST" ? await readJsonBody(req) : undefined;

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return rpcError(res, 404, "Session not found");
      session.lastSeen = Date.now();
      return session.transport.handleRequest(req, res, body);
    }

    if (req.method !== "POST" || !isInitializeRequest(body)) {
      return rpcError(res, 400, "Bad Request: no valid session ID provided");
    }

    const server = opts.createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: Boolean(opts.allowedHosts?.length),
      allowedHosts: opts.allowedHosts,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, lastSeen: Date.now() });
      },
      onsessionclosed: (id) => closeSession(id),
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };

  const httpServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (opts.corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", opts.corsOrigin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
    }

    if (url.pathname === "/health" && req.method === "GET") {
      return sendJson(res, 200, { status: "ok", version: VERSION, sessions: sessions.size });
    }

    if (url.pathname === "/mcp") {
      handleMcp(req, res).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) rpcError(res, message.includes("JSON") ? 400 : 500, message);
      });
      return;
    }

    sendJson(res, 404, { error: "Not found. MCP endpoint is /mcp" });
  });

  httpServer.on("close", () => {
    clearInterval(sweeper);
    for (const id of [...sessions.keys()]) closeSession(id);
  });

  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => resolve(httpServer));
  });
}
