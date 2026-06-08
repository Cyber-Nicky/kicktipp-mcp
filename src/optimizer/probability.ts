import type { Odds, TendencyProbs } from '../domain/types.js';
export function deMargin(odds: Odds): TendencyProbs {
  const raw = { home: 1 / odds.home, draw: 1 / odds.draw, away: 1 / odds.away };
  const s = raw.home + raw.draw + raw.away;
  return { home: raw.home / s, draw: raw.draw / s, away: raw.away / s };
}
