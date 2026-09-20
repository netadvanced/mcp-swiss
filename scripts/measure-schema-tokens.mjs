#!/usr/bin/env node
// Measures the size of the tool schemas sent to the model (tools/list payload).
// Usage: npm run build && node scripts/measure-schema-tokens.mjs [--json]
// Token count is approximate: characters / 4.
import { moduleRegistry } from "../dist/registry.js";

const approxTokens = (chars) => Math.round(chars / 4);

const rows = Object.entries(moduleRegistry).map(([name, mod]) => {
  const chars = JSON.stringify(mod.tools).length;
  return { module: name, tools: mod.tools.length, chars, tokens: approxTokens(chars) };
});
const allTools = Object.values(moduleRegistry).flatMap((m) => m.tools);
const totalChars = JSON.stringify(allTools).length;
const total = { module: "TOTAL", tools: allTools.length, chars: totalChars, tokens: approxTokens(totalChars) };

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ modules: rows, total }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(`${pad("module", 12)} ${lpad("tools", 5)} ${lpad("chars", 7)} ${lpad("~tokens", 8)}`);
  for (const r of [...rows, total]) {
    console.log(`${pad(r.module, 12)} ${lpad(r.tools, 5)} ${lpad(r.chars, 7)} ${lpad(r.tokens, 8)}`);
  }
}
