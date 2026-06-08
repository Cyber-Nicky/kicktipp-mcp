# KickTipp MCP Server + CLI — Design Spec

- **Date:** 2026-06-08
- **Status:** Approved design → ready for implementation plan
- **Workspace:** `~/Desktop/KickTippMCP`
- **Sources of truth:** `research/LIVE-FINDINGS.md` (live-verified), `research/SYNTHESIS.md` (offline analysis of 5 reference tools), `research/repos/` (clones)

## 1. Purpose
Build a superior KickTipp MCP server + CLI for Claude Code. KickTipp (kicktipp.de) is a German
football prediction game ("Tippspiel"). The product lets a user (and an AI agent) read their
rounds, view fixtures/odds/standings, see the **crowd tip-distribution**, get **expected-points
optimal predictions**, and submit tips — across **multiple communities and accounts**, all over a
fast **HTTP-direct** core (no browser).

We beat the only existing MCP/CLI competitor (`christianheidorn/kicktipp-agent`, TS/Playwright) on:
speed (no per-call Chromium), a real **prediction engine** (it scrapes odds then discards them),
typed structured MCP output, resources + prompts, robust scraping, and tests.

## 2. Goals / Non-Goals
**Goals (v1):**
- Auth + persistent session (Keychain), no per-call re-login.
- Read: communities, matchday (matches+odds+your bets), schedule, standings, leaderboard, rules.
- **Tip-distribution API** (Tippverteilung) — the user's priority feature; also usable standalone.
- **Heuristic expected-points optimizer** (de-margined odds → best scoreline under the round's rules).
- **Multi-community / multi-account** via config profiles.
- Write path (`place_bets`) built **dry-run-first**, verified against a live round before enabling.
- MCP server (stdio) + CLI, sharing one typed core. `--json` everywhere. Fixture-based parser tests.

**Non-goals (v1, YAGNI):** statistical goal model (Poisson/Dixon-Coles), notifications, bonus-question
betting, web UI, non-stdio MCP transports. Architected to allow them later; not built now.

## 3. Verified facts the design relies on (from live recon)
- **Login:** `GET /info/profil/login` (fields `kennung`, `passwort`, no CSRF) → `POST /info/profil/loginaction`
  (`application/x-www-form-urlencoded`) → `302 → /`. Sets cookies **`login`** (self-contained signed
  token `base64(email:expiryMs:SHA256:hmac)`, ~1yr) + **`SESSION`** + `kurzname`.
- **Per-round URLs** (slug is a top-level path): `/{c}/tippabgabe`, `/{c}/tippuebersicht`
  (+ `?spieltagIndex=N`), `/{c}/tippuebersicht/spiel?tippspielId=N`, `/{c}/tabellen`,
  `/{c}/tippspielplan`, `/{c}/gesamtuebersicht`. User's rounds: `/info/profil/meinetipprunden`.
- **Tip distribution** is embedded server-side in the match-detail page inside a Google-Charts
  `prepare()` function — parseable without a browser:
  `tippverteilungNachTendenz` rows `['Heim',n]['Remis',n]['Gast',n]` (counts);
  `tippverteilungNachErgebnis` rows `['2:1', pct, '<style>', 'pct,xx%']` (exact-score %).
  Gated by per-round **"Sichtbarkeit der Tipps"** (public = after-deadline; some private = immediate).
- **Bet form** (from reference tools, to be live-verified): score inputs id-suffix `_heimTipp`/`_gastTipp`
  (name pattern `spieltippForms[N].heimTipp`), table `#tippabgabeSpiele` rows `tr.datarow`,
  locked cells `td.nichttippbar`, submit `button[name="submitbutton"]`, kickoff format `%d.%m.%y %H:%M`.
- **Odds** DOM varies across eras — support all four families, map by `1/X/2` label where present,
  normalize German decimal comma → dot. (Live odds DOM to be confirmed on a member round.)

## 4. Tech stack
- **Language:** TypeScript (ESM, Node 22+).
- **Runtime deps:** `@modelcontextprotocol/sdk` (MCP), `commander` (CLI), `cheerio` (HTML parsing),
  `zod` (schemas → MCP `outputSchema` + validation). Native `fetch` (no HTTP dep).
- **Session storage:** macOS Keychain via the `security` CLI adapter; portable encrypted-file fallback
  (real key from OS keychain or a user passphrase — **not** the competitor's hostname-derived fake key).
- **Build/test:** `tsup` (two bins), `vitest`, `tsx`. Lint via `tsc --noEmit` + a formatter.
- **Bins:** `ktipp` (CLI), `kicktipp-mcp` (MCP stdio server). Package name `kicktipp-mcp`. *(Names easily changed.)*

## 5. Architecture & modules
One typed **core** façade; two thin adapters (MCP, CLI). Each module has a single purpose, a typed
interface, and is unit-testable in isolation.

```
src/
  http/client.ts      Http: cookie jar, manual redirect-follow, UA, timeout, polite retry/backoff, rate limiting
  auth/session.ts     Session: login(), ensureValid() (probe → re-login if stale), cookie capture
  auth/keychain.ts    Keychain: get/set/delete secret (security CLI; encrypted-file fallback)
  urls.ts             pure URL builders (base + slug + page + query)
  scrape/
    meinetipprunden.ts  parseCommunities(html) → Community[]
    tippuebersicht.ts   parseMatchdayOverview(html) → {spieltagIndex, matches:[{id, home, away, kickoff,...}]}
    tippabgabe.ts       parseBetForm(html) → {fields, matches:[{inputNames, odds, locked, kickoff}]}
    distribution.ts     parseDistribution(html) → TipDistribution
    tabellen.ts         parseStandings(html) → Standing[]
    tippspielplan.ts    parseSchedule(html) → Fixture[]
    rules.ts            parseRules(html) → ScoringRules
    odds.ts             parseOdds(cellHtml) → [home,draw,away] | null  (multi-strategy)
  domain/types.ts     Community, Match, Odds, Bet, TipDistribution, Standing, Fixture, ScoringRules,
                      Prediction + Zod schemas (single source for MCP outputSchema)
  optimizer/
    probability.ts    deMargin(odds) → {pHome,pDraw,pAway}  (normalize overround)
    expectedPoints.ts bestScoreline(probs, rules) → {score, expectedPoints, rationale}
    strategy.ts       Strategy type + 'expected' (default) impl; pluggable for future strategies
  core.ts             KickTippClient: getStatus, listCommunities, getMatchday, getSchedule,
                      getStandings, getLeaderboard, getRules, getTipDistribution, predictMatchday,
                      placeBets({dryRun}) — returns typed domain objects, throws typed errors
  config.ts           Profile{email, defaultCommunity}; load/save; multi-profile; defaults
  errors.ts           AuthError, NotMemberError, ParseError, DeadlinePassedError, ... (NO process.exit in core)
  mcp/server.ts       registers tools (+ outputSchema), resources, prompts → core
  cli/index.ts        Commander program → core; --json mode + pretty renderers
  cli/render.ts       table/box renderers for human output
test/
  fixtures/           real captured HTML (login, meinetipprunden, tippuebersicht, spiel, tabellen, ...)
  *.test.ts           parser + optimizer + url + session(mock) unit tests
```

**Data flow (read):** adapter → `core.getX()` → `session.ensureValid()` → `http.get(url)` →
`scrape.parseX(html)` → typed object → adapter renders (JSON or pretty / MCP structured content).

**Data flow (write):** adapter → `core.placeBets({community, matchday, bets, dryRun, confirm})` →
fetch bet form → match fixtures by fuzzy team name → fill inputs by discovered `name` → if `dryRun`
return old→new diff; else require `confirm` + deadline check → POST form → re-fetch to verify.

## 6. Auth & session (detail)
- `session.login(email, pw)`: GET login page, POST `kennung`/`passwort` to `/info/profil/loginaction`,
  capture `login`+`SESSION`. Store cookies in Keychain under `kicktipp:{email}`.
- `session.ensureValid()`: load cookies → GET base → if redirected to `/login` or `kennung` field
  present, re-login from stored creds (or prompt). Cache a warm `Http` with cookies for the process.
- Success/failure detection: authenticated marker (no `kennung` field + logout/account affordance);
  detect & surface CAPTCHA / rate-limit pages explicitly instead of silently failing.

## 7. Tip-distribution API (detail)
`core.getTipDistribution({community, matchday?})`:
1. GET `tippuebersicht?spieltagIndex=N` → `parseMatchdayOverview` → list of `{matchId, home, away}`.
2. For each match GET `…/tippuebersicht/spiel?tippspielId=ID` → `parseDistribution`:
   regex-isolate the `prepare()` body, split per chart `id`, extract `data.addRow([...])` with
   **quote-aware** column splitting, normalize `,`→`.` in percentages.
3. Return:
```jsonc
{
  "community": "…", "spieltagIndex": 1,
  "visibility": "Nach Ablauf der Tippzeit sichtbar",
  "matches": [{
    "matchId": 1199443860, "home": "…", "away": "…",
    "byTendency": { "home": 4, "draw": 0, "away": 0 },     // counts (may be null if no data)
    "byResult":   [ {"score":"2:1","pct":50.0}, … ],
    "dataAvailable": true
  }]
}
```
Exposed as MCP tool `get_tip_distribution`, CLI `ktipp distribution`, and an MCP **resource**
`kicktipp://{community}/distribution/{matchId}`.

## 8. Optimizer (heuristic, detail)
`core.predictMatchday({community, matchday?, strategy='expected'})`:
1. Read odds `[o1,oX,o2]` from the bet form (or match-detail) per match.
2. `deMargin`: `pᵢ = 1/oᵢ`; normalize by `Σp` to strip the bookmaker overround → `{pHome,pDraw,pAway}`.
3. `bestScoreline`: over a bounded scoreline grid (0–`maxGoals`), estimate `P(score)` from the
   outcome probabilities via a simple, documented goal-spread heuristic (favourite = lower odds;
   margin scales with probability gap), then compute **expected points** for each candidate tip as
   `Σ_outcomes P(outcome) · points(tip, outcome)` using the round's scraped `ScoringRules`
   (exact / goal-diff / tendency points), and pick the argmax. Deterministic; optional seed.
4. Return `[{match, prediction:{home,away}, probs, expectedPoints, rationale}]`. Separable from submit.
Edge cases: missing/unpublished odds → skip with reason; knockout draw-breaking flag.

## 9. MCP surface
Every tool returns **typed structured content** via `outputSchema` (Zod), not a JSON-string blob.
- **Read:** `get_status`, `list_communities`, `set_community`, `get_matchday`(`community?`,`matchday?`),
  `get_schedule`, `get_standings`, `get_leaderboard`(`matchday?`), `get_rules`,
  **`get_tip_distribution`**(`community?`,`matchday?`,`matchId?`), **`predict_matchday`**(`community?`,`matchday?`).
- **Write:** `place_bets`(`bets[]` or `from_prediction`, `community?`, `matchday?`, `dry_run=true`,
  `confirm_token?`, `override=false`) — DESTRUCTIVE label; dry-run default; deadline-checked.
- **Resources:** `kicktipp://{community}/matchday/{n}`, `kicktipp://{community}/distribution/{matchId}`,
  `kicktipp://{community}/standings`.
- **Prompts:** "Tip this matchday optimally" (reads matchday + predicts + previews before submit).
- Server `instructions` steer the agent to call `get_status` first and to dry-run before submitting.

## 10. CLI surface
`ktipp <command> [--community/-c] [--profile/-p] [--json]`. Commands mirror MCP:
`login`, `logout`, `whoami`, `communities`, `use <community>`, `matchday [-d N]`, `schedule`,
`standings`, `leaderboard`, `rules`, `distribution [-d N | --match ID]`, `predict [-d N]`,
`bet …` (`--dry-run` default; `--yes` to submit; shows old→new diff). Pretty tables by default,
`--json` for machine output. No interactive-only paths (automatable). No `process.exit` in core.

## 11. Write-path safety
Dry-run is the default for every write. Submitting requires explicit `--yes` (CLI) / `confirm_token`
(MCP). Always show an old→new diff. Refuse past-deadline matches unless `--override`. Re-fetch after
POST to verify the tip was stored. Respect a configurable per-match deadline window.

## 12. Config & multi-account
`config.ts` stores profiles (`~/.config/kicktipp-mcp/config.json`): each profile = an account
(email + Keychain ref) with a default community. `--profile` selects the account; `--community`/`use`
selects the round. Operations can target one or all communities of a profile.

## 13. Error handling
Typed errors thrown by core, mapped by adapters: `AuthError`, `NotMemberError` (tippabgabe shows
"Mitglied werden"), `DeadlinePassedError`, `ParseError` (with which selector failed — loud, never a
silent empty list), `RateLimitError`, `ConsentWallError` (→ suggests Playwright fallback). CLI maps to
exit codes; MCP maps to tool errors.

## 14. Testing strategy
- **Parser tests against real fixtures** (the HTML already captured in recon) — the thing no reference
  tool has. Each scraper has fixtures for populated + empty + edge states.
- **Optimizer unit tests:** known odds → expected de-margined probs and scoreline; rules variations.
- **Session tests:** mocked HTTP for login success/stale/relogin.
- **URL builder tests.** CI runs `tsc --noEmit` + `vitest`.

## 15. Open questions / verify-on-a-round
1. Live `tippabgabe` bet-form field **names** (for the POST) + current **odds DOM** classes.
2. Pre-deadline distribution in an "immediately-visible" round.
3. Bonus-question shape (deferred to post-v1).
These block only the *write* path and pre-deadline distribution; everything else is verified.
Plan: build read/distribution/optimizer now; verify + enable writes against a member round.
