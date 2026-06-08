import type { TendencyProbs, ScoringRules, Score } from '../domain/types.js';

// Heuristic P(exact scoreline) from tendency probs: distribute each tendency's probability
// over a small set of canonical scorelines for that tendency, weighted by typical frequency.
function scorelineProbabilities(probs: TendencyProbs, maxGoals: number): Map<string, number> {
  const m = new Map<string, number>();
  const add = (h: number, a: number, p: number) => {
    const k = `${h}:${a}`;
    m.set(k, (m.get(k) || 0) + p);
  };

  // canonical home wins, draws, away wins with descending weights
  const homeWins = [[1, 0], [2, 1], [2, 0], [3, 1]];
  const draws    = [[1, 1], [0, 0], [2, 2]];
  const awayWins = [[0, 1], [1, 2], [0, 2], [1, 3]];

  const dist = (list: number[][], total: number) => {
    // Only keep scorelines that satisfy maxGoals constraint
    const kept = list.filter(([h, a]) => h <= maxGoals && a <= maxGoals);
    // Re-compute normalising sum from the kept entries only, so probabilities still sum to total
    const w  = kept.map((_, i) => 1 / (i + 1));
    const sw = w.reduce((a, b) => a + b, 0);
    kept.forEach(([h, a], i) => add(h, a, (total * w[i]) / sw));
  };

  dist(homeWins, probs.home);
  dist(draws,    probs.draw);
  dist(awayWins, probs.away);
  return m;
}

const tendencyOf = (h: number, a: number): 'home' | 'draw' | 'away' =>
  h > a ? 'home' : h < a ? 'away' : 'draw';

function points(tip: Score, actual: Score, rules: ScoringRules): number {
  if (tip.home === actual.home && tip.away === actual.away) return rules.exact;
  if (tendencyOf(tip.home, tip.away) === tendencyOf(actual.home, actual.away)) {
    if (tip.home - tip.away === actual.home - actual.away) return rules.goalDiff;
    return rules.tendency;
  }
  return 0;
}

export function bestScoreline(
  probs: TendencyProbs,
  rules: ScoringRules,
  maxGoals = 4,
): { score: Score; expectedPoints: number; rationale: string } {
  const sp = scorelineProbabilities(probs, maxGoals);
  let best: Score = { home: 1, away: 1 };
  let bestEp = -1;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      let ep = 0;
      for (const [k, p] of sp) {
        const [ah, aa] = k.split(':').map(Number);
        ep += p * points({ home: h, away: a }, { home: ah, away: aa }, rules);
      }
      if (ep > bestEp) {
        bestEp = ep;
        best = { home: h, away: a };
      }
    }
  }

  // Use the actual optimal score's tendency, not the raw probability leader
  const lead = tendencyOf(best.home, best.away);
  return {
    score: best,
    expectedPoints: Number(bestEp.toFixed(3)),
    rationale: `de-margined p(home/draw/away)=${probs.home.toFixed(2)}/${probs.draw.toFixed(2)}/${probs.away.toFixed(2)}; expected-points-max tip favours ${lead}`,
  };
}
