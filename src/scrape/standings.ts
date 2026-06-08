import * as cheerio from 'cheerio';
import type { Standing } from '../domain/types.js';

export function parseStandings(html: string): Standing[] {
  const $ = cheerio.load(html);
  const out: Standing[] = [];

  $('table tbody tr').each((_, tr) => {
    const row = $(tr);
    const cells = row.find('td');
    if (cells.length < 4) return;

    // Try class-based extraction first (modern KickTipp sporttabelle)
    const mannschaftCell = row.find('td.mannschaft');
    if (mannschaftCell.length) {
      const rankText = cells.eq(0).text().trim();
      const rank = parseInt(rankText, 10);
      // Get team name from mannschaft cell, strip icon spans
      const team = mannschaftCell.find('div').text().trim() || mannschaftCell.text().trim();
      if (!Number.isFinite(rank) || !team) return;

      // Columns: rank(0), mannschaft(1), Sp(2), Pkt(3), Tore(4), Diff(5), g(6), u(7), v(8)
      const parsedPlayed = parseInt(cells.eq(2).text().trim(), 10);
      const played = Number.isFinite(parsedPlayed) ? parsedPlayed : 0;
      const parsedPkt = parseInt(cells.eq(3).text().trim(), 10);
      const pkt = Number.isFinite(parsedPkt) ? parsedPkt : 0;
      const toreText = cells.eq(4).text().trim();
      const tore = toreText.split(':').map((n) => parseInt(n, 10));

      out.push({
        rank,
        team,
        played,
        goalsFor: tore[0] || 0,
        goalsAgainst: tore[1] || 0,
        points: pkt,
      });
      return;
    }

    // Fallback: generic row parsing
    // Expected columns: rank(0), team(1), Sp(2), Pkt(3), Tore(4), Diff(5), g(6), u(7), v(8)
    // We index by known column position to avoid distortion from the goals cell ('92:35' → '9235').
    const c = cells.map((_, td) => $(td).text().trim()).get();
    if (c.length < 4) return;
    const rank = parseInt(c[0], 10);
    const team = c.find((x) => /[A-Za-zÄÖÜäöü]/.test(x) && !/^\d+\.$/.test(x)) || '';
    if (!Number.isFinite(rank) || !team) return;
    // Locate the goals cell (contains ':') and derive column offsets from it.
    const goalsIdx = c.findIndex((x) => /:/.test(x));
    const goals = (goalsIdx >= 0 ? c[goalsIdx] : '0:0').split(':').map((n) => parseInt(n, 10));
    // Sp is at index 2, Pkt is at index 3 (one column before the goals cell when present).
    const played = parseInt(c[2] ?? '', 10);
    // Points (Pkt) is the column immediately before the goals cell; fall back to column 3.
    const pktIdx = goalsIdx > 0 ? goalsIdx - 1 : 3;
    const points = parseInt(c[pktIdx] ?? '', 10);
    out.push({
      rank,
      team,
      played: Number.isFinite(played) ? played : 0,
      goalsFor: goals[0] || 0,
      goalsAgainst: goals[1] || 0,
      points: Number.isFinite(points) ? points : 0,
    });
  });

  return out;
}
