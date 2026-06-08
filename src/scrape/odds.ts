import * as cheerio from 'cheerio';
import type { Odds } from '../domain/types.js';

const num = (s: string): number | null => {
  const v = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

export function parseOdds(html: string): Odds | null {
  const $ = cheerio.load(html);

  // Strategy A: per-outcome spans (modern .com / ad-free)
  const heim = num($('.quote-heim .quote-text').first().text() || '');
  const remis = num($('.quote-remis .quote-text').first().text() || '');
  const gast = num($('.quote-gast .quote-text').first().text() || '');
  if (heim != null && remis != null && gast != null) return { home: heim, draw: remis, away: gast };

  // Strategy B: label/text pairs mapped by 1/X/2
  const byLabel: Record<string, number> = {};
  $('.quote').each((_, el) => {
    const label = $(el).find('.quote-label').text().trim();
    const val = num($(el).find('.quote-text').text());
    if (label && val != null) byLabel[label] = val;
  });
  if (byLabel['1'] != null && byLabel['X'] != null && byLabel['2'] != null) {
    return { home: byLabel['1'], draw: byLabel['X'], away: byLabel['2'] };
  }

  // Strategy C: slash-separated "a / b / c" in a known odds container, else this cell's own text.
  // NOTE: parseOdds expects an odds *cell* fragment, not a whole page. Decimal (1X2) odds are
  // always >= 1.0, so guard against score/pagination numbers producing a false triple.
  const text = ($('.kicktipp-wettquote').text() || $('.wettquote-link').text() || $.root().text()).replace(/Quote:/i, '');
  const parts = text.split('/').map((s) => num(s)).filter((v): v is number => v != null);
  if (parts.length >= 3 && parts.slice(0, 3).every((v) => v >= 1 && v <= 1000)) {
    return { home: parts[0], draw: parts[1], away: parts[2] };
  }

  return null;
}
