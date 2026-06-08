type Dist = { byTendency: { home: number; draw: number; away: number } | null; byResult: { score: string; pct: number }[]; dataAvailable: boolean; visibility: string | null; };

// quote-aware split of a JS array-literal argument list
function splitCols(row: string): string[] {
  const out: string[] = []; let cur = ''; let q: string | null = null;
  for (const ch of row) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === "'" || ch === '"') q = ch;
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const numDe = (s: string) => parseFloat(s.replace('%', '').replace(',', '.'));

export function parseDistribution(html: string): Dist {
  const visibility = (html.match(/Sichtbarkeit der Tipps<\/div><div class="spieldaten-infos-value">([^<]*)/) || [])[1]?.trim() ?? null;
  const body = (html.match(/function prepare\(\)\s*\{([\s\S]*?)\n\s*\}\s*function drawCharts/) || [, ''])[1];
  const segs = body.split(/var id = '([a-zA-Z]+)'/);
  const charts: Record<string, string[][]> = {};
  for (let i = 1; i < segs.length; i += 2) {
    const id = segs[i]; const seg = segs[i + 1] || '';
    charts[id] = [...seg.matchAll(/data\.addRow\(\[([^\]]*)\]\)/g)].map((m) => splitCols(m[1]));
  }
  const tend = charts['tippverteilungNachTendenz'] || [];
  const map: Record<string, number> = {};
  for (const r of tend) if (r.length >= 2) map[r[0].toLowerCase()] = Number(r[1]);
  const byTendency = tend.length ? { home: map['heim'] ?? 0, draw: map['remis'] ?? 0, away: map['gast'] ?? 0 } : null;
  const byResult = (charts['tippverteilungNachErgebnis'] || [])
    .filter((r) => r.length >= 2)
    .map((r) => ({ score: r[0], pct: numDe(r[r.length - 1]) }));   // last col is the 'xx,xx%' annotation
  const dataAvailable = !!byResult.length || (!!byTendency && (byTendency.home + byTendency.draw + byTendency.away) > 0);
  return { byTendency: dataAvailable ? byTendency : null, byResult, dataAvailable, visibility };
}
