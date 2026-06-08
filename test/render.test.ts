import { describe, it, expect } from 'vitest';
import { renderDistribution, renderPredictions, renderMatchday } from '../src/cli/render.js';
import type { MatchdayDistribution, Prediction, BetFormMatch } from '../src/domain/types.js';

describe('renderDistribution', () => {
  it('renders a readable line per match with tendency + top results', () => {
    const dist: MatchdayDistribution = {
      community: 'x',
      spieltagIndex: 1,
      visibility: 'after deadline',
      matches: [
        {
          matchId: 1,
          home: 'A',
          away: 'B',
          byTendency: { home: 4, draw: 0, away: 0 },
          byResult: [{ score: '2:1', pct: 50 }],
          dataAvailable: true,
        },
      ],
    };

    const out = renderDistribution(dist);

    expect(out).toContain('Tippverteilung — x (Spieltag 1) [after deadline]');
    expect(out).toMatch(/A.*B/);
    expect(out).toContain('1/X/2 = 4/0/0');
    expect(out).toMatch(/2:1.*50/);
  });

  it('renders a placeholder for matches without data', () => {
    const dist: MatchdayDistribution = {
      community: 'x',
      spieltagIndex: null,
      visibility: null,
      matches: [
        { matchId: 1, home: 'A', away: 'B', byTendency: null, byResult: [], dataAvailable: false },
      ],
    };

    const out = renderDistribution(dist);

    expect(out).toContain('(Spieltag ?)');
    expect(out).toContain('[n/a]');
    expect(out).toContain('A vs B: (no data yet)');
  });

  it('does not throw when dataAvailable is true but byTendency is null', () => {
    const dist: MatchdayDistribution = {
      community: 'x',
      spieltagIndex: 3,
      visibility: 'open',
      matches: [
        {
          matchId: 1,
          home: 'A',
          away: 'B',
          byTendency: null,
          byResult: [{ score: '1:0', pct: 30 }, { score: '2:1', pct: 20 }],
          dataAvailable: true,
        },
      ],
    };

    const out = renderDistribution(dist);

    expect(out).not.toContain('1/X/2');
    expect(out).toContain('top: 1:0 30%  2:1 20%');
  });

  it('shows at most the top three results', () => {
    const dist: MatchdayDistribution = {
      community: 'x',
      spieltagIndex: 1,
      visibility: 'open',
      matches: [
        {
          matchId: 1,
          home: 'A',
          away: 'B',
          byTendency: { home: 1, draw: 2, away: 3 },
          byResult: [
            { score: '1:0', pct: 40 },
            { score: '2:1', pct: 30 },
            { score: '0:0', pct: 20 },
            { score: '3:0', pct: 10 },
          ],
          dataAvailable: true,
        },
      ],
    };

    const out = renderDistribution(dist);

    expect(out).toContain('1:0 40%');
    expect(out).toContain('0:0 20%');
    expect(out).not.toContain('3:0 10%');
  });
});

describe('renderPredictions', () => {
  const base = {
    probs: { home: 0.5, draw: 0.3, away: 0.2 },
    rationale: 'because',
  };

  it('renders one line per prediction with score and expected points', () => {
    const ps: Prediction[] = [
      { matchId: 1, home: 'A', away: 'B', score: { home: 2, away: 1 }, expectedPoints: 3.4, ...base },
      { matchId: 2, home: 'C', away: 'D', score: { home: 0, away: 0 }, expectedPoints: 1.1, ...base },
    ];

    const out = renderPredictions(ps);

    expect(out.split('\n')).toHaveLength(2);
    expect(out).toContain('A 2:1 B  (EP 3.4)');
    expect(out).toContain('C 0:0 D  (EP 1.1)');
  });

  it('renders an empty string for no predictions', () => {
    expect(renderPredictions([])).toBe('');
  });
});

describe('renderMatchday', () => {
  const base = {
    kickoff: null,
    homeInputName: 'h',
    awayInputName: 'a',
  };

  it('renders odds, current tip, and lock state', () => {
    const ms: BetFormMatch[] = [
      {
        formIndex: 0,
        home: 'A',
        away: 'B',
        odds: { home: 1.5, draw: 3.2, away: 6.0 },
        locked: false,
        currentHome: 2,
        currentAway: 1,
        ...base,
      },
      {
        formIndex: 1,
        home: 'C',
        away: 'D',
        odds: null,
        locked: true,
        currentHome: null,
        currentAway: null,
        ...base,
      },
    ];

    const out = renderMatchday(ms);
    const lines = out.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[0] A vs B  odds 1.5/3.2/6  you: 2:1');
    expect(lines[0]).not.toContain('(locked)');
    expect(lines[1]).toContain('[1] C vs D  odds —  you: -:-');
    expect(lines[1]).toContain('(locked)');
  });

  it('renders an empty string for no matches', () => {
    expect(renderMatchday([])).toBe('');
  });
});
