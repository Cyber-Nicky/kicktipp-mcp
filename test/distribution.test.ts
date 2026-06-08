import { describe, it, expect } from 'vitest';
import { parseDistribution } from '../src/scrape/distribution.js';
import { fixture } from './helpers.js';

describe('parseDistribution', () => {
  it('parses a populated match', () => {
    const d = parseDistribution(fixture('distribution-populated.html'));
    expect(d.dataAvailable).toBe(true);
    expect(d.byTendency).toEqual({ home: 4, draw: 0, away: 0 });
    expect(d.byResult).toContainEqual({ score: '2:1', pct: 50 });
    expect(d.byResult).toContainEqual({ score: '3:2', pct: 25 });
    expect(d.visibility).toMatch(/sichtbar/i);
  });
  it('reports no data for an empty/future match', () => {
    const d = parseDistribution(fixture('distribution-empty.html'));
    expect(d.dataAvailable).toBe(false);
    expect(d.byResult).toEqual([]);
  });
});
