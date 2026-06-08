import { describe, it, expect } from 'vitest';
import { parseRules } from '../src/scrape/rules.js';
describe('parseRules', () => {
  it('extracts scoring rules from HTML with labeled values', () => {
    // Use non-default values (6/4/1) to prove the parser actually reads from the page,
    // not just fires the ?? fallback defaults (which would be 4/3/2).
    const html = `<table><tr><td>Tipp mit richtigem Ergebnis</td><td>6</td></tr>
                  <tr><td>Tordifferenz</td><td>4</td></tr>
                  <tr><td>Tendenz</td><td>1</td></tr></table>`;
    expect(parseRules(html)).toEqual({ exact: 6, goalDiff: 4, tendency: 1 });
  });
  it('falls back to KickTipp defaults when no rules found', () => {
    expect(parseRules('<html><body>No rules here</body></html>')).toEqual({ exact: 4, goalDiff: 3, tendency: 2 });
  });
});
