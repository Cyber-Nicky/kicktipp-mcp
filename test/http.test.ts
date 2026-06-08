import { describe, it, expect } from 'vitest';
import { Http } from '../src/http/client.js';

interface Route { status: number; location?: string; setCookie?: string[]; body?: string }

function fakeFetch(routes: Record<string, Route>) {
  return async (url: string | URL | Request) => {
    const key = url instanceof Request ? url.url : url.toString();
    const r = routes[key] || { status: 404, body: '' };
    const headers = new Headers(); (r.setCookie || []).forEach((c) => headers.append('set-cookie', c));
    if (r.location) headers.set('location', r.location);
    return { status: r.status, headers, text: async () => r.body || '' } as unknown as Response;
  };
}

// Records the Cookie header each outbound request carried, so we can assert on leakage.
function recordingFetch(routes: Record<string, Route>, seen: { url: string; cookie: string | null }[]) {
  return async (url: string | URL | Request, init?: RequestInit) => {
    const key = url instanceof Request ? url.url : url.toString();
    const cookie = (init?.headers as Record<string, string> | undefined)?.['Cookie'] ?? null;
    seen.push({ url: key, cookie });
    const r = routes[key] || { status: 404, body: '' };
    const headers = new Headers(); (r.setCookie || []).forEach((c) => headers.append('set-cookie', c));
    if (r.location) headers.set('location', r.location);
    return { status: r.status, headers, text: async () => r.body || '' } as unknown as Response;
  };
}

describe('Http', () => {
  it('follows redirects and accumulates cookies', async () => {
    const http = new Http({ fetchFn: fakeFetch({
      'https://x/a': { status: 302, location: 'https://x/b', setCookie: ['login=tok; Path=/'] },
      'https://x/b': { status: 200, body: 'OK', setCookie: ['SESSION=s'] },
    }) });
    const res = await http.get('https://x/a');
    expect(res.finalUrl).toBe('https://x/b');
    expect(res.html).toBe('OK');
    expect(http.cookies()).toMatchObject({ login: 'tok', SESSION: 's' });
  });

  it('does NOT leak cookies to a cross-origin redirect target', async () => {
    const seen: { url: string; cookie: string | null }[] = [];
    const http = new Http({ fetchFn: recordingFetch({
      'https://www.kicktipp.de/a': { status: 302, location: 'https://evil.example/b', setCookie: ['login=secret; Path=/'] },
      'https://evil.example/b': { status: 200, body: 'X' },
    }, seen) });
    await http.get('https://www.kicktipp.de/a');
    const evilReq = seen.find((s) => s.url === 'https://evil.example/b');
    expect(evilReq).toBeDefined();
    expect(evilReq!.cookie).toBeNull(); // session token must not be sent off-origin
  });

  it('refuses an https -> http downgrade redirect', async () => {
    const http = new Http({ fetchFn: fakeFetch({
      'https://www.kicktipp.de/a': { status: 302, location: 'http://www.kicktipp.de/a' },
    }) });
    await expect(http.get('https://www.kicktipp.de/a')).rejects.toThrow(/downgrade|insecure/i);
  });

  it('sends injected (saved-session) cookies to the configured host only', async () => {
    const seen: { url: string; cookie: string | null }[] = [];
    const http = new Http({ host: 'www.kicktipp.de', cookies: { login: 'tok' }, fetchFn: recordingFetch({
      'https://www.kicktipp.de/x': { status: 200, body: 'OK' },
    }, seen) });
    await http.get('https://www.kicktipp.de/x');
    expect(seen[0].cookie).toContain('login=tok');
  });

  it('deletes a cookie via Max-Age=0 (not a substring match on the value)', async () => {
    const http = new Http({ host: 'x', cookies: { a: '1' }, fetchFn: fakeFetch({
      'https://x/1': { status: 200, body: '', setCookie: ['a=; Max-Age=0'] },
    }) });
    await http.get('https://x/1');
    expect(http.cookies().a).toBeUndefined();
  });

  it('does not delete a cookie merely because its value contains "deleted"', async () => {
    const http = new Http({ fetchFn: fakeFetch({
      'https://x/1': { status: 200, body: '', setCookie: ['token=abc-deleted-xyz; Path=/'] },
    }) });
    await http.get('https://x/1');
    expect(http.cookies().token).toBe('abc-deleted-xyz');
  });
});
