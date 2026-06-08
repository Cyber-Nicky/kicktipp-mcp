import { describe, it, expect } from 'vitest';
import { parseOdds } from '../src/scrape/odds.js';

describe('parseOdds', () => {
  it('parses slash-separated text (legacy)', () => {
    expect(parseOdds('<td class="kicktipp-wettquote">1,50 / 3,40 / 5,00</td>')).toEqual({ home: 1.5, draw: 3.4, away: 5.0 });
  });
  it('parses per-outcome spans', () => {
    const html = `<span class="quote-heim"><span class="quote-text">1,50</span></span>
                  <span class="quote-remis"><span class="quote-text">3,40</span></span>
                  <span class="quote-gast"><span class="quote-text">5,00</span></span>`;
    expect(parseOdds(html)).toEqual({ home: 1.5, draw: 3.4, away: 5.0 });
  });
  it('parses label/text pairs mapped by 1/X/2', () => {
    const html = `<a class="quote"><span class="quote-label">2</span><span class="quote-text">5,00</span></a>
                  <a class="quote"><span class="quote-label">1</span><span class="quote-text">1,50</span></a>
                  <a class="quote"><span class="quote-label">X</span><span class="quote-text">3,40</span></a>`;
    expect(parseOdds(html)).toEqual({ home: 1.5, draw: 3.4, away: 5.0 });
  });
  it('returns null when no odds present', () => {
    expect(parseOdds('<td></td>')).toBeNull();
  });
  it('rejects implausible sub-1.0 slash numbers (odds are always >= 1.0)', () => {
    expect(parseOdds('<td>0,5 / 0,8 / 0,9</td>')).toBeNull();
  });
  it('rejects a 2-number score-like fragment', () => {
    expect(parseOdds('<td>2 / 1</td>')).toBeNull();
  });
});
