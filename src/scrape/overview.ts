import * as cheerio from 'cheerio';
import type { MatchOverview } from '../domain/types.js';

export function parseMatchdayOverview(html: string): { spieltagIndex: number | null; matches: MatchOverview[] } {
  const $ = cheerio.load(html);
  const matches: MatchOverview[] = [];

  // Real markup uses tr.clickable with data-url containing tippspielId and spieltagIndex
  // e.g. data-url="/bundesliga-tippspiel/tippuebersicht/spiel?tippsaisonId=...&spieltagIndex=1&tippspielId=1503034391"
  // Derive spieltagIndex from the first matched row's data-url to avoid
  // accidentally picking up the 'next-page' navigation link which appears first in the HTML.
  $('tr[data-url*="tippspielId="]').each((_, el) => {
    const dataUrl = $(el).attr('data-url') || '';
    const matchId = Number((dataUrl.match(/tippspielId=([0-9]+)/) || [])[1]);
    if (!matchId || matches.some((m) => m.matchId === matchId)) return;
    const cells = $(el).find('td');
    const timeText = cells.eq(0).text().trim();
    const home = cells.eq(1).text().trim();
    const away = cells.eq(2).text().trim();
    // Accept both 2-digit (dd.mm.yy) and 4-digit (dd.mm.yyyy) year formats
    const kickoff = /\d{2}\.\d{2}\.\d{2,4}/.test(timeText) ? timeText : null;
    matches.push({ matchId, home, away, kickoff });
  });

  // Derive spieltagIndex from the first match row's data-url (reliable: all rows share the same spieltagIndex)
  let spieltagIndex: number | null = null;
  if (matches.length > 0) {
    const firstRow = $('tr[data-url*="tippspielId="]').first();
    const firstDataUrl = firstRow.attr('data-url') || '';
    spieltagIndex = Number((firstDataUrl.match(/spieltagIndex=([0-9]+)/) || [])[1]) || null;
  }

  return { spieltagIndex, matches };
}
