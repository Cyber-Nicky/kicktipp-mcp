import type { HttpResponse } from '../domain/types.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_HOPS = 6;

interface StoredCookie {
  value: string;
  domain: string;       // host (host-only) or registrable domain (if a valid Domain attr was sent)
  hostOnly: boolean;    // true => exact host match required
  path: string;
  secure: boolean;
  expiresAt: number | null; // epoch ms; null = session cookie (valid for the process)
}

function domainMatches(cookieDomain: string, reqHost: string): boolean {
  return reqHost === cookieDomain || reqHost.endsWith('.' + cookieDomain);
}

function pathMatches(cookiePath: string, reqPath: string): boolean {
  if (cookiePath === '/' || cookiePath === reqPath) return true;
  const base = cookiePath.endsWith('/') ? cookiePath : cookiePath + '/';
  return reqPath.startsWith(base);
}

/**
 * Minimal but origin-aware HTTP client. The cookie jar is scoped to the origin a cookie
 * was set on, so the session token (`login`/`SESSION`) is never sent to a different host —
 * including across redirects. Refuses https→http downgrades and caps redirect hops.
 */
export class Http {
  private jar = new Map<string, StoredCookie>(); // key: `${domain}\n${path}\n${name}`
  private fetchFn: typeof fetch;
  private defaultHost: string;

  constructor(opts: { cookies?: Record<string, string>; fetchFn?: typeof fetch; host?: string } = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.defaultHost = opts.host ?? 'www.kicktipp.de';
    // Injected (saved-session) cookies are scoped to the configured host, secure by default.
    for (const [name, value] of Object.entries(opts.cookies ?? {})) {
      this.jar.set(`${this.defaultHost}\n/\n${name}`, { value, domain: this.defaultHost, hostOnly: true, path: '/', secure: true, expiresAt: null });
    }
  }

  /** Flat name→value view (for session persistence). Last write wins on name collisions. */
  cookies(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, c] of this.jar) out[keyNameFromKey(key)] = c.value;
    return out;
  }

  private ingest(setCookies: string[], reqUrl: URL): void {
    for (const raw of setCookies) {
      const parts = raw.split(';');
      const first = parts[0];
      const eq = first.indexOf('=');
      if (eq < 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (!name) continue;

      let domain = reqUrl.hostname;
      let hostOnly = true;
      let path = '/';
      let secure = false;
      let maxAge: number | null = null;
      let expires: number | null = null;

      for (const attr of parts.slice(1)) {
        const ai = attr.indexOf('=');
        const key = (ai < 0 ? attr : attr.slice(0, ai)).trim().toLowerCase();
        const val = ai < 0 ? '' : attr.slice(ai + 1).trim();
        if (key === 'secure') secure = true;
        else if (key === 'path' && val.startsWith('/')) path = val;
        else if (key === 'max-age') { const n = parseInt(val, 10); if (Number.isFinite(n)) maxAge = n; }
        else if (key === 'expires') { const t = Date.parse(val); if (Number.isFinite(t)) expires = t; }
        else if (key === 'domain' && val) {
          const d = val.replace(/^\./, '').toLowerCase();
          // Only honour a Domain that the request host belongs to; otherwise scope host-only.
          if (domainMatches(d, reqUrl.hostname)) { domain = d; hostOnly = false; }
        }
      }

      const key = `${domain}\n${path}\n${name}`;
      const expiresAt = maxAge != null ? Date.now() + maxAge * 1000 : expires;
      // Deletion is signalled by an expiry in the past (Max-Age<=0 / past Expires) — never by value contents.
      if (expiresAt != null && expiresAt <= Date.now()) { this.jar.delete(key); continue; }
      this.jar.set(key, { value, domain, hostOnly, path, secure, expiresAt });
    }
  }

  private cookieHeaderFor(reqUrl: URL): string {
    const now = Date.now();
    const https = reqUrl.protocol === 'https:';
    const pairs: string[] = [];
    for (const [key, c] of [...this.jar]) {
      if (c.expiresAt != null && c.expiresAt <= now) { this.jar.delete(key); continue; }
      if (c.secure && !https) continue;
      const hostOk = c.hostOnly ? reqUrl.hostname === c.domain : domainMatches(c.domain, reqUrl.hostname);
      if (!hostOk) continue;
      if (!pathMatches(c.path, reqUrl.pathname)) continue;
      pairs.push(`${keyNameFromKey(key)}=${c.value}`);
    }
    return pairs.join('; ');
  }

  private async go(method: string, url: string, body?: string, contentType?: string): Promise<HttpResponse> {
    let cur = new URL(url);
    let m = method, b = body, ct = contentType, hops = 0;
    while (true) {
      const headers: Record<string, string> = { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9' };
      const cookie = this.cookieHeaderFor(cur);
      if (cookie) headers['Cookie'] = cookie;
      if (b != null && ct) headers['Content-Type'] = ct;

      const res = await this.fetchFn(cur.toString(), { method: m, headers, body: b, redirect: 'manual' } as RequestInit);
      const sc = typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [];
      this.ingest(sc, cur);

      const loc = res.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(res.status) && loc && hops < MAX_HOPS) {
        const next = new URL(loc, cur);
        if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error(`refusing redirect to unsupported scheme: ${next.protocol}`);
        if (cur.protocol === 'https:' && next.protocol === 'http:') throw new Error('refusing insecure redirect downgrade (https -> http)');
        // Cross-origin hop: drop the request body (cookies are already origin-scoped on send).
        if (next.host !== cur.host && (m === 'POST' || b != null)) { m = 'GET'; b = undefined; ct = undefined; }
        if (res.status === 302 || res.status === 303) { m = 'GET'; b = undefined; ct = undefined; }
        cur = next; hops++;
        continue;
      }
      return { status: res.status, finalUrl: cur.toString(), html: await res.text() };
    }
  }

  get(url: string) { return this.go('GET', url); }
  postForm(url: string, params: Record<string, string>) { return this.go('POST', url, new URLSearchParams(params).toString(), 'application/x-www-form-urlencoded'); }
}

function keyNameFromKey(key: string): string { return key.slice(key.lastIndexOf('\n') + 1); }
