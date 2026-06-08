import { describe, it, expect } from 'vitest';
import { parseStandings } from '../src/scrape/standings.js';
import { fixture } from './helpers.js';
describe('parseStandings', () => {
  it('parses the football table from a real page', () => {
    const rows = parseStandings(fixture('tabellen.html'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('team');
    expect(rows[0]).toHaveProperty('points');
    // Specific values from the real fixture (Bundesliga 2026/27, season not started)
    expect(rows[0].team).toBe('1. FC Köln');
    expect(typeof rows[0].rank).toBe('number');
    expect(rows[0].rank).toBeGreaterThan(0);
  });
});
