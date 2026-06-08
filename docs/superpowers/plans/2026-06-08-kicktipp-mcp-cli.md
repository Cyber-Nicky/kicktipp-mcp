# KickTipp MCP Server + CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript package exposing a KickTipp MCP server (stdio) and a `ktipp` CLI from one typed core — reading rounds/fixtures/odds/standings, the crowd tip-distribution, computing expected-points-optimal predictions, and (dry-run-first) submitting tips, across multiple communities/accounts, all over a fast HTTP-direct client.

**Architecture:** Layered HTTP-direct (Node 22 native `fetch` + `cheerio`, no browser). Pure parsers/optimizer (no I/O) → `Http` client → `Session` (cookie persistence) → `KickTippClient` core façade → two thin adapters (MCP, CLI). Pure units are TDD'd against real captured HTML fixtures.

**Tech Stack:** TypeScript (ESM, Node 22+), `@modelcontextprotocol/sdk`, `commander`, `cheerio`, `zod`; `vitest`, `tsup`, `tsx`. Session secrets in macOS Keychain (`security` CLI) with encrypted-file fallback.

**Reference docs:** `docs/superpowers/specs/2026-06-08-kicktipp-mcp-cli-design.md` (spec), `research/LIVE-FINDINGS.md` (verified mechanics), `research/SYNTHESIS.md` (reference-tool analysis). Captured HTML for fixtures is in `research/recon/`.

---

## Shared Contracts (defined once, used everywhere)

All types live in `src/domain/types.ts` (Task 3). Referenced throughout:

```typescript
export interface Community { slug: string; name: string; }
export type Tendency = 'home' | 'draw' | 'away';
export interface Odds { home: number; draw: number; away: number; }
export interface TendencyProbs { home: number; draw: number; away: number; }
export interface Score { home: number; away: number; }

export interface MatchOverview { matchId: number; home: string; away: string; kickoff: string | null; }
export interface BetFormMatch {
  matchId: number; home: string; away: string; kickoff: string | null;
  homeInputName: string; awayInputName: string;
  odds: Odds | null; locked: boolean;
  currentHome: number | null; currentAway: number | null;
}
export interface ResultShare { score: string; pct: number; }
export interface TipDistribution {
  matchId: number; home: string; away: string;
  byTendency: { home: number; draw: number; away: number } | null;
  byResult: ResultShare[]; dataAvailable: boolean;
}
export interface MatchdayDistribution {
  community: string; spieltagIndex: number | null; visibility: string | null;
  matches: TipDistribution[];
}
export interface Standing { rank: number; team: string; played: number; goalsFor: number; goalsAgainst: number; points: number; }
export interface Fixture { matchId: number; home: string; away: string; kickoff: string | null; homeGoals: number | null; awayGoals: number | null; }
export interface ScoringRules { exact: number; goalDiff: number; tendency: number; }
export interface Prediction {
  matchId: number; home: string; away: string;
  probs: TendencyProbs; score: Score; expectedPoints: number; rationale: string;
}
```

`Http` contract (Task 6) — `fetchFn` is injectable for tests:

```typescript
export interface HttpResponse { status: number; finalUrl: string; html: string; }
export class Http {
  constructor(opts?: { cookies?: Record<string, string>; fetchFn?: typeof fetch });
  get(url: string): Promise<HttpResponse>;
  postForm(url: string, params: Record<string, string>): Promise<HttpResponse>;
  cookies(): Record<string, string>;
}
```

`KickTippClient` core façade (Task 13):

```typescript
class KickTippClient {
  constructor(session: Session);
  getStatus(): Promise<{ loggedIn: boolean; email: string | null; communities: Community[] }>;
  listCommunities(): Promise<Community[]>;
  getMatchday(o: { community: string; spieltagIndex?: number }): Promise<BetFormMatch[]>;
  getSchedule(o: { community: string; spieltagIndex?: number }): Promise<Fixture[]>;
  getStandings(o: { community: string }): Promise<Standing[]>;
  getRules(o: { community: string }): Promise<ScoringRules>;
  getTipDistribution(o: { community: string; spieltagIndex?: number }): Promise<MatchdayDistribution>;
  predictMatchday(o: { community: string; spieltagIndex?: number }): Promise<Prediction[]>;
  placeBets(o: { community: string; spieltagIndex?: number; bets: { matchId: number; home: number; away: number }[]; dryRun: boolean; override?: boolean }): Promise<{ submitted: boolean; diff: { matchId: number; from: Score | null; to: Score }[] }>;
}
```

---

## File Structure

```
package.json · tsconfig.json · tsup.config.ts · vitest.config.ts
src/
  domain/types.ts        all interfaces above + zod schemas
  urls.ts                pure URL builders
  errors.ts              typed error classes
  scrape/
    odds.ts              parseOdds(html) → Odds | null   (multi-strategy)
    distribution.ts      parseDistribution(html) → {byTendency, byResult, dataAvailable, visibility}
    communities.ts       parseCommunities(html) → Community[]
    overview.ts          parseMatchdayOverview(html) → { spieltagIndex, matches: MatchOverview[] }
    betform.ts           parseBetForm(html) → { fields, matches: BetFormMatch[] }
    standings.ts         parseStandings(html) → Standing[]
    schedule.ts          parseSchedule(html) → Fixture[]
    rules.ts             parseRules(html) → ScoringRules
  optimizer/
    probability.ts       deMargin(odds) → TendencyProbs
    expectedPoints.ts    bestScoreline(probs, rules, maxGoals) → { score, expectedPoints, rationale }
  http/client.ts         Http
  auth/keychain.ts       Keychain (security CLI + file fallback)
  auth/session.ts        Session: login/ensureValid/cookies
  config.ts              Profile store
  core.ts                KickTippClient
  mcp/server.ts          MCP tools + resources + prompts
  cli/render.ts          pretty renderers
  cli/index.ts           commander program
  bin/ktipp.ts           CLI entry
  bin/mcp.ts             MCP entry
test/
  fixtures/              real HTML copied from research/recon/
  *.test.ts
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tsup.config.ts`, `src/index.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "kicktipp-mcp",
  "version": "0.1.0",
  "type": "module",
  "bin": { "ktipp": "dist/ktipp.js", "kicktipp-mcp": "dist/mcp.js" },
  "scripts": {
    "build": "tsup",
    "dev:cli": "tsx src/bin/ktipp.ts",
    "dev:mcp": "tsx src/bin/mcp.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "cheerio": "^1.0.0",
    "commander": "^12.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "resolveJsonModule": true, "declaration": false, "outDir": "dist",
    "lib": ["ES2023"], "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, environment: 'node', include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 4: Create `tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { ktipp: 'src/bin/ktipp.ts', mcp: 'src/bin/mcp.ts' },
  format: ['esm'], target: 'node22', clean: true, banner: { js: '#!/usr/bin/env node' },
});
```

- [ ] **Step 5: Create `src/index.ts`** (placeholder export so typecheck has an entry)

```typescript
export const version = '0.1.0';
```

- [ ] **Step 6: Install and verify**

Run: `npm install && npm run typecheck`
Expected: install succeeds; `tsc --noEmit` exits 0 with no output.

- [ ] **Step 7: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold kicktipp-mcp project"
```
(If git isn't initialized and the user hasn't approved git, skip `git init` and just stage; confirm with user.)

---

## Task 2: Copy fixtures from recon

**Files:**
- Create: `test/fixtures/*.html` (copied from `research/recon/`)

- [ ] **Step 1: Copy the captured HTML into the test tree**

Run:
```bash
mkdir -p test/fixtures
cp research/recon/01_login_page.html            test/fixtures/login.html
cp research/recon/04_meinetipprunden.html        test/fixtures/meinetipprunden-empty.html
cp research/recon/comm_fussball-wm-tippspiel_spiel_1199443860.html test/fixtures/distribution-populated.html
cp research/recon/comm_bundesliga-tippspiel_spiel_1503034391.html  test/fixtures/distribution-empty.html
cp research/recon/comm_bundesliga-tippspiel_tippuebersicht.html    test/fixtures/tippuebersicht.html
cp research/recon/comm_bundesliga-tippspiel_tabellen.html          test/fixtures/tabellen.html
cp research/recon/comm_bundesliga-tippspiel_tippspielplan.html     test/fixtures/tippspielplan.html
```
Expected: files exist. (If a source file is missing, list `research/recon/` and pick the closest real round snapshot.)

