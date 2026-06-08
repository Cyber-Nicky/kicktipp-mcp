import type { MatchdayDistribution, Prediction, BetFormMatch } from '../domain/types.js';

export function renderDistribution(d: MatchdayDistribution): string {
  const lines = [`Tippverteilung — ${d.community} (Spieltag ${d.spieltagIndex ?? '?'}) [${d.visibility ?? 'n/a'}]`];
  for (const m of d.matches) {
    if (!m.dataAvailable) {
      lines.push(`  ${m.home} vs ${m.away}: (no data yet)`);
      continue;
    }
    const top = m.byResult.slice(0, 3).map((r) => `${r.score} ${r.pct}%`).join('  ');
    const tendency = m.byTendency
      ? `1/X/2 = ${m.byTendency.home}/${m.byTendency.draw}/${m.byTendency.away}   `
      : '';
    lines.push(`  ${m.home} vs ${m.away}: ${tendency}top: ${top}`);
  }
  return lines.join('\n');
}

export function renderPredictions(ps: Prediction[]): string {
  return ps.map((p) => `${p.home} ${p.score.home}:${p.score.away} ${p.away}  (EP ${p.expectedPoints})`).join('\n');
}

export function renderMatchday(ms: BetFormMatch[]): string {
  return ms
    .map(
      (m) =>
        `[${m.formIndex}] ${m.home} vs ${m.away}  odds ${m.odds ? `${m.odds.home}/${m.odds.draw}/${m.odds.away}` : '—'}  you: ${m.currentHome ?? '-'}:${m.currentAway ?? '-'}${m.locked ? ' (locked)' : ''}`,
    )
    .join('\n');
}
