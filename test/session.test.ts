import { describe, it, expect } from 'vitest';
import { Session } from '../src/auth/session.js';
import { Http } from '../src/http/client.js';

const memKeychain = () => {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    del: async (k: string) => void m.delete(k),
  };
};

function fakeFetch(map: Record<string, { status: number; location?: string; setCookie?: string[]; body?: string }>) {
  return async (url: string, init?: any) => {
    const key = init?.method === 'POST' ? 'POST ' + url : url;
    const r = map[key] || map[url] || { status: 404, body: '' };
    const h = new Headers();
    (r.setCookie || []).forEach((c) => h.append('set-cookie', c));
    if (r.location) h.set('location', r.location);
    return { status: r.status, headers: h, text: async () => r.body || '' } as any;
  };
}

describe('Session', () => {
  it('logs in, captures cookies, stores them', async () => {
    const kc = memKeychain();
    const fetchFn = fakeFetch({
      'https://www.kicktipp.de/info/profil/login': { status: 200, body: '<form action="/info/profil/loginaction"><input name="kennung"><input name="passwort"></form>' },
      'POST https://www.kicktipp.de/info/profil/loginaction': { status: 302, location: 'https://www.kicktipp.de/', setCookie: ['login=TOK', 'SESSION=S'] },
      'https://www.kicktipp.de/': { status: 200, body: '<a href="/logout">Abmelden</a>' },
    }) as unknown as typeof fetch;
    const s = new Session({ email: 'e@x.de', password: 'pw', keychain: kc, makeHttp: (cookies) => new Http({ cookies, fetchFn }) });
    await s.login();
    expect((await s.http()).cookies().login).toBe('TOK');
    expect(await kc.get('kicktipp:e@x.de')).toContain('TOK');
  });
});
