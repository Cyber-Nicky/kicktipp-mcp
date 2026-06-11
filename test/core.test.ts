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
  it('placeBets dry-run flags unknown and locked matches in the diff', async () => {
    const html = `<form>
      <input type="hidden" name="spieltagIndex" value="1">
      <table id="tippabgabeSpiele">
        <tr class="datarow"><td>11.06.26 21:00</td><td>A</td><td>B</td><td><input name="spieltippForms[100].heimTipp" value=""><input name="spieltippForms[100].gastTipp" value=""></td><td></td></tr>
        <tr class="datarow"><td>12.06.26 21:00</td><td>C</td><td>D</td><td class="nichttippbar"><input name="spieltippForms[200].heimTipp" value="1"><input name="spieltippForms[200].gastTipp" value="1"></td><td></td></tr>
      </table></form>`;
    const c = new KickTippClient(stubSession({ tippabgabe: html }), 'https://www.kicktipp.de');
    const r = await c.placeBets({
      community: 'x',
      bets: [
        { matchId: 100, home: 2, away: 1 },
        { matchId: 200, home: 0, away: 0 },
        { matchId: 999999, home: 3, away: 3 },
      ],
      dryRun: true,
    });
    expect(r.submitted).toBe(false);
    const byId = Object.fromEntries(r.diff.map((d) => [d.matchId, d]));
    expect(byId[100].status).toBe('ok');
    expect(byId[200].status).toBe('locked');
    expect(byId[999999].status).toBe('unknown');
    expect(byId[999999].from).toBeNull();
  });
  it('placeBets with only unknown/locked bets performs no POST and reports submitted:false', async () => {
    const html = `<form><table id="tippabgabeSpiele">
      <tr class="datarow"><td>12.06.26 21:00</td><td>C</td><td>D</td><td class="nichttippbar"><input name="spieltippForms[200].heimTipp" value="1"><input name="spieltippForms[200].gastTipp" value="1"></td><td></td></tr>
    </table></form>`;
    let posted = false;
    const http = {
      async get() { return { status: 200, finalUrl: '', html }; },
      async postForm() { posted = true; return { status: 200, finalUrl: '', html }; },
      cookies: () => ({}),
    };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    const r = await c.placeBets({
      community: 'x',
      bets: [{ matchId: 200, home: 0, away: 0 }, { matchId: 999999, home: 3, away: 3 }],
      dryRun: false,
    });
    expect(posted).toBe(false);
    expect(r.submitted).toBe(false);
  });
  it('placeBets rejects duplicate matchIds before any submission', async () => {
    let fetched = false;
    const http = {
      async get() { fetched = true; return { status: 200, finalUrl: '', html: '' }; },
      async postForm() { return { status: 200, finalUrl: '', html: '' }; },
      cookies: () => ({}),
    };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    await expect(
      c.placeBets({
        community: 'x',
        bets: [{ matchId: 100, home: 2, away: 1 }, { matchId: 100, home: 3, away: 0 }],
        dryRun: true,
      }),
    ).rejects.toThrow(/duplicate matchId/i);
    expect(fetched).toBe(false);
  });
  it('placeBets re-reads the form after submit and reports per-bet verification', async () => {
    const mkHtml = (h: string, g: string) => `<form><table id="tippabgabeSpiele">
      <tr class="datarow"><td>11.06.26 21:00</td><td>A</td><td>B</td><td><input name="spieltippForms[100].heimTipp" value="${h}"><input name="spieltippForms[100].gastTipp" value="${g}"></td><td></td></tr>
    </table></form>`;
    let posted = false;
    const http = {
      async get() { return { status: 200, finalUrl: '', html: posted ? mkHtml('3', '0') : mkHtml('', '') }; },
      async postForm() { posted = true; return { status: 200, finalUrl: '', html: '' }; },
      cookies: () => ({}),
    };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    const r = await c.placeBets({ community: 'x', bets: [{ matchId: 100, home: 3, away: 0 }], dryRun: false });
    expect(r.submitted).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.diff[0].verified).toBe(true);
  });
  it('placeBets reports verification failure when the saved form does not show the new tip', async () => {
    const html = `<form><table id="tippabgabeSpiele">
      <tr class="datarow"><td>11.06.26 21:00</td><td>A</td><td>B</td><td><input name="spieltippForms[100].heimTipp" value=""><input name="spieltippForms[100].gastTipp" value=""></td><td></td></tr>
    </table></form>`;
    const http = {
      async get() { return { status: 200, finalUrl: '', html }; }, // unchanged after POST
      async postForm() { return { status: 200, finalUrl: '', html: '' }; },
      cookies: () => ({}),
    };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    const r = await c.placeBets({ community: 'x', bets: [{ matchId: 100, home: 3, away: 0 }], dryRun: false });
    expect(r.submitted).toBe(true);
    expect(r.verified).toBe(false);
    expect(r.diff[0].verified).toBe(false);
  });
  it('getBonusQuestions fetches and parses the bonus form', async () => {
    const c = new KickTippClient(stubSession({ 'tippabgabe?bonus=true': fixture('bonusform-open.html') }), 'https://www.kicktipp.de');
    const qs = await c.getBonusQuestions({ community: 'x' });
    expect(qs).toHaveLength(15);
    expect(qs.some((q) => q.text === 'Wer wird Weltmeister?')).toBe(true);
  });
  it('placeBonusBets dry-run resolves names case-insensitively and diffs without posting', async () => {
    const c = new KickTippClient(stubSession({ 'tippabgabe?bonus=true': fixture('bonusform-open.html') }), 'https://www.kicktipp.de');
    const r = await c.placeBonusBets({
      community: 'x',
      bets: [
        { question: 'wer wird weltmeister?', answers: ['frankreich'] },
        { question: 'Wer erreicht das Halbfinale?', answers: ['Frankreich', 'Spanien', 'England', 'Argentinien'] },
        { question: 'Nicht existent?', answers: ['X'] },
      ],
      dryRun: true,
    });
    expect(r.submitted).toBe(false);
    expect(r.verified).toBeNull();
    expect(r.diff[0]).toMatchObject({ question: 'Wer wird Weltmeister?', from: null, to: ['Frankreich'], status: 'ok' });
    expect(r.diff[1].to).toEqual(['Frankreich', 'Spanien', 'England', 'Argentinien']);
    expect(r.diff[1].status).toBe('ok');
    expect(r.diff[2].status).toBe('unknown');
  });
  it('placeBonusBets rejects unknown answers listing the valid options', async () => {
    const c = new KickTippClient(stubSession({ 'tippabgabe?bonus=true': fixture('bonusform-open.html') }), 'https://www.kicktipp.de');
    await expect(
      c.placeBonusBets({ community: 'x', bets: [{ question: 'Wer wird Weltmeister?', answers: ['Atlantis'] }], dryRun: true }),
    ).rejects.toThrow(/Atlantis.*Argentinien/s);
  });
  it('placeBonusBets rejects duplicate questions, duplicate answers, empty answers, and slot overflow', async () => {
    const c = new KickTippClient(stubSession({ 'tippabgabe?bonus=true': fixture('bonusform-open.html') }), 'https://www.kicktipp.de');
    const call = (bets: any) => c.placeBonusBets({ community: 'x', bets, dryRun: true });
    await expect(call([
      { question: 'Wer wird Weltmeister?', answers: ['Frankreich'] },
      { question: 'wer wird WELTMEISTER?', answers: ['Spanien'] },
    ])).rejects.toThrow(/duplicate question/i);
    await expect(call([{ question: 'Wer erreicht das Halbfinale?', answers: ['Frankreich', 'frankreich'] }])).rejects.toThrow(/duplicate answer/i);
    await expect(call([{ question: 'Wer wird Weltmeister?', answers: [] }])).rejects.toThrow(/no answers/i);
    await expect(call([{ question: 'Wer wird Weltmeister?', answers: ['Frankreich', 'Spanien'] }])).rejects.toThrow(/1 slot/);
  });
  it('placeBonusBets submits the full form, preserves untouched answers, and verifies by read-back', async () => {
    // Two questions: q10 already answered (must be echoed), q20 empty (we answer it).
    const makeHtml = (q20Selected: '-1' | '333') => `<form action="/x/tippabgabe">
      <input type="hidden" name="spieltagIndex" value="1">
      <input type="hidden" name="bonus" value="true">
      <input type="hidden" name="tippsaisonId" value="99">
      <table id="tippabgabeFragen">
      <tr><th>T</th><th>F</th><th>Tipp</th></tr>
      <tr><td class="kicktipp-time">11.06.26 21:00</td><td class="nw">Frage A?</td><td>
        <input type="hidden" value="true" name="fragetippForms[10].tippAbgegeben" />
        <select name="fragetippForms[10].antwortIds[71]"><option value="-1">--</option><option value="111" selected="selected">Alpha</option></select></td></tr>
      <tr><td class="kicktipp-time">11.06.26 21:00</td><td class="nw">Frage B?</td><td>
        <input type="hidden" value="true" name="fragetippForms[20].tippAbgegeben" />
        <select name="fragetippForms[20].antwortIds[72]"><option value="-1"${q20Selected === '-1' ? ' selected="selected"' : ''}>--</option><option value="333"${q20Selected === '333' ? ' selected="selected"' : ''}>Gamma</option></select></td></tr>
      </table></form>`;
    let posted: Record<string, string> | null = null;
    let postUrl = '';
    let gets = 0;
    const http = {
      async get(url: string) { gets++; return { status: 200, finalUrl: url, html: makeHtml(posted ? '333' : '-1') }; },
      async postForm(url: string, params: Record<string, string>) { postUrl = url; posted = params; return { status: 200, finalUrl: url, html: '' }; },
      cookies: () => ({}),
    };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    const r = await c.placeBonusBets({ community: 'x', bets: [{ question: 'Frage B?', answers: ['Gamma'] }], dryRun: false });
    expect(postUrl).toBe('https://www.kicktipp.de/x/tippabgabe');           // form action, no query
    expect(posted!['spieltagIndex']).toBe('1');                              // hidden fields replayed
    expect(posted!['bonus']).toBe('true');
    expect(posted!['tippsaisonId']).toBe('99');
    expect(posted!['fragetippForms[10].tippAbgegeben']).toBe('true');
    expect(posted!['submitbutton']).toBeDefined();
    expect(posted!['fragetippForms[10].antwortIds[71]']).toBe('111');        // untouched answer preserved
    expect(posted!['fragetippForms[20].antwortIds[72]']).toBe('333');        // new answer applied
    expect(r.submitted).toBe(true);
    expect(r.verified).toBe(true);                                           // read-back confirmed
    expect(r.diff[0]).toMatchObject({ question: 'Frage B?', from: null, to: ['Gamma'], status: 'ok', verified: true });
    expect(gets).toBe(2);                                                    // form fetch + read-back
  });
  it('placeBonusBets never posts when nothing is applicable', async () => {
    const html = `<form><table id="tippabgabeFragen">
      <tr><th>T</th><th>F</th><th>Tipp</th></tr>
      <tr><td class="kicktipp-time">10.06.26 21:00</td><td class="nw">Frage A?</td><td>Alpha</td></tr>
      </table></form>`;
    let postCalled = false;
    const http = {
      async get(url: string) { return { status: 200, finalUrl: url, html }; },
      async postForm() { postCalled = true; return { status: 200, finalUrl: '', html: '' }; },
      cookies: () => ({}),
    };
    const c = new KickTippClient({ http: async () => http } as any, 'https://www.kicktipp.de');
    const r = await c.placeBonusBets({ community: 'x', bets: [{ question: 'Frage A?', answers: ['Beta'] }], dryRun: false });
    expect(postCalled).toBe(false);
    expect(r.submitted).toBe(false);
    expect(r.diff[0].status).toBe('locked');
  });
});