- [ ] **Step 2: Add a fixture loader helper** — Create `test/helpers.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (name: string) => readFileSync(join(here, 'fixtures', name), 'utf8');
```

- [ ] **Step 3: Commit**

```bash
git add test/ && git commit -m "test: add real KickTipp HTML fixtures from recon"
```

---

## Task 3: Domain types + zod schemas

**Files:**
- Create: `src/domain/types.ts`
- Test: `test/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { OddsSchema, PredictionSchema } from '../src/domain/types.js';

describe('schemas', () => {
  it('accepts valid odds', () => {
    expect(OddsSchema.parse({ home: 1.5, draw: 3.4, away: 5.0 })).toEqual({ home: 1.5, draw: 3.4, away: 5.0 });
  });
  it('rejects negative odds', () => {
    expect(() => OddsSchema.parse({ home: -1, draw: 3, away: 5 })).toThrow();
  });
  it('validates a prediction shape', () => {
    const p = { matchId: 1, home: 'A', away: 'B', probs: { home: 0.5, draw: 0.3, away: 0.2 }, score: { home: 2, away: 1 }, expectedPoints: 1.2, rationale: 'x' };
    expect(PredictionSchema.parse(p).score.home).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run test/types.test.ts` — Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/domain/types.ts`** — paste all interfaces from "Shared Contracts" above, then add zod schemas:

```typescript
import { z } from 'zod';
// ... (all interfaces from Shared Contracts) ...
export const OddsSchema = z.object({ home: z.number().positive(), draw: z.number().positive(), away: z.number().positive() });
export const TendencyProbsSchema = z.object({ home: z.number(), draw: z.number(), away: z.number() });
export const ScoreSchema = z.object({ home: z.number().int().min(0), away: z.number().int().min(0) });
export const CommunitySchema = z.object({ slug: z.string(), name: z.string() });
export const PredictionSchema = z.object({
  matchId: z.number(), home: z.string(), away: z.string(),
  probs: TendencyProbsSchema, score: ScoreSchema, expectedPoints: z.number(), rationale: z.string(),
});
export const ResultShareSchema = z.object({ score: z.string(), pct: z.number() });
export const TipDistributionSchema = z.object({
  matchId: z.number(), home: z.string(), away: z.string(),
  byTendency: z.object({ home: z.number(), draw: z.number(), away: z.number() }).nullable(),
  byResult: z.array(ResultShareSchema), dataAvailable: z.boolean(),
});
export const StandingSchema = z.object({ rank: z.number(), team: z.string(), played: z.number(), goalsFor: z.number(), goalsAgainst: z.number(), points: z.number() });
```

- [ ] **Step 4: Run to verify pass** — Run: `npx vitest run test/types.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit** — `git add src/domain test/types.test.ts && git commit -m "feat: domain types + zod schemas"`

---

## Task 4: URL builders

**Files:**
- Create: `src/urls.ts`
- Test: `test/urls.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { urls } from '../src/urls.js';

describe('urls', () => {
  const u = urls('https://www.kicktipp.de');
  it('builds login + action', () => {
    expect(u.loginPage()).toBe('https://www.kicktipp.de/info/profil/login');
    expect(u.loginAction()).toBe('https://www.kicktipp.de/info/profil/loginaction');
  });
  it('builds per-community pages with matchday', () => {
    expect(u.tippabgabe('bundesliga-tippspiel')).toBe('https://www.kicktipp.de/bundesliga-tippspiel/tippabgabe');
    expect(u.tippuebersicht('x', 5)).toBe('https://www.kicktipp.de/x/tippuebersicht?spieltagIndex=5');
    expect(u.matchDetail('x', 99)).toBe('https://www.kicktipp.de/x/tippuebersicht/spiel?tippspielId=99');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — Run: `npx vitest run test/urls.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/urls.ts`**

```typescript
export function urls(base = 'https://www.kicktipp.de') {
  const b = base.replace(/\/$/, '');
  const q = (n: number | undefined, key: string) => (n != null ? `?${key}=${n}` : '');
  return {
    base: () => b + '/',
    loginPage: () => `${b}/info/profil/login`,
    loginAction: () => `${b}/info/profil/loginaction`,
    meineTipprunden: () => `${b}/info/profil/meinetipprunden`,
    tippabgabe: (slug: string, md?: number) => `${b}/${slug}/tippabgabe${q(md, 'spieltagIndex')}`,
    tippuebersicht: (slug: string, md?: number) => `${b}/${slug}/tippuebersicht${q(md, 'spieltagIndex')}`,
    matchDetail: (slug: string, tippspielId: number) => `${b}/${slug}/tippuebersicht/spiel?tippspielId=${tippspielId}`,
    tabellen: (slug: string) => `${b}/${slug}/tabellen`,
    tippspielplan: (slug: string, md?: number) => `${b}/${slug}/tippspielplan${q(md, 'spieltagIndex')}`,
  };
}
export type Urls = ReturnType<typeof urls>;
```

- [ ] **Step 4: Run to verify pass** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/urls.ts test/urls.test.ts && git commit -m "feat: url builders"`

---

## Task 5: Errors

**Files:**
- Create: `src/errors.ts`
- Test: `test/errors.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { AuthError, NotMemberError, ParseError, KickTippError } from '../src/errors.js';
describe('errors', () => {
  it('subclass instanceof base', () => {
    expect(new AuthError('x')).toBeInstanceOf(KickTippError);
    expect(new NotMemberError('round')).toBeInstanceOf(KickTippError);
  });
  it('ParseError carries the selector', () => {
    expect(new ParseError('msg', '#tippabgabeSpiele').selector).toBe('#tippabgabeSpiele');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/errors.ts`**

```typescript
export class KickTippError extends Error { constructor(msg: string) { super(msg); this.name = new.target.name; } }
export class AuthError extends KickTippError {}
export class NotMemberError extends KickTippError {}
export class DeadlinePassedError extends KickTippError {}
export class RateLimitError extends KickTippError {}
export class ConsentWallError extends KickTippError {}
export class ParseError extends KickTippError {
  selector?: string;
  constructor(msg: string, selector?: string) { super(msg); this.selector = selector; }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: typed errors"`

---

## Task 6: Odds parser (multi-strategy)

**Files:**
- Create: `src/scrape/odds.ts`
- Test: `test/odds.test.ts`

Background: 4 selector families across eras (see `research/SYNTHESIS.md` §4). Parse to `{home,draw,away}` mapped by the `1/X/2` label where present; normalize German comma → dot.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseOdds } from '../src/scrape/odds.js';

