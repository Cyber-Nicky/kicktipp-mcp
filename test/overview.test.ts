import { describe, it, expect } from 'vitest';
import { parseMatchdayOverview } from '../src/scrape/overview.js';
import { fixture } from './helpers.js';

describe('parseMatchdayOverview', () => {
  it('extracts matches with ids and team names from a real overview', () => {
    const o = parseMatchdayOverview(fixture('tippuebersicht.html'));
    // Correct spieltagIndex derived from match row data-url, not the nav link (which says 2)
    expect(o.spieltagIndex).toBe(1);
    // The bundesliga fixture has exactly 9 matches on spieltag 1
    expect(o.matches).toHaveLength(9);
    expect(o.matches[0]).toHaveProperty('matchId');
    expect(typeof o.matches[0].matchId).toBe('number');
    // Home team is populated
    expect(o.matches[0].home.length).toBeGreaterThan(0);
    // Away team is populated (non-empty)
    expect(o.matches[0].away.length).toBeGreaterThan(0);
    // At least one match has a kickoff date/time string
    const withKickoff = o.matches.filter((m) => m.kickoff !== null);
    expect(withKickoff.length).toBeGreaterThan(0);
    expect(withKickoff[0].kickoff).toMatch(/\d{2}\.\d{2}\.\d{2,4}/);
  });

  it('returns empty matches array and null spieltagIndex for empty HTML', () => {
    const o = parseMatchdayOverview('<html><body></body></html>');
    expect(o.matches).toHaveLength(0);
    expect(o.spieltagIndex).toBeNull();
  });

  it('returns empty matches array and null spieltagIndex for HTML with no match rows', () => {
    const o = parseMatchdayOverview('<html><body><table><tr><td>no matches</td></tr></table></body></html>');
    expect(o.matches).toHaveLength(0);
    expect(o.spieltagIndex).toBeNull();
  });
});
