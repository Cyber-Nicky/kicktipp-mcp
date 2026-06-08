import { describe, it, expect } from 'vitest';
import { parseSchedule } from '../src/scrape/schedule.js';
import { fixture } from './helpers.js';
describe('parseSchedule', () => {
  it('parses matches from a real tippspielplan page', () => {
    const fixtures = parseSchedule(fixture('tippspielplan.html'));
    expect(fixtures.length).toBeGreaterThan(0);
    expect(fixtures[0]).toHaveProperty('matchId');
    expect(fixtures[0]).toHaveProperty('home');
    expect(fixtures[0]).toHaveProperty('away');
    expect(typeof fixtures[0].matchId).toBe('number');
    expect(fixtures[0].matchId).toBeGreaterThan(0);
    // Specific values from the real fixture to catch extraction regressions
    expect(fixtures[0].matchId).toBe(1503034391);
    expect(fixtures[0].kickoff).toBe('29.08.26 15:30');
  });
});
