import * as cheerio from 'cheerio';
import type { Fixture } from '../domain/types.js';

export function parseSchedule(html: string): Fixture[] {
  const $ = cheerio.load(html);
  const out: Fixture[] = [];

  // Modern KickTipp tippspielplan: rows have data-url with tippspielId
  $('tr[data-url]').each((_, tr) => {
    const row = $(tr);
    const dataUrl = row.attr('data-url') || '';
    const matchId = Number((dataUrl.match(/tippspielId=([0-9]+)/) || [])[1]) || 0;
    if (!matchId) return;
    if (out.some((f) => f.matchId === matchId)) return;

    const cells = row.find('td');
    if (cells.length < 4) return;

    // Columns: termin(0), tipptermin(1), heim(2), gast(3), ergebnis(4), punkteregel(5)
    const kickoffText = cells.eq(0).text().trim();
    const kickoff = /\d{2}\.\d{2}\.(\d{2}|\d{4})/.test(kickoffText) ? kickoffText : null;
    const home = cells.eq(2).text().trim();
    const away = cells.eq(3).text().trim();

    // Parse result from ergebnis cell (e.g. "2 : 1" or span-encoded)
    const ergebnisCell = cells.eq(4);
    const heimGoalText = ergebnisCell.find('.kicktipp-heim').text().trim();
    const gastGoalText = ergebnisCell.find('.kicktipp-gast').text().trim();
    const homeGoals = heimGoalText && /^\d+$/.test(heimGoalText) ? parseInt(heimGoalText, 10) : null;
    const awayGoals = gastGoalText && /^\d+$/.test(gastGoalText) ? parseInt(gastGoalText, 10) : null;

    out.push({ matchId, home, away, kickoff, homeGoals, awayGoals });
  });

  // Fallback: look for anchor tags with tippspielId in href (older pages)
  if (out.length === 0) {
    $('a[href*="tippspielId="], tr').each((_, el) => {
      const isAnchor = el.tagName === 'a';
      const row = isAnchor ? $(el).closest('tr') : $(el);
      const href = isAnchor
        ? ($(el).attr('href') || '')
        : (row.find('a[href*="tippspielId="]').attr('href') || '');
      const matchId = Number((href.match(/tippspielId=([0-9]+)/) || [])[1]) || 0;
      // Skip rows with no tippspielId (matchId=0 is falsy and the dedup guard would fail)
      if (!matchId) return;
      const c = row.find('td').map((_, td) => $(td).text().trim()).get();
      if (c.length < 3) return;
      const home = c[1] || '';
      const away = c[2] || '';
      const res = (c.find((x) => /^\d+\s*:\s*\d+$/.test(x)) || '').split(':').map((n) => parseInt(n, 10));
      if (!home || !away || out.some((f) => f.matchId === matchId)) return;
      out.push({
        matchId,
        home,
        away,
        kickoff: /\d{2}\.\d{2}\.(\d{2}|\d{4})/.test(c[0]) ? c[0] : null,
        homeGoals: res[0] ?? null,
        awayGoals: res[1] ?? null,
      });
    });
  }

  return out;
}
