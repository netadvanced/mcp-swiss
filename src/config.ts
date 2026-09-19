import { moduleRegistry, presets } from "./registry.js";

// ── CLI Argument Parsing ─────────────────────────────────────────────────────

export interface ParsedArgs {
  modules: Set<string> | null;
  listModules: boolean;
  listPresets: boolean;
  /** Serve Streamable HTTP instead of stdio (--http or MCP_TRANSPORT=http). */
  http: boolean;
  port: number;
  host: string;
  /** Start with only the swiss_discover meta-tools and load modules on demand. */
  discovery: boolean;
}

function flagValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

export function parseArgs(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): ParsedArgs {
  const listModules = argv.includes("--list-modules");
  const listPresets = argv.includes("--list-presets");

  let selectedModules: Set<string> | null = null;

  // Parse --preset
  const presetName = flagValue(argv, "--preset");
  if (presetName) {
    if (!presets[presetName]) {
      process.stderr.write(
        `Unknown preset: ${presetName}\nAvailable: ${Object.keys(presets).join(", ")}\n`
      );
      process.exit(1);
    }
    selectedModules = new Set(presets[presetName]);
  }

  // Parse --modules (additive with preset)
  const modulesArg = flagValue(argv, "--modules");
  if (modulesArg) {
    const moduleNames = modulesArg.split(",").map((m) => m.trim());
    const invalid = moduleNames.filter((m) => !moduleRegistry[m]);
    if (invalid.length) {
      process.stderr.write(
        `Unknown modules: ${invalid.join(", ")}\nAvailable: ${Object.keys(moduleRegistry).join(", ")}\n`
      );
      process.exit(1);
    }
    if (selectedModules) {
      moduleNames.forEach((m) => selectedModules!.add(m));
    } else {
      selectedModules = new Set(moduleNames);
    }
  }

  const http = argv.includes("--http") || env.MCP_TRANSPORT?.toLowerCase() === "http";
  const port = Number(flagValue(argv, "--port") ?? env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`Invalid port: ${flagValue(argv, "--port") ?? env.PORT}\n`);
    process.exit(1);
  }
  const host = flagValue(argv, "--host") ?? env.HOST ?? "127.0.0.1";
  const discovery = argv.includes("--discovery") || env.MCP_SWISS_DISCOVERY === "1";

  return { modules: selectedModules, listModules, listPresets, http, port, host, discovery };
}

// ── List Helpers ─────────────────────────────────────────────────────────────

export function printModules(): void {
  process.stdout.write("\nAvailable modules:\n\n");
  for (const [name, mod] of Object.entries(moduleRegistry)) {
    process.stdout.write(
      `  ${name.padEnd(14)} ${String(mod.tools.length).padStart(2)} tools  ${mod.description}\n`
    );
  }
  process.stdout.write(
    "\nUsage: npx mcp-swiss-ng --modules transport,weather\n\n"
  );
}

export function printPresets(): void {
  process.stdout.write("\nAvailable presets:\n\n");
  for (const [name, modules] of Object.entries(presets)) {
    const toolCount = modules.reduce(
      (sum, m) => sum + (moduleRegistry[m]?.tools.length || 0),
      0
    );
    process.stdout.write(
      `  ${name.padEnd(12)} ${String(toolCount).padStart(3)} tools  [${modules.join(", ")}]\n`
    );
  }
  process.stdout.write("\nUsage: npx mcp-swiss-ng --preset commuter\n");
  process.stdout.write(
    "Combine: npx mcp-swiss-ng --preset commuter --modules parliament\n\n"
  );
}
