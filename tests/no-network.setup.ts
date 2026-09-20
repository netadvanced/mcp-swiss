/**
 * `npm test` must never touch the network: a test that quietly reaches a live
 * API passes on real data, hides a broken mock, and fails in a sandbox. Any
 * fetch a test has not stubbed lands here and fails loudly.
 */
// tests/integration exists to call the real APIs, so it opts out.
const live = process.env.VITEST_ALLOW_NETWORK === "1";
const passthrough = globalThis.fetch;

globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  const input = args[0];
  const url = typeof input === "string" ? input : (input as Request | URL).toString();
  if (!live && /^https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])/.test(url)) {
    throw new Error(
      `Test made a real network request to ${url}. Stub fetch (vi.stubGlobal) or move it to tests/integration.`
    );
  }
  return passthrough(...args);
}) as typeof fetch;
