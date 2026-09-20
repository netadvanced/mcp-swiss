import { describe, it, expect, vi, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

import { createServer, SERVER_NAME } from "../../src/server.js";
import { resolveModules, moduleRegistry } from "../../src/registry.js";
import { VERSION } from "../../src/utils/http.js";

async function connect(opts: Parameters<typeof createServer>[0]) {
  const server = createServer(opts);
  const client = new Client({ name: "test", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createServer (static mode)", () => {
  it("reports name and package version", async () => {
    const { client } = await connect({ modules: resolveModules(null) });
    expect(client.getServerVersion()).toEqual({ name: SERVER_NAME, version: VERSION });
  });

  it("lists only the selected modules' tools, annotated read-only", async () => {
    const { client } = await connect({ modules: resolveModules(new Set(["holidays"])) });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      moduleRegistry.holidays.tools.map((t) => t.name).sort()
    );
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("does not expose discovery tools or listChanged", async () => {
    const { client } = await connect({ modules: resolveModules(new Set(["holidays"])) });
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "swiss_discover")).toBeUndefined();
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(false);
  });

  it("returns isError for unknown tools", async () => {
    const { client } = await connect({ modules: [] });
    const result = await client.callTool({ name: "nope", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Unknown tool: nope");
  });

  it("returns isError when a handler throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { client } = await connect({ modules: resolveModules(new Set(["snow"])) });
    const result = await client.callTool({ name: "get_snow_conditions", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("network down");
  });
});

describe("createServer (discovery mode)", () => {
  it("starts with only the meta-tools and advertises listChanged", async () => {
    const { client } = await connect({ modules: [], discovery: true });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["swiss_discover", "swiss_call"]);
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(true);
  });

  it("does not mark the meta-tools read-only, but still does for data tools", async () => {
    const { client } = await connect({ modules: resolveModules(new Set(["holidays"])), discovery: true });
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));

    // swiss_discover loads modules and fires tools/list_changed
    expect(byName.get("swiss_discover")?.readOnlyHint).toBe(false);
    expect(byName.get("swiss_discover")?.idempotentHint).toBe(false);
    // swiss_call inherits whatever the proxied tool does
    expect(byName.get("swiss_call")?.readOnlyHint).toBe(false);
    expect(byName.get("swiss_call")?.idempotentHint).toBe(false);

    for (const tool of moduleRegistry.holidays.tools) {
      expect(byName.get(tool.name)?.readOnlyHint).toBe(true);
      expect(byName.get(tool.name)?.idempotentHint).toBe(true);
    }
  });

  it("swiss_discover without args returns the module catalog", async () => {
    const { client } = await connect({ modules: [], discovery: true });
    const catalog = JSON.parse(text(await client.callTool({ name: "swiss_discover", arguments: {} })));
    expect(catalog.modules).toHaveLength(Object.keys(moduleRegistry).length);
    const transport = catalog.modules.find((m: { name: string }) => m.name === "transport");
    expect(transport.description).toBeTruthy();
    expect(transport.tools).toContain("get_connections");
    expect(transport.loaded).toBe(false);
  });

  it("loading modules adds their tools and emits tools/list_changed once", async () => {
    const { client } = await connect({ modules: [], discovery: true });
    const changed = vi.fn();
    client.setNotificationHandler(ToolListChangedNotificationSchema, changed);

    const res = JSON.parse(
      text(await client.callTool({ name: "swiss_discover", arguments: { modules: ["holidays"] } }))
    );
    expect(res.newly_loaded).toEqual(["holidays"]);
    expect(res.tools.map((t: { name: string }) => t.name)).toContain("is_holiday_today");

    // Loading again is a no-op
    const again = JSON.parse(
      text(await client.callTool({ name: "swiss_discover", arguments: { modules: ["holidays"] } }))
    );
    expect(again.newly_loaded).toEqual([]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("is_holiday_today");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  });

  it("rejects unknown modules", async () => {
    const { client } = await connect({ modules: [], discovery: true });
    const result = await client.callTool({ name: "swiss_discover", arguments: { modules: ["mars"] } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Unknown modules: mars");
  });

  it("points to swiss_discover when calling a tool from an unloaded module", async () => {
    const { client } = await connect({ modules: [], discovery: true });
    const result = await client.callTool({ name: "get_weather", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("module 'weather'");
  });

  it("swiss_call proxies to loaded tools", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve([
        { startDate: "2026-08-01", endDate: "2026-08-01", name: [{ language: "EN", text: "Swiss National Day" }], nationwide: true },
      ]),
    }));
    const { client } = await connect({ modules: resolveModules(new Set(["holidays"])), discovery: true });
    const result = await client.callTool({
      name: "swiss_call",
      arguments: { tool: "get_public_holidays", arguments: { year: 2026, canton: "VD" } },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("Swiss National Day");
  });

  it("swiss_call refuses to call the meta-tools", async () => {
    const { client } = await connect({ modules: [], discovery: true });
    const result = await client.callTool({ name: "swiss_call", arguments: { tool: "swiss_call" } });
    expect(result.isError).toBe(true);
  });
});
