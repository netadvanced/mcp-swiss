import { readFileSync } from "node:fs";
import { join } from "node:path";

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
export const USER_AGENT = `mcp-swiss/${VERSION}`;

const envTimeout = Number(process.env.MCP_SWISS_TIMEOUT_MS);
export const DEFAULT_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 15000;

/**
 * fetch() wrapper used by every module: sets the mcp-swiss User-Agent and
 * aborts after DEFAULT_TIMEOUT_MS (override with MCP_SWISS_TIMEOUT_MS) so a
 * hanging upstream API cannot stall a tool call forever.
 */
export async function httpFetch(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...options,
      headers: { "User-Agent": USER_AGENT, ...(options.headers as Record<string, string> | undefined) },
      signal: options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s — ${url}`, { cause: err });
    }
    throw err;
  }
}

export async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await httpFetch(url, {
    ...options,
    headers: {
      "Accept": "application/json",
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} — ${url}`);
  }

  return response.json() as Promise<T>;
}

export function buildUrl(base: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
