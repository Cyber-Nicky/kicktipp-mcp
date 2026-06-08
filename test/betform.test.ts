import { describe, it, expect } from 'vitest';
import { parseBetForm } from '../src/scrape/betform.js';
import { ParseError } from '../src/errors.js';
import { fixture } from './helpers.js';

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

/** Minimal bet-form row. By default unlocked, no pre-filled scores. */
function makeRow(opts: {
  date?: string;
  home: string;
  away: string;
  id?: string;
  name?: string;
  heimVal?: string;
  gastVal?: string;
  locked?: boolean;
  oddsHtml?: string;
}): string {
  const tdClass = opts.locked ? ' class="nichttippbar"' : '';
  const oddsHtml =
    opts.oddsHtml ??
    `<span class="quote-heim"><span class="quote-text">1,50</span></span>` +
      `<span class="quote-remis"><span class="quote-text">4,00</span></span>` +
      `<span class="quote-gast"><span class="quote-text">6,00</span></span>`;
  const dateTd = opts.date ? `<td>${opts.date}</td>` : `<td></td>`;
  return `<tr class="datarow">${dateTd}<td>${opts.home}</td><td>${opts.away}</td>
    <td${tdClass}><input id="${opts.id ?? 'r1_heimTipp'}" name="${opts.name ?? 'spieltippForms[0].heimTipp'}" value="${opts.heimVal ?? ''}">` +
    `<input id="${(opts.id ?? 'r1') + '_gastTipp'}" name="${opts.name?.replace('heimTipp', 'gastTipp') ?? 'spieltippForms[0].gastTipp'}" value="${opts.gastVal ?? ''}"></td>` +
    `<td>${oddsHtml}</td></tr>`;
}

function wrapForm(rows: string, hidden = '<input type="hidden" name="ticket" value="abc">'): string {
  return `<form>${hidden}<table id="tippabgabeSpiele">${rows}</table></form>`;
}

// ---------------------------------------------------------------------------
// Happy-path fixture (single unlocked row, empty scores)
// ---------------------------------------------------------------------------

const SINGLE_ROW_HTML = wrapForm(
  makeRow({ date: '02.10.26 20:30', home: 'Bayern', away: 'Dortmund' }),
);

describe('parseBetForm', () => {
  // ── 1. Happy path ──────────────────────────────────────────────────────────
  it('extracts hidden fields, matches, input names, odds, and kickoff', () => {
    const f = parseBetForm(SINGLE_ROW_HTML);

    expect(f.fields.ticket).toBe('abc');
    expect(f.matches).toHaveLength(1);

    expect(f.matches[0]).toMatchObject({
      home: 'Bayern',
      away: 'Dortmund',
      kickoff: '02.10.26 20:30',
      homeInputName: 'spieltippForms[0].heimTipp',
      awayInputName: 'spieltippForms[0].gastTipp',
      locked: false,
    });
    expect(f.matches[0].odds).toEqual({ home: 1.5, draw: 4.0, away: 6.0 });
  });

  // ── 2. formIndex is derived from input id/name ─────────────────────────────
  it('sets formIndex from the numeric part of the input id/name', () => {
    const f = parseBetForm(SINGLE_ROW_HTML);
    // id="r1_heimTipp" → first digit match → 1
    expect(f.matches[0].formIndex).toBe(1);
  });

  // ── 3. Locked row ─────────────────────────────────────────────────────────
  it('sets locked:true when the row contains td.nichttippbar', () => {
    const html = wrapForm(
      makeRow({ date: '02.10.26 20:30', home: 'Bayern', away: 'Dortmund', locked: true }),
    );
    const f = parseBetForm(html);
    expect(f.matches).toHaveLength(1);
    expect(f.matches[0].locked).toBe(true);
  });

  // ── 4. Pre-filled scores ───────────────────────────────────────────────────
  it('parses currentHome and currentAway when input values are numeric', () => {
    const html = wrapForm(
      makeRow({
        date: '02.10.26 20:30',
        home: 'Bayern',
        away: 'Dortmund',
        heimVal: '2',
        gastVal: '1',
      }),
    );
    const f = parseBetForm(html);
    expect(f.matches[0].currentHome).toBe(2);
    expect(f.matches[0].currentAway).toBe(1);
  });

  // ── 5. Empty score inputs → null ──────────────────────────────────────────
  it('returns null for currentHome/currentAway when inputs are empty', () => {
    const f = parseBetForm(SINGLE_ROW_HTML);
    expect(f.matches[0].currentHome).toBeNull();
    expect(f.matches[0].currentAway).toBeNull();
  });

  // ── 6. ParseError when #tippabgabeSpiele is absent ────────────────────────
  it('throws ParseError when #tippabgabeSpiele table is missing', () => {
    const html = '<html><body><p>no table here</p></body></html>';
    expect(() => parseBetForm(html)).toThrow(ParseError);
  });

  // ── 7. Multi-row: kickoff carry-forward ───────────────────────────────────
  it('carries the last seen kickoff forward to rows that have no date cell', () => {
    const row1 = makeRow({
      date: '05.11.26 18:30',
      home: 'Leverkusen',
      away: 'Leipzig',
      id: 'r1_heimTipp',
      name: 'spieltippForms[0].heimTipp',
    });
    // Second row deliberately has no date (empty td).
    const row2 = makeRow({
      home: 'Frankfurt',
      away: 'Bremen',
      id: 'r2_heimTipp',
      name: 'spieltippForms[1].heimTipp',
    });

    const html = wrapForm(row1 + row2);
    const f = parseBetForm(html);

    expect(f.matches).toHaveLength(2);
    // First row has the date
    expect(f.matches[0].kickoff).toBe('05.11.26 18:30');
    // Second row has no date cell, but should inherit the previous kickoff
    expect(f.matches[1].kickoff).toBe('05.11.26 18:30');
  });

  // ── 8. 4-digit year handling ──────────────────────────────────────────────
  it('accepts a 4-digit year in the kickoff date string', () => {
    const html = wrapForm(
      makeRow({ date: '02.10.2026 20:30', home: 'Bayern', away: 'Dortmund' }),
    );
    const f = parseBetForm(html);
    expect(f.matches[0].kickoff).toBe('02.10.2026 20:30');
  });

  // ── 9. Real-data: the live WM bet form (sanitized member round) ─────────────
  it('parses the real KickTipp bet form markup (sanitized live fixture)', () => {
    const f = parseBetForm(fixture('betform-member.html'));
    expect(f.matches.length).toBeGreaterThanOrEqual(3);
    const m = f.matches[0];
    expect(m.homeInputName).toMatch(/^spieltippForms\[\d+\]\.heimTipp$/);
    expect(m.awayInputName).toMatch(/^spieltippForms\[\d+\]\.gastTipp$/);
    expect(m.formIndex).toBeGreaterThan(0);
    expect(m.home.length).toBeGreaterThan(0);
    expect(m.away.length).toBeGreaterThan(0);
    expect(m.odds).not.toBeNull(); // this round publishes odds
    expect(f.fields['spieltagIndex']).toBeDefined(); // hidden field replayed on POST
  });
});
