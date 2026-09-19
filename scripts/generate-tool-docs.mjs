#!/usr/bin/env node
// Regenerates docs/tools.schema.json and the `tools` array of manifest.json
// from the built tool registry (dist/registry.js).
//
// Usage:
//   npm run docs:tools                              # build + regenerate
//   node scripts/generate-tool-docs.mjs --check     # exit 1 if files are out of date
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { moduleRegistry } from "../dist/registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const tools = Object.values(moduleRegistry).flatMap((m) => m.tools);

// ── docs/tools.schema.json ───────────────────────────────────────────────────
const schemaPath = join(root, "docs/tools.schema.json");
const schemaDoc = {
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
};
const schemaOut = JSON.stringify(schemaDoc, null, 2) + "\n";

// ── manifest.json (only the top-level "tools" array is replaced) ────────────
// The rest of the file is preserved byte-for-byte (it contains \u escapes that a
// JSON.parse/stringify round trip would rewrite).
const manifestPath = join(root, "manifest.json");
const manifestIn = readFileSync(manifestPath, "utf8");
const toolsBlock = JSON.stringify(tools.map(({ name, description }) => ({ name, description })), null, 2)
  .split("\n")
  .map((line, i) => (i === 0 ? line : "  " + line))
  .join("\n");
const toolsRe = /\n {2}"tools": \[[\s\S]*?\n {2}\]/;
if (!toolsRe.test(manifestIn)) {
  console.error('manifest.json: top-level "tools" array not found');
  process.exit(2);
}
const manifestOut = manifestIn.replace(toolsRe, () => `\n  "tools": ${toolsBlock}`);
// Sanity check: result must still be valid JSON with the expected tools.
if (JSON.stringify(JSON.parse(manifestOut).tools.map((t) => t.name)) !== JSON.stringify(tools.map((t) => t.name))) {
  console.error("manifest.json: regenerated tools array does not round-trip");
  process.exit(2);
}

const targets = [
  { path: schemaPath, label: "docs/tools.schema.json", content: schemaOut },
  { path: manifestPath, label: "manifest.json", content: manifestOut },
];

let stale = 0;
for (const t of targets) {
  let current = null;
  try {
    current = readFileSync(t.path, "utf8");
  } catch {
    // missing file counts as stale
  }
  if (current === t.content) {
    console.log(`${t.label}: up to date`);
    continue;
  }
  if (check) {
    console.error(`${t.label}: out of date — run \`npm run docs:tools\``);
    stale++;
  } else {
    writeFileSync(t.path, t.content);
    console.log(`${t.label}: updated (${tools.length} tools)`);
  }
}

if (check && stale > 0) process.exit(1);
