import * as cheerio from 'cheerio';
import type { ScoringRules } from '../domain/types.js';

export function parseRules(html: string): ScoringRules {
  const text = cheerio.load(html).root().text().replace(/\s+/g, ' ');
  const near = (label: RegExp): number | null => {
    const m = text.match(new RegExp('(?:' + label.source + ')[^0-9]{0,40}?(\\d+)', 'i'));
    return m ? parseInt(m[1], 10) : null;
  };
  return {
    exact: near(/richtige?[ms]? Ergebnis|exakte/) ?? 4,
    goalDiff: near(/Tordifferenz|Differenz/) ?? 3,
    tendency: near(/Tendenz|Sieger|richtige Tendenz/) ?? 2,
  };
}
