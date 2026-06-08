import type { Odds, ScoringRules, Prediction } from '../domain/types.js';
import { deMargin } from './probability.js';
import { bestScoreline } from './expectedPoints.js';
export type Strategy = (input: { matchId: number; home: string; away: string; odds: Odds }, rules: ScoringRules) => Prediction;
export const expectedStrategy: Strategy = ({ matchId, home, away, odds }, rules) => {
  const probs = deMargin(odds);
  const { score, expectedPoints, rationale } = bestScoreline(probs, rules);
  return { matchId, home, away, probs, score, expectedPoints, rationale };
};
export const strategies: Record<string, Strategy> = { expected: expectedStrategy };
