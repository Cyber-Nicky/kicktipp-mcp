import * as cheerio from 'cheerio';
import { parseOdds } from './odds.js';
import type { BetFormMatch } from '../domain/types.js';
import { ParseError } from '../errors.js';

export function parseBetForm(html: string): { fields: Record<string, string>; matches: BetFormMatch[] } {
  const $ = cheerio.load(html);

  // Collect all hidden form fields (CSRF tokens, etc.) to replay on POST.
  const fields: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    if (name) fields[name] = $(el).attr('value') || '';
  });

  const table = $('#tippabgabeSpiele');
  if (!table.length) throw new ParseError('bet table not found', '#tippabgabeSpiele');

  const matches: BetFormMatch[] = [];
  let lastKickoff: string | null = null;

  table.find('tr').each((_, tr) => {
    const row = $(tr);

    // Identify score-input cells — only process rows that have both inputs.
    const heim = row.find('input[name*="heimTipp"], input[id$="_heimTipp"]').first();
    const gast = row.find('input[name*="gastTipp"], input[id$="_gastTipp"]').first();
    if (!heim.length || !gast.length) return;

    const cells = row.find('td');

    // Carry kickoff forward: if this row has a date/time cell, update lastKickoff.
    // Accept both 2-digit years (02.10.26) and 4-digit years (02.10.2026).
    const time = cells.eq(0).text().trim();
    if (/\d{2}\.\d{2}\.\d{2,4}/.test(time)) lastKickoff = time;

    const home = cells.eq(1).text().trim();
    const away = cells.eq(2).text().trim();
    const oddsCell = cells.last().html() || '';

    // Extract the local form index from the input id or name.
    // e.g. id="r1_heimTipp" → 1 ; name="spieltippForms[0].heimTipp" → 0
    // NOTE: this is NOT the KickTipp tippspielId — see BetFormMatch.formIndex JSDoc.
    const idStr = heim.attr('id') || heim.attr('name') || '';
    const idMatch = idStr.match(/(\d+)/);
    const formIndex = idMatch ? Number(idMatch[1]) : matches.length;

    // Pre-filled scores (empty string → null, numeric string → number).
    const heimVal = heim.attr('value');
    const gastVal = gast.attr('value');

    matches.push({
      formIndex,
      home,
      away,
      kickoff: lastKickoff,
      homeInputName: heim.attr('name') || '',
      awayInputName: gast.attr('name') || '',
      odds: parseOdds(oddsCell),
      locked: row.find('td.nichttippbar').length > 0,
      currentHome: heimVal !== '' && heimVal != null ? Number(heimVal) : null,
      currentAway: gastVal !== '' && gastVal != null ? Number(gastVal) : null,
    });
  });

  return { fields, matches };
}
