import { describe, it, expect } from 'vitest';
import { KickTippClient } from '../src/core.js';
import { fixture } from './helpers.js';
function stubSession(pages: Record<string, string>) {
  const http = { async get(url: string) { const key = Object.keys(pages).find((k) => url.includes(k)) || ''; return { status: 200, finalUrl: url, html: pages[key] || '' }; }, cookies: () => ({}) };
  return { http: async () => http } as any;
}
describe('KickTippClient', () => {
  it('getTipDistribution composes overview + match detail', async () => {
    const session = stubSession({ 'tippuebersicht?': fixture('tippuebersicht.html'), 'spiel?tippspielId=': fixture('distribution-populated.html') });
    const c = new KickTippClient(session, 'https://www.kicktipp.de');
    const d = await c.getTipDistribution({ community: 'x', spieltagIndex: 1 });
    expect(d.matches.length).toBeGreaterThan(0);
    expect(d.matches[0]).toHaveProperty('byTendency');
  });
  it('predictMatchday returns a prediction per match with odds', async () => {
    const html = `<form><table id="tippabgabeSpiele"><tr class="datarow"><td>02.10.26 20:30</td><td>A</td><td>B</td><td><input name="spieltippForms[0].heimTipp"><input name="spieltippForms[0].gastTipp"></td><td><span class="quote-heim"><span class="quote-text">1,50</span></span><span class="quote-remis"><span class="quote-text">4,0</span></span><span class="quote-gast"><span class="quote-text">6,0</span></span></td></tr></table></form>`;
    const c = new KickTippClient(stubSession({ 'tippabgabe': html, 'tabellen': '' }), 'https://www.kicktipp.de');
    const preds = await c.predictMatchday({ community: 'x' });
    expect(preds[0].score.home).toBeGreaterThanOrEqual(preds[0].score.away);
  });
  it('placeBets submits the full form and preserves untouched matches', async () => {
    const html = `<form>
      <input type="hidden" name="spieltagIndex" value="1">
      <table id="tippabgabeSpiele">
        <tr class="datarow"><td>11.06.26 21:00</td><td>A</td><td>B</td><td><input name="spieltippForms[100].heimTipp" value="2"><input name="spieltippForms[100].gastTipp" value="1"></td><td></td></tr>
        <tr class="datarow"><td>12.06.26 21:00</td><td>C</td><td>D</td><td><input name="spieltippForms[200].heimTipp" value=""><input name="spieltippForms[200].gastTipp" value=""></td><td></td></tr>
      </table></form>`;
    let captured: Record<string, string> | null = null;
    const http = {
      async get() { return { status: 200, finalUrl: '', html }; },
      async postForm(_url: string, params: Record<string, string>) { captured = params; return { status: 200, finalUrl: '', html }; },
      cookies: () => ({}),
    };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    const r = await c.placeBets({ community: 'x', bets: [{ matchId: 200, home: 3, away: 0 }], dryRun: false });
    expect(r.submitted).toBe(true);
    expect(captured!['spieltagIndex']).toBe('1');         // hidden field replayed
    expect(captured!['submitbutton']).toBeDefined();
    expect(captured!['spieltippForms[100].heimTipp']).toBe('2'); // untouched match preserved
    expect(captured!['spieltippForms[100].gastTipp']).toBe('1');
    expect(captured!['spieltippForms[200].heimTipp']).toBe('3'); // bet applied
    expect(captured!['spieltippForms[200].gastTipp']).toBe('0');
  });
});
