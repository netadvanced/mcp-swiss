#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { parseArgs, printModules, printPresets } from "./config.js";
import {
  startHttpServer,
  defaultAllowedHosts,
  publicBindProblems,
  isLoopbackBind,
} from "./http-server.js";
import { resolveModules } from "./registry.js";
import { createServer, SERVER_NAME } from "./server.js";
import { VERSION } from "./utils/http.js";

async function main(): Promise<void> {
  const config = parseArgs();

  if (config.listModules) {
    printModules();
    return;
  }
  if (config.listPresets) {
    printPresets();
    return;
  }

  // Discovery mode starts empty unless modules/presets were given explicitly.
  const modules =
    config.discovery && !config.modules ? [] : resolveModules(config.modules);
  const toolCount = modules.reduce((n, m) => n + m.tools.length, 0);
  const mode = config.discovery ? ", discovery" : "";
  const summary = `${modules.length} modules, ${toolCount} tools${mode}`;

  if (config.http) {
    const env = process.env;
    const allowedHosts = env.MCP_ALLOWED_HOSTS
      ? env.MCP_ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean)
      : defaultAllowedHosts(config.host, config.port);
    const authToken = env.MCP_AUTH_TOKEN || undefined;

    const problems = publicBindProblems({ host: config.host, authToken, allowedHosts });
    if (problems.length) {
      process.stderr.write(
        `Refusing to listen on ${config.host}: ${problems.join(" and ")}.\n` +
          "A server reachable from outside this machine needs a bearer token and a Host allow-list:\n" +
          "  MCP_AUTH_TOKEN=<secret> MCP_ALLOWED_HOSTS=mcp.example.ch:3000 ...\n" +
          "Or bind to loopback (--host 127.0.0.1) and put a reverse proxy in front.\n"
      );
      process.exit(1);
    }

    const httpServer = await startHttpServer({
      port: config.port,
      host: config.host,
      authToken,
      allowedHosts,
      corsOrigin: env.MCP_CORS_ORIGIN || undefined,
      maxSessions: Number(env.MCP_MAX_SESSIONS) > 0 ? Number(env.MCP_MAX_SESSIONS) : undefined,
      exposeSessionCount: isLoopbackBind(config.host),
      createMcpServer: () => createServer({ modules, discovery: config.discovery }),
    });
    const shutdown = () => {
      httpServer.close(() => process.exit(0));
      httpServer.closeAllConnections();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.stderr.write(
      `${SERVER_NAME} ${VERSION} listening on http://${config.host}:${config.port}/mcp (${summary})\n`
    );
    return;
  }

  const server = createServer({ modules, discovery: config.discovery });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${SERVER_NAME} ${VERSION} running on stdio (${summary})\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
