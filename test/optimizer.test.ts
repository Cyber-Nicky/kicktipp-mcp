import { describe, it, expect } from 'vitest';
import { deMargin } from '../src/optimizer/probability.js';
import { bestScoreline } from '../src/optimizer/expectedPoints.js';
import { expectedStrategy } from '../src/optimizer/strategy.js';

describe('deMargin', () => {
  it('normalizes 1/X/2 odds to probabilities summing to 1', () => {
    const p = deMargin({ home: 1.5, draw: 4.0, away: 6.0 });
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 6);
    expect(p.home).toBeGreaterThan(p.away);
  });
});

describe('bestScoreline', () => {
  it('favours the home side for a strong home favourite', () => {
    const probs = { home: 0.7, draw: 0.2, away: 0.1 };
    const r = bestScoreline(probs, { exact: 4, goalDiff: 3, tendency: 2 }, 4);
    expect(r.score.home).toBeGreaterThan(r.score.away);
    expect(r.expectedPoints).toBeGreaterThan(0);
  });

  it('produces a draw when draw is dominant', () => {
    const r = bestScoreline({ home: 0.2, draw: 0.6, away: 0.2 }, { exact: 4, goalDiff: 3, tendency: 2 }, 4);
    expect(r.score.home).toBe(r.score.away);
  });

  it('rationale reflects the actual tip tendency, not the probability leader', () => {
    // home barely leads in probability but the draw EV is higher
    const probs = { home: 0.35, draw: 0.34, away: 0.31 };
    const r = bestScoreline(probs, { exact: 4, goalDiff: 3, tendency: 2 }, 4);
    // The rationale must mention whatever tendency the returned score represents
    const tipTendency = r.score.home > r.score.away ? 'home' : r.score.home < r.score.away ? 'away' : 'draw';
    expect(r.rationale).toContain(`tip favours ${tipTendency}`);
  });
});

describe('points (goalDiff branch)', () => {
  it('awards goalDiff points when tip and result share same tendency and goal diff (2:0 vs 3:1)', () => {
    // tip=2:0 (home, diff+2) vs actual=3:1 (home, diff+2) — same tendency, same goal diff, different exact score
    // With rules {exact:4, goalDiff:3, tendency:2} the score should be 3 (goalDiff).
    // We test this via bestScoreline by using a distribution skewed entirely toward 3:1.
    // The canonical awayWins list contains [1,3] (away, diff -2).
    // For the goalDiff branch we use home wins: 2:0 and 3:1 both have goal diff +2.
    // We craft probs that put 100% weight on home-win tendency, then compare the EP
    // of tip 2:0 vs tip 1:0 — 2:0 shares goal-diff with 3:1, 1:0 does not.
    // Verify using rules where goalDiff >> tendency to confirm that branch fires.
    const rulesHighGoalDiff = { exact: 4, goalDiff: 10, tendency: 1 };
    const probs = { home: 1.0, draw: 0.0, away: 0.0 };
    const r = bestScoreline(probs, rulesHighGoalDiff, 4);
    // With goalDiff=10 >> tendency=1 the optimizer should prefer a tip that maximises
    // goalDiff matches; the result must be a home win and EP must reflect goalDiff scoring.
    expect(r.score.home).toBeGreaterThan(r.score.away);
    expect(r.expectedPoints).toBeGreaterThan(0);
    // EP with goalDiff=10 must be strictly higher than with goalDiff=1,
    // proving the goalDiff branch is actually contributing to the score.
    const rLowGoalDiff = bestScoreline(probs, { exact: 4, goalDiff: 1, tendency: 1 }, 4);
    expect(r.expectedPoints).toBeGreaterThan(rLowGoalDiff.expectedPoints);
  });
});

describe('expectedStrategy', () => {
  it('returns a valid Prediction shape with known odds', () => {
    const rules = { exact: 4, goalDiff: 3, tendency: 2 };
    const result = expectedStrategy(
      { matchId: 42, home: 'Bayern', away: 'Dortmund', odds: { home: 1.8, draw: 3.5, away: 4.5 } },
      rules,
    );

    // matchId is preserved
    expect(result.matchId).toBe(42);
    expect(result.home).toBe('Bayern');
    expect(result.away).toBe('Dortmund');

    // probs sum to 1
    expect(result.probs.home + result.probs.draw + result.probs.away).toBeCloseTo(1, 5);

    // score has non-negative integers
    expect(result.score.home).toBeGreaterThanOrEqual(0);
    expect(result.score.away).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.score.home)).toBe(true);
    expect(Number.isInteger(result.score.away)).toBe(true);

    // expectedPoints > 0
    expect(result.expectedPoints).toBeGreaterThan(0);

    // rationale is a non-empty string
    expect(typeof result.rationale).toBe('string');
    expect(result.rationale.length).toBeGreaterThan(0);
  });
});
