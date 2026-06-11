import * as cheerio from 'cheerio';
import { ParseError } from '../errors.js';
import type { LeaderboardEntry } from '../domain/types.js';

export interface LeaderboardPage {
  /** Matchday shown by the page (from match-detail data-urls); null on the overall view. */
  spieltagIndex: number | null;
  entries: LeaderboardEntry[];
  /** Highest seite= referenced by the pager; 1 when the pool fits on one page. */
  pageCount: number;
}

const num = (s: string): number => {
  const m = s.trim().replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};

/**
 * Parses one page of the tipper leaderboard (table#ranking) from either the
 * gesamtuebersicht (overall) or tippuebersicht (per-matchday) view.
 */
export function parseLeaderboardPage(html: string): LeaderboardPage {
  const $ = cheerio.load(html);
  if (!$('table#ranking').length)
    throw new ParseError('no ranking table on page — unknown community, not a member, or login required');

  const entries: LeaderboardEntry[] = [];
  let lastRank = 0;
  $('table#ranking tbody tr.teilnehmer').each((_, tr) => {
    const row = $(tr);
    const posText = row.find('td.position').first().text().trim();
    const rank = posText ? Math.trunc(num(posText)) : lastRank; // tied rows may leave the cell empty
    lastRank = rank;
    const nameEl = row.find('div.mg_name').first();
    const name = (nameEl.length ? nameEl.text() : row.find('td.mg_class').first().text()).trim();
    // Matchday view carries that round's points in td.spieltagspunkte; the overall
    // view only has the season total (td.punkte / td.gesamtpunkte).
    const roundPoints = row.find('td.spieltagspunkte').first();
    const cell = roundPoints.length ? roundPoints : row.find('td.punkte, td.gesamtpunkte').first();
    entries.push({ rank, name, points: num(cell.text()), bonusPoints: num(row.find('td.bonus').first().text()) });
  });

  let pageCount = 1;
  $('a[href*="seite="]').each((_, a) => {
    const m = ($(a).attr('href') || '').match(/[?&]seite=(\d+)/);
    if (m) pageCount = Math.max(pageCount, Number(m[1]));
  });

  const dataUrl = $('tr.clickable[data-url*="spieltagIndex="]').first().attr('data-url') || '';
  const sp = dataUrl.match(/spieltagIndex=(\d+)/);
  return { spieltagIndex: sp ? Number(sp[1]) : null, entries, pageCount };
}
