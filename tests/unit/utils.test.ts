import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildUrl, fetchJSON, httpFetch, USER_AGENT, VERSION } from '../../src/utils/http.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── buildUrl ──────────────────────────────────────────────────────────────────

describe('buildUrl', () => {
  it('returns base URL unchanged when no params', () => {
    const url = buildUrl('https://example.com/api', {});
    expect(url).toBe('https://example.com/api');
  });

  it('appends string param', () => {
    const url = buildUrl('https://example.com/api', { query: 'Bern' });
    expect(url).toContain('query=Bern');
  });

  it('appends numeric param', () => {
    const url = buildUrl('https://example.com/api', { limit: 10 });
    expect(url).toContain('limit=10');
  });

  it('skips undefined values', () => {
    const url = buildUrl('https://example.com/api', { a: 'yes', b: undefined });
    expect(url).toContain('a=yes');
    expect(url).not.toContain('b=');
  });

  it('skips empty string values', () => {
    const url = buildUrl('https://example.com/api', { a: 'x', b: '' });
    expect(url).not.toContain('b=');
  });

  it('encodes special characters', () => {
    const url = buildUrl('https://example.com/api', { name: 'Zürich HB' });
    // URL encoding: ü → %C3%BC, space → +/%20
    expect(url).toContain('name=');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('name')).toBe('Zürich HB');
  });

  it('appends multiple params', () => {
    const url = buildUrl('https://example.com/api', {
      from: 'Bern',
      to: 'Zürich',
      limit: 4,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('from')).toBe('Bern');
    expect(parsed.searchParams.get('to')).toBe('Zürich');
    expect(parsed.searchParams.get('limit')).toBe('4');
  });

  it('handles boolean params', () => {
    const url = buildUrl('https://example.com/api', { flag: true });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('flag')).toBe('true');
  });
});

// ── fetchJSON ─────────────────────────────────────────────────────────────────

describe('fetchJSON', () => {
  it('returns parsed JSON on 200', async () => {
    const payload = { hello: 'world', count: 42 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    }));

    const result = await fetchJSON('https://example.com/api');
    expect(result).toEqual(payload);
  });

  it('throws on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.resolve({}),
    }));

    await expect(fetchJSON('https://example.com/missing')).rejects.toThrow('HTTP 404');
  });

  it('throws on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({}),
    }));

    await expect(fetchJSON('https://example.com/error')).rejects.toThrow('HTTP 500');
  });

  it('throws on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    await expect(fetchJSON('https://example.com/api')).rejects.toThrow('Network error');
  });

  it('includes URL in error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({}),
    }));

    await expect(fetchJSON('https://example.com/myendpoint'))
      .rejects.toThrow('https://example.com/myendpoint');
  });

  it('passes custom request options', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchJSON('https://example.com/api', {
      method: 'POST',
      headers: { 'X-Custom': 'header' },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Custom']).toBe('header');
  });
});

// ── httpFetch ─────────────────────────────────────────────────────────────────

describe('httpFetch', () => {
  it('sends the versioned User-Agent and a timeout signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await httpFetch('https://example.com/api', { headers: { Accept: 'text/plain' } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(USER_AGENT);
    expect(headers.Accept).toBe('text/plain');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('derives the User-Agent from package.json', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(USER_AGENT).toBe(`mcp-swiss-ng/${VERSION}`);
  });

  it('honours a per-call timeoutMs and does not forward it to fetch', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(httpFetch('https://example.com/slow', { timeoutMs: 120_000 })).rejects.toThrow('timed out after 120s');
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('timeoutMs');
  });

  it('turns an abort timeout into a readable error', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    await expect(httpFetch('https://example.com/slow')).rejects.toThrow(/timed out after .* https:\/\/example\.com\/slow/);
  });
});
