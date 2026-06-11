import { describe, it, expect } from 'vitest';
import { parseLeaderboardPage } from '../src/scrape/leaderboard.js';
import { KickTippClient } from '../src/core.js';
import { fixture } from './helpers.js';

function stubSession(pages: Record<string, string>) {
  const http = { async get(url: string) { const key = Object.keys(pages).find((k) => url.includes(k)) || ''; return { status: 200, finalUrl: url, html: pages[key] || '' }; }, cookies: () => ({}) };
  return { http: async () => http } as any;
}

describe('parseLeaderboardPage', () => {
  it('parses the overall standings (gesamtuebersicht) with season totals as points', () => {
    const page = parseLeaderboardPage(fixture('gesamtuebersicht.html'));
    expect(page.entries).toHaveLength(24);
    expect(page.entries[0]).toEqual({ rank: 1, name: 'DirkErich', points: 4, bonusPoints: 0 });
    expect(page.spieltagIndex).toBeNull();
    expect(page.pageCount).toBe(1);
  });

  it('keeps display names verbatim, including non-ASCII', () => {
    const names = parseLeaderboardPage(fixture('gesamtuebersicht.html')).entries.map((e) => e.name);
    expect(names).toContain('Pauliña');
    expect(names).toContain('ScoreGPT');
  });

  it('gives tied participants the same rank', () => {
    const page = parseLeaderboardPage(fixture('gesamtuebersicht.html'));
    const topRanks = page.entries.filter((e) => e.points === page.entries[0].points).map((e) => e.rank);
    expect(topRanks.length).toBeGreaterThan(1);
    expect(new Set(topRanks)).toEqual(new Set([1]));
  });

  it('parses the per-matchday view (tippuebersicht) with round points and its spieltagIndex', () => {
    const page = parseLeaderboardPage(fixture('tippuebersicht.html'));
    expect(page.entries).toHaveLength(40);
    expect(page.entries[0]).toEqual({ rank: 1, name: 'Girly', points: 0, bonusPoints: 0 });
    expect(page.spieltagIndex).toBe(1);
  });

  it('inherits the previous rank when a tied row leaves the position cell empty, and treats dashes as 0', () => {
    const html = `<table id="ranking"><tbody>
      <tr class="teilnehmer"><td class="position">1.</td><td class="mg_class"><div class="mg_name">A</div></td><td class="bonus right">2</td><td class="right punkte">10</td></tr>
      <tr class="teilnehmer"><td class="position"></td><td class="mg_class"><div class="mg_name">B</div></td><td class="bonus right">-</td><td class="right punkte">10</td></tr>
      <tr class="teilnehmer"><td class="position">3.</td><td class="mg_class"><div class="mg_name">C (KI)</div></td><td class="bonus right"></td><td class="right punkte">-</td></tr>
    </tbody></table>`;
    const page = parseLeaderboardPage(html);
    expect(page.entries).toEqual([
      { rank: 1, name: 'A', points: 10, bonusPoints: 2 },
      { rank: 1, name: 'B', points: 10, bonusPoints: 0 },
      { rank: 3, name: 'C (KI)', points: 0, bonusPoints: 0 },
    ]);
  });

  it('reports the page count from seite= pager links', () => {
    const html = `<table id="ranking"><tbody>
      <tr class="teilnehmer"><td class="position">1.</td><td class="mg_class"><div class="mg_name">A</div></td><td class="right punkte">5</td></tr>
    </tbody></table>
    <div class="blaetterNavi"><a href="/x/gesamtuebersicht?seite=2">2</a><a href="/x/gesamtuebersicht?seite=3">3</a></div>`;
    expect(parseLeaderboardPage(html).pageCount).toBe(3);
  });

  it('throws when the page has no ranking table', () => {
    expect(() => parseLeaderboardPage('<html><body>Login</body></html>')).toThrow(/ranking/i);
  });
});

describe('KickTippClient.getLeaderboard', () => {
  it('returns the overall standings as a top-level object (never a bare array)', async () => {
    const c = new KickTippClient(stubSession({ gesamtuebersicht: fixture('gesamtuebersicht.html') }), 'https://www.kicktipp.de');
    const lb = await c.getLeaderboard({ community: 'beckenbauer2026' });
    expect(Array.isArray(lb)).toBe(false);
    expect(lb.community).toBe('beckenbauer2026');
    expect(lb.spieltagIndex).toBeNull();
    expect(lb.items).toHaveLength(24);
    expect(lb.items[0]).toEqual({ rank: 1, name: 'DirkErich', points: 4, bonusPoints: 0 });
  });

  it('returns per-round points for a specific matchday', async () => {
    const c = new KickTippClient(stubSession({ 'tippuebersicht?spieltagIndex=1': fixture('tippuebersicht.html') }), 'https://www.kicktipp.de');
    const lb = await c.getLeaderboard({ community: 'x', spieltagIndex: 1 });
    expect(lb.spieltagIndex).toBe(1);
    expect(lb.items).toHaveLength(40);
  });

  it('concatenates all pages of a paginated leaderboard', async () => {
    const row = (pos: number, name: string) =>
      `<tr class="teilnehmer"><td class="position">${pos}.</td><td class="mg_class"><div class="mg_name">${name}</div></td><td class="right punkte">${100 - pos}</td></tr>`;
    const page1 = `<table id="ranking"><tbody>${row(1, 'A')}${row(2, 'B')}</tbody></table><a href="?seite=2">2</a>`;
    const page2 = `<table id="ranking"><tbody>${row(3, 'C')}</tbody></table><a href="?seite=2">2</a>`;
    const c = new KickTippClient(stubSession({ 'seite=2': page2, gesamtuebersicht: page1 }), 'https://www.kicktipp.de');
    const lb = await c.getLeaderboard({ community: 'x' });
    expect(lb.items.map((e) => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('rejects an out-of-range matchday instead of silently returning the clamped one', async () => {
    // kicktipp answers 200 for spieltagIndex=999 but serves the nearest real matchday (1 in this fixture)
    const c = new KickTippClient(stubSession({ tippuebersicht: fixture('tippuebersicht.html') }), 'https://www.kicktipp.de');
    await expect(c.getLeaderboard({ community: 'x', spieltagIndex: 999 })).rejects.toThrow(/out of range/i);
  });

  it('rejects an unknown community (404)', async () => {
    const http = { async get(url: string) { return { status: 404, finalUrl: url, html: '<html>404</html>' }; }, cookies: () => ({}) };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    await expect(c.getLeaderboard({ community: 'ghost' })).rejects.toThrow(/ghost/);
  });

  it('rejects when kicktipp redirects to the login page', async () => {
    const http = { async get() { return { status: 200, finalUrl: 'https://www.kicktipp.de/info/profil/login', html: '' }; }, cookies: () => ({}) };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    await expect(c.getLeaderboard({ community: 'x' })).rejects.toThrow(/logged in/i);
  });
});