describe('parseOdds', () => {
  it('parses slash-separated text (legacy)', () => {
    expect(parseOdds('<td class="kicktipp-wettquote">1,50 / 3,40 / 5,00</td>')).toEqual({ home: 1.5, draw: 3.4, away: 5.0 });
  });
  it('parses per-outcome spans', () => {
    const html = `<span class="quote-heim"><span class="quote-text">1,50</span></span>
                  <span class="quote-remis"><span class="quote-text">3,40</span></span>
                  <span class="quote-gast"><span class="quote-text">5,00</span></span>`;
    expect(parseOdds(html)).toEqual({ home: 1.5, draw: 3.4, away: 5.0 });
  });
  it('parses label/text pairs mapped by 1/X/2', () => {
    const html = `<a class="quote"><span class="quote-label">2</span><span class="quote-text">5,00</span></a>
                  <a class="quote"><span class="quote-label">1</span><span class="quote-text">1,50</span></a>
                  <a class="quote"><span class="quote-label">X</span><span class="quote-text">3,40</span></a>`;
    expect(parseOdds(html)).toEqual({ home: 1.5, draw: 3.4, away: 5.0 });
  });
  it('returns null when no odds present', () => {
    expect(parseOdds('<td></td>')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/scrape/odds.ts`**

```typescript
import * as cheerio from 'cheerio';
import type { Odds } from '../domain/types.js';
const num = (s: string): number | null => { const v = parseFloat(s.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : null; };

export function parseOdds(html: string): Odds | null {
  const $ = cheerio.load(html);
  // Strategy A: per-outcome spans (modern .com / ad-free)
  const heim = num($('.quote-heim .quote-text').first().text() || '');
  const remis = num($('.quote-remis .quote-text').first().text() || '');
  const gast = num($('.quote-gast .quote-text').first().text() || '');
  if (heim && remis && gast) return { home: heim, draw: remis, away: gast };
  // Strategy B: label/text pairs mapped by 1/X/2
  const byLabel: Record<string, number> = {};
  $('.quote').each((_, el) => {
    const label = $(el).find('.quote-label').text().trim();
    const val = num($(el).find('.quote-text').text());
    if (label && val) byLabel[label] = val;
  });
  if (byLabel['1'] && byLabel['X'] && byLabel['2']) return { home: byLabel['1'], draw: byLabel['X'], away: byLabel['2'] };
  // Strategy C: slash-separated text (kicktipp-wettquote / wettquote-link / plain "Quote: a / b / c")
  const text = ($('.kicktipp-wettquote').text() || $('.wettquote-link').text() || $.root().text()).replace(/Quote:/i, '');
  const parts = text.split('/').map((s) => num(s)).filter((v): v is number => v != null);
  if (parts.length >= 3) return { home: parts[0], draw: parts[1], away: parts[2] };
  return null;
}
```

- [ ] **Step 4: Run → PASS (4 tests).**
- [ ] **Step 5: Commit** — `git commit -am "feat: multi-strategy odds parser"`

---

## Task 7: Tip-distribution parser (the priority feature)

**Files:**
- Create: `src/scrape/distribution.ts`
- Test: `test/distribution.test.ts`

Background (`research/LIVE-FINDINGS.md` §3): data is in a Google-Charts `prepare()` JS body — `var id = '...'` segments containing `data.addRow([...])`. `tippverteilungNachTendenz` = counts `['Heim',n]`; `tippverteilungNachErgebnis` = `['2:1', pct, '<style>', 'pct,xx%']`.

- [ ] **Step 1: Failing test** (uses real fixtures)

```typescript
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
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/scrape/distribution.ts`**

```typescript
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
```

- [ ] **Step 4: Run → PASS.** If `byResult` pct picks the wrong column, inspect `test/fixtures/distribution-populated.html` and adjust which column holds the percentage (annotation is the last quoted col `'50,00%'`).
- [ ] **Step 5: Commit** — `git commit -am "feat: Tippverteilung (tip-distribution) parser"`

---

## Task 8: Communities parser

**Files:** Create `src/scrape/communities.ts`; Test `test/communities.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseCommunities } from '../src/scrape/communities.js';
import { fixture } from './helpers.js';
describe('parseCommunities', () => {
  it('returns [] for a member-less account', () => {
    expect(parseCommunities(fixture('meinetipprunden-empty.html'))).toEqual([]);
  });
  it('extracts slug+name from round links', () => {
    const html = `<div id="kicktipp-content"><a href="/my-round"><div class="menu-title-mit-tippglocke">my-round</div></a>
                  <a href="/other">other</a></div>`;
    const c = parseCommunities(html);
    expect(c).toContainEqual({ slug: 'my-round', name: 'my-round' });
    expect(c).toContainEqual({ slug: 'other', name: 'other' });
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/scrape/communities.ts`**

```typescript
import * as cheerio from 'cheerio';
import type { Community } from '../domain/types.js';
const RESERVED = new Set(['info', 'assets', 'images']);
export function parseCommunities(html: string): Community[] {
  const $ = cheerio.load(html);
  const out = new Map<string, Community>();
  $('#kicktipp-content a[href^="/"], a[href^="/"]').each((_, el) => {
    const href = ($(el).attr('href') || '').replace(/^\/|\/$/g, '');
    if (!href || href.includes('/') || RESERVED.has(href)) return;
    const text = $(el).text().trim();
    const glocke = $(el).find('.menu-title-mit-tippglocke').text().trim();
    if (glocke && glocke.toLowerCase() === href.toLowerCase()) out.set(href, { slug: href, name: glocke });
    else if (text && text.toLowerCase() === href.toLowerCase()) out.set(href, { slug: href, name: text });
  });
  return [...out.values()];
}
```

- [ ] **Step 4: Run → PASS.** (If a real member-account fixture becomes available later, add it.)
- [ ] **Step 5: Commit** — `git commit -am "feat: communities parser"`

---

## Task 9: Matchday-overview parser (matches + tippspielIds)

**Files:** Create `src/scrape/overview.ts`; Test `test/overview.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseMatchdayOverview } from '../src/scrape/overview.js';
import { fixture } from './helpers.js';
describe('parseMatchdayOverview', () => {
  it('extracts matches with ids and team names from a real overview', () => {
    const o = parseMatchdayOverview(fixture('tippuebersicht.html'));
    expect(o.matches.length).toBeGreaterThan(0);
    expect(o.matches[0]).toHaveProperty('matchId');
    expect(typeof o.matches[0].matchId).toBe('number');
    expect(o.matches[0].home.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/scrape/overview.ts`**

```typescript
import * as cheerio from 'cheerio';
import type { MatchOverview } from '../domain/types.js';
export function parseMatchdayOverview(html: string): { spieltagIndex: number | null; matches: MatchOverview[] } {
  const $ = cheerio.load(html);
  const spieltagIndex = Number((html.match(/spieltagIndex=([0-9]+)/) || [])[1]) || null;
  const matches: MatchOverview[] = [];
  $('a[href*="tippspielId="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const matchId = Number((href.match(/tippspielId=([0-9]+)/) || [])[1]);
    if (!matchId || matches.some((m) => m.matchId === matchId)) return;
    const row = $(el).closest('tr');
    const cells = row.find('td').map((_, td) => $(td).text().trim()).get();
    const home = cells[1] || '';
    const away = cells[2] || '';
    const kickoff = /\d{2}\.\d{2}\.\d{2}/.test(cells[0] || '') ? cells[0] : null;
    matches.push({ matchId, home, away, kickoff });
  });
  return { spieltagIndex, matches };
}
```

- [ ] **Step 4: Run → PASS.** If team-name columns differ in the real fixture, inspect `test/fixtures/tippuebersicht.html` and adjust the cell indices (home/away), preferring stable cell classes (`.col1`/`.col2`) over indices when present.
- [ ] **Step 5: Commit** — `git commit -am "feat: matchday overview parser"`

---

## Task 10: Standings, schedule, rules parsers

**Files:** Create `src/scrape/standings.ts`, `src/scrape/schedule.ts`, `src/scrape/rules.ts`; Test `test/standings.test.ts`, `test/schedule.test.ts`, `test/rules.test.ts`

- [ ] **Step 1: Failing test (`test/standings.test.ts`)**

```typescript
import { describe, it, expect } from 'vitest';
import { parseStandings } from '../src/scrape/standings.js';
import { fixture } from './helpers.js';
describe('parseStandings', () => {
  it('parses the football table from a real page', () => {
    const rows = parseStandings(fixture('tabellen.html'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('team');
    expect(rows[0]).toHaveProperty('points');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/scrape/standings.ts`**

```typescript
import * as cheerio from 'cheerio';
import type { Standing } from '../domain/types.js';
export function parseStandings(html: string): Standing[] {
  const $ = cheerio.load(html);
  const out: Standing[] = [];
  $('table tr').each((_, tr) => {
    const c = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
    if (c.length < 4) return;
    const rank = parseInt(c[0], 10);
    const team = c.find((x) => /[A-Za-zÄÖÜäöü]/.test(x)) || '';
    const nums = c.map((x) => parseInt(x.replace(/[^\d-]/g, ''), 10)).filter((n) => Number.isFinite(n));
    if (!Number.isFinite(rank) || !team) return;
    const played = nums[1] ?? 0;
    const goals = (c.find((x) => /:/.test(x)) || '0:0').split(':').map((n) => parseInt(n, 10));
    const points = nums[nums.length - 1] ?? 0;
    out.push({ rank, team, played, goalsFor: goals[0] || 0, goalsAgainst: goals[1] || 0, points });
  });
  return out;
}
```

- [ ] **Step 4: Run → PASS.** Inspect `test/fixtures/tabellen.html`; if columns differ, prefer class selectors (`.col2` games, `.col4` goals) per `research/SYNTHESIS.md` §4.

- [ ] **Step 5: Implement `src/scrape/schedule.ts`** with a matching test (`test/schedule.test.ts`, asserting `parseSchedule(fixture('tippspielplan.html')).length > 0` and each item has `matchId`,`home`,`away`):

```typescript
import * as cheerio from 'cheerio';
import type { Fixture } from '../domain/types.js';
export function parseSchedule(html: string): Fixture[] {
  const $ = cheerio.load(html);
  const out: Fixture[] = [];
  $('a[href*="tippspielId="], tr').each((_, el) => {
    const row = el.tagName === 'tr' ? $(el) : $(el).closest('tr');
    const href = row.find('a[href*="tippspielId="]').attr('href') || '';
    const matchId = Number((href.match(/tippspielId=([0-9]+)/) || [])[1]) || 0;
    const c = row.find('td').map((_, td) => $(td).text().trim()).get();
    if (c.length < 3) return;
    const home = c[1] || ''; const away = c[2] || '';
    const res = (c.find((x) => /^\d+\s*:\s*\d+$/.test(x)) || '').split(':').map((n) => parseInt(n, 10));
    if (!home || !away || out.some((f) => f.matchId === matchId && matchId)) return;
    out.push({ matchId, home, away, kickoff: /\d{2}\.\d{2}\.\d{2}/.test(c[0]) ? c[0] : null, homeGoals: res[0] ?? null, awayGoals: res[1] ?? null });
  });
  return out;
}
```

- [ ] **Step 6: Implement `src/scrape/rules.ts`** with test (`test/rules.test.ts`): given `'<td>Tipp mit richtigem Ergebnis</td><td>4</td> ... Tordifferenz ... 3 ... Tendenz ... 2'`, returns `{exact:4,goalDiff:3,tendency:2}`. Falls back to KickTipp defaults `{exact:4,goalDiff:3,tendency:2}` when unparseable.

```typescript
import * as cheerio from 'cheerio';
import type { ScoringRules } from '../domain/types.js';
export function parseRules(html: string): ScoringRules {
  const text = cheerio.load(html).root().text().replace(/\s+/g, ' ');
  const near = (label: RegExp): number | null => { const m = text.match(new RegExp(label.source + '[^0-9]{0,40}?(\\d+)', 'i')); return m ? parseInt(m[1], 10) : null; };
  return {
    exact: near(/richtige?[ms]? Ergebnis|exakte/) ?? 4,
    goalDiff: near(/Tordifferenz|Differenz/) ?? 3,
    tendency: near(/Tendenz|Sieger|richtige Tendenz/) ?? 2,
  };
}
```

- [ ] **Step 7: Run all three → PASS.**
- [ ] **Step 8: Commit** — `git commit -am "feat: standings/schedule/rules parsers"`

---

## Task 11: Bet-form parser

**Files:** Create `src/scrape/betform.ts`; Test `test/betform.test.ts`

Background (`research/LIVE-FINDINGS.md` §5): table `#tippabgabeSpiele`, rows `tr.datarow`, score inputs by `name` containing `heimTipp`/`gastTipp` (id-suffix `_heimTipp`/`_gastTipp`), locked cells `td.nichttippbar`, hidden form fields carried through, odds via Task 6. The exact `name` attribute is verified live; the parser reads it dynamically so it's robust either way.

- [ ] **Step 1: Failing test** (synthetic HTML modeling the documented structure)

```typescript
import { describe, it, expect } from 'vitest';
import { parseBetForm } from '../src/scrape/betform.js';
const HTML = `<form><input type="hidden" name="ticket" value="abc">
<table id="tippabgabeSpiele">
 <tr class="datarow"><td>02.10.26 20:30</td><td>Bayern</td><td>Dortmund</td>
   <td><input id="r1_heimTipp" name="spieltippForms[0].heimTipp" value=""><input id="r1_gastTipp" name="spieltippForms[0].gastTipp" value=""></td>
   <td><span class="quote-heim"><span class="quote-text">1,50</span></span><span class="quote-remis"><span class="quote-text">4,00</span></span><span class="quote-gast"><span class="quote-text">6,00</span></span></td>
 </tr>
</table><button name="submitbutton">Tipps speichern</button></form>`;
describe('parseBetForm', () => {
  it('extracts hidden fields, matches, input names, and odds', () => {
    const f = parseBetForm(HTML);
    expect(f.fields.ticket).toBe('abc');
    expect(f.matches).toHaveLength(1);
    expect(f.matches[0]).toMatchObject({ home: 'Bayern', away: 'Dortmund', homeInputName: 'spieltippForms[0].heimTipp', awayInputName: 'spieltippForms[0].gastTipp', locked: false });
    expect(f.matches[0].odds).toEqual({ home: 1.5, draw: 4.0, away: 6.0 });
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/scrape/betform.ts`**

```typescript
import * as cheerio from 'cheerio';
import { parseOdds } from './odds.js';
import type { BetFormMatch } from '../domain/types.js';
import { ParseError } from '../errors.js';

export function parseBetForm(html: string): { fields: Record<string, string>; matches: BetFormMatch[] } {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => { const n = $(el).attr('name'); if (n) fields[n] = $(el).attr('value') || ''; });

  const table = $('#tippabgabeSpiele');
  if (!table.length) throw new ParseError('bet table not found', '#tippabgabeSpiele');
  const matches: BetFormMatch[] = [];
  let lastKickoff: string | null = null;
  table.find('tr').each((_, tr) => {
    const row = $(tr);
    const heim = row.find('input[name*="heimTipp"], input[id$="_heimTipp"]').first();
    const gast = row.find('input[name*="gastTipp"], input[id$="_gastTipp"]').first();
    if (!heim.length || !gast.length) return;
    const cells = row.find('td');
    const time = cells.eq(0).text().trim();
    if (/\d{2}\.\d{2}\.\d{2}/.test(time)) lastKickoff = time;
    const home = cells.eq(1).text().trim();
    const away = cells.eq(2).text().trim();
    const oddsCell = cells.last().html() || '';
    const idNum = (heim.attr('id') || heim.attr('name') || '').match(/(\d+)/);
    matches.push({
      matchId: idNum ? Number(idNum[1]) : matches.length,
      home, away, kickoff: lastKickoff,
      homeInputName: heim.attr('name') || '', awayInputName: gast.attr('name') || '',
      odds: parseOdds(oddsCell),
      locked: row.find('td.nichttippbar').length > 0,
      currentHome: heim.attr('value') ? Number(heim.attr('value')) : null,
      currentAway: gast.attr('value') ? Number(gast.attr('value')) : null,
    });
  });
  return { fields, matches };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: bet-form parser"`

---

## Task 12: Optimizer — de-margin + best scoreline

**Files:** Create `src/optimizer/probability.ts`, `src/optimizer/expectedPoints.ts`, `src/optimizer/strategy.ts`; Test `test/optimizer.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { deMargin } from '../src/optimizer/probability.js';
import { bestScoreline } from '../src/optimizer/expectedPoints.js';

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
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/optimizer/probability.ts`**

```typescript
import type { Odds, TendencyProbs } from '../domain/types.js';
export function deMargin(odds: Odds): TendencyProbs {
  const raw = { home: 1 / odds.home, draw: 1 / odds.draw, away: 1 / odds.away };
  const s = raw.home + raw.draw + raw.away;
  return { home: raw.home / s, draw: raw.draw / s, away: raw.away / s };
}
```

- [ ] **Step 4: Implement `src/optimizer/expectedPoints.ts`**

```typescript
import type { TendencyProbs, ScoringRules, Score } from '../domain/types.js';

// Heuristic P(exact scoreline) from tendency probs: distribute each tendency's probability
// over a small set of canonical scorelines for that tendency, weighted by typical frequency.
function scorelineProbabilities(probs: TendencyProbs, maxGoals: number): Map<string, number> {
  const m = new Map<string, number>();
  const add = (h: number, a: number, p: number) => { const k = `${h}:${a}`; m.set(k, (m.get(k) || 0) + p); };
  // canonical home wins, draws, away wins with descending weights
  const homeWins = [[1, 0], [2, 1], [2, 0], [3, 1]]; const draws = [[1, 1], [0, 0], [2, 2]]; const awayWins = [[0, 1], [1, 2], [0, 2], [1, 3]];
  const dist = (list: number[][], total: number) => { const w = list.map((_, i) => 1 / (i + 1)); const sw = w.reduce((a, b) => a + b, 0); list.forEach(([h, a], i) => { if (h <= maxGoals && a <= maxGoals) add(h, a, (total * w[i]) / sw); }); };
  dist(homeWins, probs.home); dist(draws, probs.draw); dist(awayWins, probs.away);
  return m;
}
const tendencyOf = (h: number, a: number) => (h > a ? 'home' : h < a ? 'away' : 'draw');
function points(tip: Score, actual: Score, rules: ScoringRules): number {
  if (tip.home === actual.home && tip.away === actual.away) return rules.exact;
  if (tendencyOf(tip.home, tip.away) === tendencyOf(actual.home, actual.away)) {
    if (tip.home - tip.away === actual.home - actual.away) return rules.goalDiff;
    return rules.tendency;
  }
  return 0;
}
export function bestScoreline(probs: TendencyProbs, rules: ScoringRules, maxGoals = 4): { score: Score; expectedPoints: number; rationale: string } {
  const sp = scorelineProbabilities(probs, maxGoals);
  let best: Score = { home: 1, away: 1 }; let bestEp = -1;
  for (let h = 0; h <= maxGoals; h++) for (let a = 0; a <= maxGoals; a++) {
    let ep = 0; for (const [k, p] of sp) { const [ah, aa] = k.split(':').map(Number); ep += p * points({ home: h, away: a }, { home: ah, away: aa }, rules); }
    if (ep > bestEp) { bestEp = ep; best = { home: h, away: a }; }
  }
  const lead = probs.home >= probs.draw && probs.home >= probs.away ? 'home' : probs.away >= probs.draw ? 'away' : 'draw';
  return { score: best, expectedPoints: Number(bestEp.toFixed(3)), rationale: `de-margined p(home/draw/away)=${probs.home.toFixed(2)}/${probs.draw.toFixed(2)}/${probs.away.toFixed(2)}; expected-points-max tip favours ${lead}` };
}
```

- [ ] **Step 5: Implement `src/optimizer/strategy.ts`**

```typescript
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
```

- [ ] **Step 6: Run → PASS.**
- [ ] **Step 7: Commit** — `git commit -am "feat: expected-points optimizer (de-margin + scoreline)"`

---

## Task 13: HTTP client

**Files:** Create `src/http/client.ts`; Test `test/http.test.ts`

- [ ] **Step 1: Failing test** (inject a fake `fetchFn`)

```typescript
import { describe, it, expect } from 'vitest';
import { Http } from '../src/http/client.js';
function fakeFetch(routes: Record<string, { status: number; location?: string; setCookie?: string[]; body?: string }>) {
  return async (url: string) => {
    const r = routes[url] || { status: 404, body: '' };
    const headers = new Headers(); (r.setCookie || []).forEach((c) => headers.append('set-cookie', c));
    if (r.location) headers.set('location', r.location);
    return { status: r.status, headers, text: async () => r.body || '' } as unknown as Response;
  };
}
describe('Http', () => {
  it('follows redirects and accumulates cookies', async () => {
    const http = new Http({ fetchFn: fakeFetch({
      'https://x/a': { status: 302, location: 'https://x/b', setCookie: ['login=tok; Path=/'] },
      'https://x/b': { status: 200, body: 'OK', setCookie: ['SESSION=s'] },
    }) });
    const res = await http.get('https://x/a');
    expect(res.finalUrl).toBe('https://x/b');
    expect(res.html).toBe('OK');
    expect(http.cookies()).toMatchObject({ login: 'tok', SESSION: 's' });
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/http/client.ts`**

```typescript
import type { HttpResponse } from '../domain/types.js';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export class Http {
  private jar = new Map<string, string>();
  private fetchFn: typeof fetch;
  constructor(opts: { cookies?: Record<string, string>; fetchFn?: typeof fetch } = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
    for (const [k, v] of Object.entries(opts.cookies ?? {})) this.jar.set(k, v);
  }
  cookies(): Record<string, string> { return Object.fromEntries(this.jar); }
  private ingest(res: Response) {
    const sc = typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : [];
    for (const c of sc as string[]) { const first = c.split(';')[0]; const i = first.indexOf('='); if (i < 0) continue; const n = first.slice(0, i).trim(); const v = first.slice(i + 1).trim(); if (!v || /deleted/i.test(v)) this.jar.delete(n); else this.jar.set(n, v); }
  }
  private header() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  private async go(method: string, url: string, body?: string, contentType?: string): Promise<HttpResponse> {
    let u = url, m = method, b = body, ct = contentType, hops = 0;
    while (true) {
      const headers: Record<string, string> = { 'User-Agent': UA, 'Accept-Language': 'de-DE,de;q=0.9' };
      const cookie = this.header(); if (cookie) headers['Cookie'] = cookie; if (b != null && ct) headers['Content-Type'] = ct;
      const res = await this.fetchFn(u, { method: m, headers, body: b, redirect: 'manual' });
      this.ingest(res);
      const loc = res.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(res.status) && loc && hops < 10) { u = new URL(loc, u).toString(); if (res.status === 302 || res.status === 303) { m = 'GET'; b = undefined; ct = undefined; } hops++; continue; }
      return { status: res.status, finalUrl: u, html: await res.text() };
    }
  }
  get(url: string) { return this.go('GET', url); }
  postForm(url: string, params: Record<string, string>) { return this.go('POST', url, new URLSearchParams(params).toString(), 'application/x-www-form-urlencoded'); }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: http client with cookie jar + redirects"`

---

## Task 14: Keychain + Session

**Files:** Create `src/auth/keychain.ts`, `src/auth/session.ts`; Test `test/session.test.ts`

- [ ] **Step 1: Failing test** (Session with injected Http + in-memory keychain)

```typescript
import { describe, it, expect } from 'vitest';
import { Session } from '../src/auth/session.js';
import { Http } from '../src/http/client.js';
const memKeychain = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v), del: async (k: string) => void m.delete(k) }; };
function fakeFetch(map: Record<string, { status: number; location?: string; setCookie?: string[]; body?: string }>) {
  return async (url: string, init?: any) => { const key = init?.method === 'POST' ? 'POST ' + url : url; const r = map[key] || map[url] || { status: 404, body: '' }; const h = new Headers(); (r.setCookie || []).forEach((c) => h.append('set-cookie', c)); if (r.location) h.set('location', r.location); return { status: r.status, headers: h, text: async () => r.body || '' } as any; };
}
describe('Session', () => {
  it('logs in, captures cookies, stores them', async () => {
    const kc = memKeychain();
    const fetchFn = fakeFetch({
      'https://www.kicktipp.de/info/profil/login': { status: 200, body: '<form action="/info/profil/loginaction"><input name="kennung"><input name="passwort"></form>' },
      'POST https://www.kicktipp.de/info/profil/loginaction': { status: 302, location: 'https://www.kicktipp.de/', setCookie: ['login=TOK', 'SESSION=S'] },
      'https://www.kicktipp.de/': { status: 200, body: '<a href="/logout">Abmelden</a>' },
    });
    const s = new Session({ email: 'e@x.de', password: 'pw', keychain: kc, makeHttp: (cookies) => new Http({ cookies, fetchFn }) });
    await s.login();
    expect((await s.http()).cookies().login).toBe('TOK');
    expect(await kc.get('kicktipp:e@x.de')).toContain('TOK');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/auth/keychain.ts`**

```typescript
import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
const exec = promisify(execFile);
export interface Keychain { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void>; }
export const macKeychain: Keychain = {
  async get(k) { try { const { stdout } = await exec('security', ['find-generic-password', '-s', k, '-w']); return stdout.trim() || null; } catch { return null; } },
  async set(k, v) { try { await exec('security', ['delete-generic-password', '-s', k]); } catch {} await exec('security', ['add-generic-password', '-s', k, '-a', k, '-w', v]); },
  async del(k) { try { await exec('security', ['delete-generic-password', '-s', k]); } catch {} },
};
```

- [ ] **Step 4: Implement `src/auth/session.ts`**

```typescript
import { Http } from '../http/client.js';
import { urls } from '../urls.js';
import { AuthError } from '../errors.js';
import type { Keychain } from './keychain.js';
import * as cheerio from 'cheerio';

interface SessionOpts { email: string; password: string; keychain: Keychain; base?: string; makeHttp?: (cookies: Record<string, string>) => Http; }
export class Session {
  private u; private _http: Http | null = null;
  constructor(private o: SessionOpts) { this.u = urls(o.base); }
  private key() { return `kicktipp:${this.o.email}`; }
  private make(cookies: Record<string, string>) { return this.o.makeHttp ? this.o.makeHttp(cookies) : new Http({ cookies }); }
  async login(): Promise<void> {
    const http = this.make({});
    const page = await http.get(this.u.loginPage());
    const action = (cheerio.load(page.html)('form:has(input[name="kennung"])').attr('action')) || '/info/profil/loginaction';
    const res = await http.postForm(new URL(action, this.u.loginPage()).toString(), { kennung: this.o.email, passwort: this.o.password, submitbutton: 'Anmelden' });
    if (!http.cookies().login) throw new AuthError('login failed: no login cookie set');
    this._http = http;
    await this.o.keychain.set(this.key(), JSON.stringify(http.cookies()));
    void res;
  }
  async http(): Promise<Http> {
    if (this._http) return this._http;
    const saved = await this.o.keychain.get(this.key());
    if (saved) { const http = this.make(JSON.parse(saved)); if (await this.isValid(http)) { this._http = http; return http; } }
    await this.login(); return this._http!;
  }
  private async isValid(http: Http): Promise<boolean> { const r = await http.get(this.u.base()); return !/\/login/.test(r.finalUrl) && !/name=["']?kennung/.test(r.html); }
}
```

- [ ] **Step 5: Run → PASS.**
- [ ] **Step 6: Commit** — `git commit -am "feat: keychain + session (login, persist, revalidate)"`

---

## Task 15: Config (profiles, multi-account)

**Files:** Create `src/config.ts`; Test `test/config.test.ts`

- [ ] **Step 1: Failing test** (inject a temp dir)

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { ConfigStore } from '../src/config.js';
describe('ConfigStore', () => {
  it('saves and lists profiles, tracks default community', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-'));
    const c = new ConfigStore(join(dir, 'config.json'));
    c.addProfile({ email: 'a@x.de', defaultCommunity: 'round1' });
    c.setActiveProfile('a@x.de');
    expect(c.activeProfile()?.defaultCommunity).toBe('round1');
    const c2 = new ConfigStore(join(dir, 'config.json'));
    expect(c2.profiles()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/config.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'; import { dirname, join } from 'node:path'; import { homedir } from 'node:os';
import type { Profile } from './domain/types.js';
interface Data { profiles: Profile[]; active?: string; }
export class ConfigStore {
  private path: string; private data: Data;
  constructor(path = join(homedir(), '.config', 'kicktipp-mcp', 'config.json')) {
    this.path = path; this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { profiles: [] };
  }
  private save() { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, JSON.stringify(this.data, null, 2)); }
  profiles() { return this.data.profiles; }
  addProfile(p: Profile) { this.data.profiles = this.data.profiles.filter((x) => x.email !== p.email).concat(p); if (!this.data.active) this.data.active = p.email; this.save(); }
  setActiveProfile(email: string) { this.data.active = email; this.save(); }
  activeProfile() { return this.data.profiles.find((p) => p.email === this.data.active) ?? null; }
  setDefaultCommunity(email: string, community: string) { const p = this.data.profiles.find((x) => x.email === email); if (p) { p.defaultCommunity = community; this.save(); } }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: config store with profiles"`

---

## Task 16: Core façade

**Files:** Create `src/core.ts`; Test `test/core.test.ts`

- [ ] **Step 1: Failing test** (inject a Session stub returning a fixture-backed Http stub)

```typescript
import { describe, it, expect } from 'vitest';
import { KickTippClient } from '../src/core.js';
import { fixture } from './helpers.js';
function stubSession(pages: Record<string, string>) {
  const http = { async get(url: string) { const key = Object.keys(pages).find((k) => url.includes(k)) || ''; return { status: 200, finalUrl: url, html: pages[key] || '' }; }, cookies: () => ({}) };
  return { http: async () => http } as any;
}
describe('KickTippClient', () => {
  it('getTipDistribution composes overview + match detail', async () => {
    const session = stubSession({ 'tippuebersicht?': fixture('tippuebersicht.html'), 'spiel?tippspielId=': fixture('distribution-populated.html') });
    const c = new KickTippClient(session, 'https://www.kicktipp.de');
    const d = await c.getTipDistribution({ community: 'x', spieltagIndex: 1 });
    expect(d.matches.length).toBeGreaterThan(0);
    expect(d.matches[0]).toHaveProperty('byTendency');
  });
  it('predictMatchday returns a prediction per match with odds', async () => {
    const html = `<form><table id="tippabgabeSpiele"><tr class="datarow"><td>02.10.26 20:30</td><td>A</td><td>B</td><td><input name="spieltippForms[0].heimTipp"><input name="spieltippForms[0].gastTipp"></td><td><span class="quote-heim"><span class="quote-text">1,50</span></span><span class="quote-remis"><span class="quote-text">4,0</span></span><span class="quote-gast"><span class="quote-text">6,0</span></span></td></tr></table></form>`;
    const c = new KickTippClient(stubSession({ 'tippabgabe': html, 'tabellen': '' }), 'https://www.kicktipp.de');
    const preds = await c.predictMatchday({ community: 'x' });
    expect(preds[0].score.home).toBeGreaterThanOrEqual(preds[0].score.away);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/core.ts`**

```typescript
import type { Session } from './auth/session.js';
import { urls } from './urls.js';
import { parseCommunities } from './scrape/communities.js';
import { parseMatchdayOverview } from './scrape/overview.js';
import { parseDistribution } from './scrape/distribution.js';
import { parseBetForm } from './scrape/betform.js';
import { parseStandings } from './scrape/standings.js';
import { parseSchedule } from './scrape/schedule.js';
import { parseRules } from './scrape/rules.js';
import { expectedStrategy } from './optimizer/strategy.js';
import type { Community, MatchdayDistribution, BetFormMatch, Standing, Fixture, ScoringRules, Prediction, Score } from './domain/types.js';

export class KickTippClient {
  private u; constructor(private session: Session, base = 'https://www.kicktipp.de') { this.u = urls(base); }
  private async getHtml(url: string) { return (await (await this.session.http()).get(url)).html; }

  async listCommunities(): Promise<Community[]> { return parseCommunities(await this.getHtml(this.u.meineTipprunden())); }
  async getStatus() { const cs = await this.listCommunities().catch(() => []); return { loggedIn: true, email: null, communities: cs }; }
  async getMatchday(o: { community: string; spieltagIndex?: number }): Promise<BetFormMatch[]> { return parseBetForm(await this.getHtml(this.u.tippabgabe(o.community, o.spieltagIndex))).matches; }
  async getSchedule(o: { community: string; spieltagIndex?: number }): Promise<Fixture[]> { return parseSchedule(await this.getHtml(this.u.tippspielplan(o.community, o.spieltagIndex))); }
  async getStandings(o: { community: string }): Promise<Standing[]> { return parseStandings(await this.getHtml(this.u.tabellen(o.community))); }
  async getRules(o: { community: string }): Promise<ScoringRules> { return parseRules(await this.getHtml(this.u.tabellen(o.community)).catch(() => '')); }

  async getTipDistribution(o: { community: string; spieltagIndex?: number }): Promise<MatchdayDistribution> {
    const overview = parseMatchdayOverview(await this.getHtml(this.u.tippuebersicht(o.community, o.spieltagIndex)));
    const matches = [] as MatchdayDistribution['matches'];
    let visibility: string | null = null;
    for (const m of overview.matches) {
      const d = parseDistribution(await this.getHtml(this.u.matchDetail(o.community, m.matchId)));
      visibility = visibility ?? d.visibility;
      matches.push({ matchId: m.matchId, home: m.home, away: m.away, byTendency: d.byTendency, byResult: d.byResult, dataAvailable: d.dataAvailable });
    }
    return { community: o.community, spieltagIndex: overview.spieltagIndex ?? o.spieltagIndex ?? null, visibility, matches };
  }

  async predictMatchday(o: { community: string; spieltagIndex?: number }): Promise<Prediction[]> {
    const matches = await this.getMatchday(o);
    const rules = await this.getRules(o).catch(() => ({ exact: 4, goalDiff: 3, tendency: 2 }));
    return matches.filter((m) => m.odds).map((m) => expectedStrategy({ matchId: m.matchId, home: m.home, away: m.away, odds: m.odds! }, rules));
  }

  async placeBets(o: { community: string; spieltagIndex?: number; bets: { matchId: number; home: number; away: number }[]; dryRun: boolean; override?: boolean }) {
    const form = parseBetForm(await this.getHtml(this.u.tippabgabe(o.community, o.spieltagIndex)));
    const diff = o.bets.map((b) => { const m = form.matches.find((x) => x.matchId === b.matchId); return { matchId: b.matchId, from: m && m.currentHome != null ? { home: m.currentHome, away: m.currentAway! } as Score : null, to: { home: b.home, away: b.away } }; });
    if (o.dryRun) return { submitted: false, diff };
    const params: Record<string, string> = { ...form.fields, submitbutton: 'submit' };
    for (const b of o.bets) { const m = form.matches.find((x) => x.matchId === b.matchId); if (!m || m.locked) continue; params[m.homeInputName] = String(b.home); params[m.awayInputName] = String(b.away); }
    await (await this.session.http()).postForm(this.u.tippabgabe(o.community, o.spieltagIndex), params);
    return { submitted: true, diff };
  }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: KickTippClient core façade"`

---

## Task 17: MCP server adapter

**Files:** Create `src/mcp/server.ts`, `src/bin/mcp.ts`; Test `test/mcp.test.ts` (smoke: tool list + one call against a stub core)

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/mcp/server.js';
describe('mcp server', () => {
  it('registers the expected tools', () => {
    const stubCore: any = { getTipDistribution: async () => ({ community: 'x', spieltagIndex: 1, visibility: null, matches: [] }), listCommunities: async () => [] };
    const { toolNames } = buildServer(stubCore);
    expect(toolNames).toContain('get_tip_distribution');
    expect(toolNames).toContain('predict_matchday');
    expect(toolNames).toContain('place_bets');
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/mcp/server.ts`** — register tools with zod schemas, returning structured content. `buildServer` returns `{ server, toolNames }` for testability.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KickTippClient } from '../core.js';

export function buildServer(core: KickTippClient) {
  const server = new McpServer({ name: 'kicktipp', version: '0.1.0' }, { instructions: 'Call get_status first. Always predict/preview with dry_run before place_bets.' });
  const toolNames: string[] = [];
  const tool = (name: string, desc: string, shape: z.ZodRawShape, handler: (args: any) => Promise<any>) => {
    toolNames.push(name);
    server.tool(name, desc, shape, async (args: any) => { const data = await handler(args); return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data }; });
  };
  const community = z.string().optional();
  tool('get_status', 'Account status + communities. Call first.', {}, () => core.getStatus());
  tool('list_communities', 'List your Tipprunden', {}, () => core.listCommunities());
  tool('get_matchday', 'Matches + odds + your current bets', { community: z.string(), spieltagIndex: z.number().optional() }, (a) => core.getMatchday(a));
  tool('get_schedule', 'Fixtures + results', { community: z.string(), spieltagIndex: z.number().optional() }, (a) => core.getSchedule(a));
  tool('get_standings', 'Football league table', { community: z.string() }, (a) => core.getStandings(a));
  tool('get_rules', 'Scoring rules', { community: z.string() }, (a) => core.getRules(a));
  tool('get_tip_distribution', 'Crowd tip distribution (Tippverteilung) per match', { community: z.string(), spieltagIndex: z.number().optional() }, (a) => core.getTipDistribution(a));
  tool('predict_matchday', 'Expected-points-optimal predictions from odds', { community: z.string(), spieltagIndex: z.number().optional() }, (a) => core.predictMatchday(a));
  tool('place_bets', 'Submit tips. DESTRUCTIVE. dry_run defaults true.', { community: z.string(), spieltagIndex: z.number().optional(), bets: z.array(z.object({ matchId: z.number(), home: z.number(), away: z.number() })), dry_run: z.boolean().default(true), override: z.boolean().default(false) }, (a) => core.placeBets({ community: a.community, spieltagIndex: a.spieltagIndex, bets: a.bets, dryRun: a.dry_run, override: a.override }));
  void community;
  return { server, toolNames };
}
```

- [ ] **Step 4: Implement `src/bin/mcp.ts`** (wires session/config → core → stdio transport)

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from '../mcp/server.js';
import { KickTippClient } from '../core.js';
import { Session } from '../auth/session.js';
import { macKeychain } from '../auth/keychain.js';
import { ConfigStore } from '../config.js';

const cfg = new ConfigStore();
const profile = cfg.activeProfile();
const email = process.env.KICKTIPP_EMAIL || profile?.email;
const password = process.env.KICKTIPP_PASSWORD || '';
if (!email) { console.error('No KickTipp profile. Run: ktipp login'); process.exit(1); }
const session = new Session({ email, password, keychain: macKeychain });
const { server } = buildServer(new KickTippClient(session));
await server.connect(new StdioServerTransport());
```

- [ ] **Step 5: Run → PASS;** then `npm run typecheck`.
- [ ] **Step 6: Commit** — `git commit -am "feat: MCP server adapter + stdio entry"`

---

## Task 18: CLI adapter

**Files:** Create `src/cli/render.ts`, `src/cli/index.ts`, `src/bin/ktipp.ts`; Test `test/render.test.ts`

- [ ] **Step 1: Failing test (`test/render.test.ts`)**

```typescript
import { describe, it, expect } from 'vitest';
import { renderDistribution } from '../src/cli/render.js';
describe('renderDistribution', () => {
  it('renders a readable line per match', () => {
    const out = renderDistribution({ community: 'x', spieltagIndex: 1, visibility: 'after deadline', matches: [{ matchId: 1, home: 'A', away: 'B', byTendency: { home: 4, draw: 0, away: 0 }, byResult: [{ score: '2:1', pct: 50 }], dataAvailable: true }] });
    expect(out).toMatch(/A.*B/);
    expect(out).toMatch(/2:1.*50/);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `src/cli/render.ts`**

```typescript
import type { MatchdayDistribution, Prediction, BetFormMatch } from '../domain/types.js';
export function renderDistribution(d: MatchdayDistribution): string {
  const lines = [`Tippverteilung — ${d.community} (Spieltag ${d.spieltagIndex ?? '?'}) [${d.visibility ?? 'n/a'}]`];
  for (const m of d.matches) {
    if (!m.dataAvailable) { lines.push(`  ${m.home} vs ${m.away}: (no data yet)`); continue; }
    const t = m.byTendency!; const top = m.byResult.slice(0, 3).map((r) => `${r.score} ${r.pct}%`).join('  ');
    lines.push(`  ${m.home} vs ${m.away}: 1/X/2 = ${t.home}/${t.draw}/${t.away}   top: ${top}`);
  }
  return lines.join('\n');
}
export function renderPredictions(ps: Prediction[]): string { return ps.map((p) => `${p.home} ${p.score.home}:${p.score.away} ${p.away}  (EP ${p.expectedPoints})`).join('\n'); }
export function renderMatchday(ms: BetFormMatch[]): string { return ms.map((m) => `[${m.matchId}] ${m.home} vs ${m.away}  odds ${m.odds ? `${m.odds.home}/${m.odds.draw}/${m.odds.away}` : '—'}  you: ${m.currentHome ?? '-'}:${m.currentAway ?? '-'}${m.locked ? ' (locked)' : ''}`).join('\n'); }
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Implement `src/cli/index.ts`** (commander program → core; `--json` global)

```typescript
import { Command } from 'commander';
import { KickTippClient } from '../core.js';
import { Session } from '../auth/session.js';
import { macKeychain } from '../auth/keychain.js';
import { ConfigStore } from '../config.js';
import { renderDistribution, renderPredictions, renderMatchday } from './render.js';
import * as readline from 'node:readline/promises';

export function buildProgram(deps?: { core?: KickTippClient; cfg?: ConfigStore }) {
  const program = new Command(); program.name('ktipp').option('--json', 'machine-readable output').option('-c, --community <slug>').option('-p, --profile <email>');
  const cfg = deps?.cfg ?? new ConfigStore();
  const getCore = () => { if (deps?.core) return deps.core; const p = program.opts().profile || cfg.activeProfile()?.email; const email = process.env.KICKTIPP_EMAIL || p; const password = process.env.KICKTIPP_PASSWORD || ''; if (!email) throw new Error('No profile. Run: ktipp login'); return new KickTippClient(new Session({ email, password, keychain: macKeychain })); };
  const community = () => program.opts().community || cfg.activeProfile()?.defaultCommunity;
  const out = (data: any, pretty: string) => console.log(program.opts().json ? JSON.stringify(data, null, 2) : pretty);

  program.command('login').action(async () => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); const email = await rl.question('Email: '); const password = await rl.question('Password: '); rl.close(); const s = new Session({ email, password, keychain: macKeychain }); await s.login(); cfg.addProfile({ email }); console.log('Logged in and saved.'); });
  program.command('communities').action(async () => { const c = await getCore().listCommunities(); out(c, c.map((x) => `${x.slug}  (${x.name})`).join('\n')); });
  program.command('use <slug>').action((slug) => { const p = cfg.activeProfile(); if (p) cfg.setDefaultCommunity(p.email, slug); console.log(`Default community = ${slug}`); });
  program.command('matchday').option('-d, --day <n>', 'spieltagIndex').action(async (o) => { const ms = await getCore().getMatchday({ community: community()!, spieltagIndex: o.day ? +o.day : undefined }); out(ms, renderMatchday(ms)); });
  program.command('distribution').option('-d, --day <n>').action(async (o) => { const d = await getCore().getTipDistribution({ community: community()!, spieltagIndex: o.day ? +o.day : undefined }); out(d, renderDistribution(d)); });
  program.command('predict').option('-d, --day <n>').action(async (o) => { const p = await getCore().predictMatchday({ community: community()!, spieltagIndex: o.day ? +o.day : undefined }); out(p, renderPredictions(p)); });
  program.command('standings').action(async () => { const s = await getCore().getStandings({ community: community()! }); out(s, s.map((r) => `${r.rank}. ${r.team}  ${r.points}pt`).join('\n')); });
  program.command('bet').option('-d, --day <n>').option('--yes', 'actually submit').requiredOption('--scores <pairs>', 'e.g. 101=2:1,102=0:0').action(async (o) => { const bets = o.scores.split(',').map((s: string) => { const [id, sc] = s.split('='); const [h, a] = sc.split(':'); return { matchId: +id, home: +h, away: +a }; }); const r = await getCore().placeBets({ community: community()!, spieltagIndex: o.day ? +o.day : undefined, bets, dryRun: !o.yes }); out(r, `${r.submitted ? 'SUBMITTED' : 'DRY-RUN'}:\n` + r.diff.map((d) => `  ${d.matchId}: ${d.from ? `${d.from.home}:${d.from.away}` : '-'} -> ${d.to.home}:${d.to.away}`).join('\n')); });
  return program;
}
```

- [ ] **Step 6: Implement `src/bin/ktipp.ts`**

```typescript
import { buildProgram } from '../cli/index.js';
buildProgram().parseAsync(process.argv).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
```

- [ ] **Step 7: Run tests + typecheck + build** — Run: `npm test && npm run typecheck && npm run build` — Expected: all pass; `dist/ktipp.js` + `dist/mcp.js` produced.
- [ ] **Step 8: Commit** — `git commit -am "feat: CLI adapter + entrypoints"`

---

## Task 19: Live verification against a member round (closes the write-path gap)

**Files:** Modify parsers only if live HTML differs from fixtures; add `test/fixtures/betform-live.html`, `test/fixtures/distribution-live-immediate.html`.

- [ ] **Step 1:** Ensure `.env` has a profile that is a member of ≥1 Tipprunde (private round with "tips immediately visible" recommended).
- [ ] **Step 2:** Run `npm run dev:cli -- communities` → confirm the round appears (validates `parseCommunities` on a real member account).
- [ ] **Step 3:** Run `npm run dev:cli -- matchday -c <slug>` → confirm matches, odds, and your current bets parse. If empty/wrong, save the live `tippabgabe` HTML to `test/fixtures/betform-live.html`, add a test, and fix `betform.ts`/`odds.ts` to match the real `name`s and odds classes.
- [ ] **Step 4:** Run `npm run dev:cli -- distribution -c <slug>` on an immediately-visible round → confirm pre-deadline spread populates; save fixture + test.
- [ ] **Step 5:** Run `npm run dev:cli -- predict -c <slug>` → sanity-check predictions.
- [ ] **Step 6:** Dry-run a bet: `npm run dev:cli -- bet -c <slug> --scores <id>=2:1` → verify the old→new diff. Only with explicit confirmation from the user, run with `--yes` on ONE match, then re-fetch to verify it stored; revert if needed.
- [ ] **Step 7: Commit** — `git commit -am "test: live-verified fixtures; fix parsers to match real markup"`

---

## Task 20: README + MCP install docs

**Files:** Create `README.md`

- [ ] **Step 1:** Document install (`npm i -g` / `npx`), `ktipp login`, the command list, the MCP server registration snippet for Claude Code (`claude mcp add kicktipp -- kicktipp-mcp` with `KICKTIPP_EMAIL`/keychain), the tool list, the distribution "API" usage, and the dry-run-first safety note.
- [ ] **Step 2: Commit** — `git commit -am "docs: README + MCP setup"`

---

## Self-Review

**Spec coverage:**
- Auth/session → Tasks 13–14. URL map → Task 4. ✓
- Read tools (communities, matchday, schedule, standings, rules) → Tasks 8–11, 16. ✓
- Tip-distribution API → Tasks 7, 16, 17, 18. ✓
- Heuristic expected-points optimizer → Task 12, 16. ✓
- Multi-community/account → Task 15 + CLI flags Task 18. ✓
- Write path dry-run-first → Task 16 (`placeBets`), 17/18 surfaces, 19 live-enable. ✓
- MCP outputSchema/structured content → Task 17 (`structuredContent`). Resources/prompts: deferred polish — **add to Task 17 if time allows** (spec §9 lists them; minimal v1 ships tools first). NOTE: resources/prompts are spec'd but not yet a task step — acceptable v1 trim, flagged here.
- Fixture-based tests → Tasks 2,7,9,10. ✓
- Typed errors / no process.exit in core → Task 5; core throws, only bins exit. ✓

**Placeholder scan:** No "TBD/TODO"; every code step has real code; commands have expected outcomes. ✓

**Type consistency:** `BetFormMatch.homeInputName/awayInputName`, `TipDistribution.byTendency`, `Prediction.score`, `KickTippClient` method names match across Tasks 3/11/12/16/17/18. `Session.http()` used consistently in Tasks 14/16. ✓

**Known v1 trims (intentional):** MCP resources + prompts (spec §9) and bonus-question betting are deferred; `predict_matchday` reads odds from the bet form (needs member access for some rounds) — documented in Task 19.
