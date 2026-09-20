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
export const USER_AGENT = `mcp-swiss-ng/${VERSION}`;

const envTimeout = Number(process.env.MCP_SWISS_TIMEOUT_MS);
export const DEFAULT_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 30000;

export interface HttpOptions extends RequestInit {
  /** Per-call override of DEFAULT_TIMEOUT_MS for known-slow upstreams. */
  timeoutMs?: number;
  /** Extra attempts after a dropped connection (default 1). */
  retries?: number;
}

const RETRY_DELAY_MS = 400;

/**
 * Connection-level failures worth one more try: some upstreams (notably
 * transport.opendata.ch under its per-IP rate limit) close the socket
 * mid-response. Timeouts and HTTP error statuses are not retried.
 */
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error) || err.name === "TimeoutError") return false;
  const codes = ["UND_ERR_SOCKET", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "EAI_AGAIN"];
  const cause = (err as { cause?: { code?: string } }).cause;
  return err.message === "fetch failed" || codes.includes(cause?.code ?? "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch() wrapper used by every module: sets the mcp-swiss-ng User-Agent and
 * aborts after DEFAULT_TIMEOUT_MS (override with MCP_SWISS_TIMEOUT_MS) so a
 * hanging upstream API cannot stall a tool call forever. Every request is a
 * read-only GET/POST search, so a dropped connection is retried once.
 */
export async function httpFetch(url: string, options: HttpOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, ...init } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(`Request timed out after ${timeoutMs / 1000}s — ${url}`, { cause: err });
      }
      lastError = err;
      if (attempt === retries || !isTransientNetworkError(err)) break;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}

export async function fetchJSON<T>(url: string, options?: HttpOptions): Promise<T> {
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
