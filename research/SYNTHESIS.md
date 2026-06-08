I'll synthesize these five analyses into the authoritative briefing. The analyses are already provided in full, so I have everything I need. Let me produce the deliverable directly.

# KickTipp Reverse-Engineering Briefing — Authoritative Synthesis

> **Purpose:** Single source of truth for building a *superior* KickTipp MCP server + CLI for Claude Code, distilled from 5 reverse-engineered open-source tools.
> **Date:** 2026-06-08. **Tools analyzed:** 5 (2× Python/RoboBrowser HTTP-direct, 1× Python/Selenium daemon, 1× Python/Playwright job, 1× TypeScript/Playwright MCP+CLI).

---

## 1. Landscape Table

| # | Repo | Lang | Approach | Maintenance | What it does | MCP / CLI? |
|---|------|------|----------|-------------|--------------|------------|
| 1 | **schwalle/kicktipp-betbot** | Python 3.8 | **HTTP-direct** (RoboBrowser = requests + BeautifulSoup + html5lib; no JS) | Abandoned, last commit 2021-09-17, dead `robobro 0.5.3` stack | Auto-bets a Bundesliga matchday from scraped 1X2 odds; pluggable predictors; multi-community; token reuse via `login` cookie | Single-file docopt CLI (`kicktippbb.py`), one implicit command + modal flags. **No MCP.** |
| 2 | **antonengelhardt/kicktipp-bot** | Python 3.10 | **Browser** (Selenium + headless Chromium) | **Actively maintained** upstream (v3.3.0, 2026-03-30; regular releases, dependabot, k8s/CI) | Long-lived daemon: logs in every cycle, scrapes odds, computes score, types & submits; notifications (Zapier/ntfy/webhook); /health + /status; Sentry | Daemon/script. Only `--debug`/`--headless` bare flags. **Neither MCP nor real CLI.** |
| 3 | **christianheidorn/kicktipp-agent** | TypeScript (ES2022, ESM) | **Browser** (Playwright headless Chromium + Cheerio parse) | **Single-commit** snapshot, 2026-03-07, no CI/releases — likely abandoned-after-launch | Read-heavy KickTipp client (today, bets, schedule, leaderboard, overview, table, rules, bonus) + place bets/bonus. **No odds prediction.** | **BOTH MCP (stdio) + CLI** from one core. 15 MCP tools, ~14 CLI commands. **THE COMPETITOR.** |
| 4 | **akrooss/KickTippTipper** | Python 2/3 | **HTTP-direct** (RoboBrowser + bs4, `html.parser`) | Abandoned, 1 commit, 2016-01-31, ~10 yrs stale, `http://` | 132-line script: interactive login, auto-discover 1 group slug, scrape odds, compute scores, submit via **mobile** `m.kicktipp.de` form | Bare script (`python tipper.py`), 2 stdin prompts. **Neither.** |
| 5 | **tbrodbeck/kicktipp-bot-serverless** | Python 3 | **Browser** (Playwright sync API, headless Chromium) | Single-commit, 2024-07-08, near-fork of #2; "serverless" is a misnomer | Run-once job: login, scrape standings+schedule to estimate avg goals, compute score per game (with knockout draw-breaking), submit; ntfy/Zapier | Single-shot script w/ fake `lambda_handler`. Flags `--headless/--local` **not parsed**. **Neither.** |

**Key takeaways from the landscape:**
- Only **#3 (kicktipp-agent)** is a real MCP+CLI — that is the bar to beat. It has the broadest *read* coverage but **zero prediction logic**.
- The actively maintained one (**#2**) has the most battle-tested *selectors* and operational polish, but is Selenium-heavy and re-logs-in every cycle.
- The two HTTP-direct tools (**#1, #4**) prove KickTipp's bet flow is **plain server-rendered HTML forms** — no JS required for the hot path. This is the single most important architectural fact.

---

## 2. The Competitor: `christianheidorn/kicktipp-agent`

This is the only true MCP+CLI competitor and the most directly comparable target.

### Architecture (TypeScript, ESM, Node16)
- **Two binaries from one codebase:** `kicktipp` (CLI → `dist/index.js`) and `kicktipp-mcp` (MCP server → `dist/server.js`).
- **Unified core** (`src/core.ts`) shared by both — single source of truth for scrape/bet logic, returns typed data. (This is their best idea; adopt it.)
- Modules: `browser.ts` (Playwright launch/login/session/consent/parseOdds), `config.ts` (ini config + AES-GCM password + session path), `url.ts` (URL builders), `commands/*.ts`.
- **MCP transport:** `StdioServerTransport` **only** (no HTTP/SSE). Server name `kicktipp` v1.0.0 with an `instructions` string steering the agent to call `get_status` first.
- **Every MCP tool returns `content:[{type:'text', text: JSON.stringify(data,null,2)}]`** — no structured content, no `outputSchema`, no resources, no prompts.

### Full MCP tool surface (15 tools)
| Tool | Params | Notes |
|------|--------|-------|
| `get_status` | — | "Call first." Returns creds_saved/community/player/setup_needed |
| `get_today_matches` | — | today's matches + bet status |
| `get_bets` | `matchday?` (1–34) | matches + current bets + odds |
| `get_schedule` | `matchday?` | schedule + results |
| `get_leaderboard` | `matchday?`, `bonus?` | rankings + results |
| `get_overview` | `view?` (5 enums) | season grid |
| `get_table` | `option?` (home/away) | real football standings |
| `get_rules` | — | scoring system |
| `get_communities` | — | user's communities |
| `get_players` | — | players in community |
| `get_bonus_questions` | — | bonus Qs + options |
| `set_community` | `name` | validates against fetched list |
| `set_player` | `name` | validates |
| `place_bets` | `bets[]` ("Home vs Away=H:G"), `matchday?`, `dry_run?` | DESTRUCTIVE, labeled |
| `place_bonus_bets` | `bets[]` ("Question=Answer"), `dry_run?` | DESTRUCTIVE |

**CLI commands:** `logout, communities, set-community, players, set-player, leaderboard, overview, schedule, table, bets, rules, bet, today, guide`. Note: CLI has **no** `get_status` equivalent and **no dry-run for `bet`**; MCP has no `guide` and no interactive prompts.

### Concrete weaknesses we will beat (from analysis #3)
1. **NO prediction logic at all.** It scrapes `span.quote-heim/remis/gast` odds and *displays* them but never computes a scoreline. Its Python ancestor (#1) had this; the rewrite dropped it. **This is the #1 functional gap — our biggest win.**
2. **Heavy/slow:** every operation spins up headless Chromium + full page nav (~2–5s each, admitted in their own `guide.ts`). No HTTP fast-path. Persistent in-process browser mitigates repeat calls but cold-start + memory remain large.
3. **Brittle positional selectors:** relies on first/only `tbody` under `#kicktipp-content` and fixed column **indices** (`cols[1]` home, `cols[2]` away, `cols[3]` bet, `cols[4]` odds; needs ≥10 cols). Layout change → silently returns `{matches:[]}` with no error.
4. **Consent only matches English** `button:has-text("Accept and continue")` — German `kicktipp.de` CMP users may get blocked.
5. **Fake password encryption:** AES-256-GCM key derived deterministically from `sha256('kicktipp-agent:'+hostname+':'+username)` → trivially decryptable by anyone with the file. Security theater.
6. **Hardcoded Bundesliga:** matchday clamped 1–34 everywhere (`RangeError` otherwise). Breaks for CL/cup/World Cup/2. Liga.
7. **MCP returns a JSON-string blob** in one text content — no structured content/output schema/resources/prompts. Token-heavy, not machine-typed.
8. **`fetchTable` grabs first table on page** (`content.find('table').first()`) — fragile.
9. **Exact (case-insensitive) team-name matching only** — agent must produce KickTipp's exact German names (`FC Bayern München`) verbatim or it throws. No fuzzy matching.
10. **`process.exit(1)` in shared code** on login failure — bad for a library/MCP.
11. **No real-HTML fixture tests** (only url + parse-bet-arg unit tests); no CI; single commit.
12. **CLI has no `--json` mode** (only ASCII tables) and CLI `bet` has no dry-run; CLI interactive bet needs stdin (unusable in automation).

---

## 3. Reverse-Engineered KickTipp Spec (Cross-Verified)

### 3.1 Authentication flow — **HIGH CONFIDENCE (all 5 tools agree)**

| Element | Value | Confidence / Source |
|---------|-------|---------------------|
| **Login URL** | `https://www.kicktipp.de/info/profil/login` (trailing `/` in #2, #5) | **Very high** — all 5. (#1, #4 used `http://`; **use HTTPS**.) |
| **Username field** | `kennung` (input name/id) | **Very high** — all 5 |
| **Password field** | `passwort` (input name/id) | **Very high** — all 5 |
| **Submit button** | `name="submitbutton"` (#1, #2, #3); German label "Anmelden" via role (#5) | **High** — name `submitbutton` confirmed by 3, label by 1 |
| **Auth cookie** | `login` (long-lived) | **High** — named explicitly by #1 (returns `browser.session.cookies['login']`), confirmed conceptually by #3 (`storageState` captures `login`+`JSESSIONID`). #2/#4/#5 never name it (browser-managed). |
| **Session cookie** | `JSESSIONID` | **Medium** — only #3 names it explicitly; #5 mentions it as "the real cookie" but code doesn't touch it |
| **CSRF token** | **NONE handled by any tool.** No tool reads/sends a CSRF token. HTTP-direct tools rely on RoboBrowser auto-resubmitting hidden form fields. | **High (absence)** — but **must verify live** whether a hidden token exists that the wrappers carried implicitly |

**Session reuse — the spectrum (lessons compounded):**
- **#1 (best HTTP model):** capture the `login` cookie value, replay it forever via `browser.session.cookies['login'] = token`. The right token model for headless/cron/MCP.
- **#3 (best browser model):** Playwright `storageState` → `~/.config/kicktipp-agent/session.json` (chmod 600); on launch, restore + probe validity by GET `URL_BASE` and check the URL didn't redirect to `/login`. Persistent in-process browser across MCP tool calls.
- **#2, #4, #5:** **no persistence** — re-login every run/cycle. Explicitly called out as the biggest waste.

**Login-success detection — all heuristics are fragile (verify a better one live):**
- #1: presence of a `<div content="Login">` ⇒ still logged out (fragile, i18n-breakable).
- #4: presence of `<input name="kennung">` ⇒ failed.
- #2/#5: `driver.current_url == BASE_URL` exact equality ⇒ false-negatives on redirects/locale.
- #3: URL still contains `/login` ⇒ failed.
- **Our approach:** check for an authenticated marker (logout link / account menu / profile element) AND explicitly detect CAPTCHA / rate-limit / 2FA pages.

### 3.2 URL Map — Cross-Verified

| URL pattern | Purpose | Query params | Confidence / Source |
|-------------|---------|--------------|---------------------|
| `…/info/profil/login` | Login | — | **Very high** (all 5) |
| `…/info/profil/meinetipprunden` | List user's communities (Tipprunden) | — | **High** (#1, #3) |
| `…/{community}/tippabgabe` | **Bet-entry page** (matches+odds+inputs; GET to read, POST to submit) | `spieltagIndex` (optional) | **Very high** (#1, #2, #3 as `/predict`*, #4, #5) |
| `…/{community}/tippabgabe?…&spieltagIndex=<n>` | Target a specific matchday | `spieltagIndex` | **High** (#1 has a test asserting `?&spieltagIndex=5`; #3, #5) |
| `…/{community}/tippabgabe?bonus=true` | Bonus questions (GET+POST) | `bonus=true` | **Medium** (#3 only, as `/predict?bonus=true`) |
| `…/{community}/tabellen` | **Actual football league standings** | `option=heim|gast` (#3); plain (#5) | **High** (#3, #5) |
| `…/{community}/tippspielplan` | Match schedule / results | `tippsaisonId`, `spieltagIndex` | **Medium** (#5 only — and it **hardcoded `tippsaisonId=2801716`**, a known rot-bug; discover dynamically) |
| `…/{community}/spielplan` *(alias)* | (#3 calls it `/schedule`) | `spieltagIndex` | **Medium** (#3 only, under a different slug) |
| `…/{community}/leaderboard` | Player rankings + matchday matches/results | `spieltagIndex`, `bonus` | **Medium** (#3 only) |
| `…/{community}/overview` | Season overview grid (players × matchdays) | `ansicht=spieltagspunkte\|platzierungen\|platzierungsdifferenz\|spieltagsplatzierungen\|punkteZurSpitze` | **Medium** (#3 only) |
| `…/{community}/rules` | Game rules + scoring system | — | **Medium** (#3 only) |
| `m.kicktipp.de/{group}/tippabgabe` | **Legacy mobile** bet form (simpler) | — | **Low** (#4 only, 2016; treat as dead/fallback) |

> **⚠ Slug-naming caveat:** #3 (the TS tool) targets `www.kicktipp.com` and uses English-ish path slugs (`predict`, `schedule`, `leaderboard`, `overview`, `tables`, `rules`). #5 and #1/#2 target `www.kicktipp.de` with German slugs (`tippabgabe`, `tippspielplan`, `tabellen`). **These may be the same pages under locale-routed slugs, or `.com` may serve localized paths. MUST confirm live which domain+slug set is canonical.** The brief's requested names (`tippuebersicht`, `gesamtuebersicht`) appear in **none** of the 5 tools — **unconfirmed, verify live.**

**Query-param vocabulary confirmed:** `spieltagIndex` (matchday, multiple tools), `bonus` (bool), `ansicht` (overview view), `option` (home/away table), `tippsaisonId` (season id — discover dynamically, never hardcode). The brief's `wertung` / `sortBy` appear in **no** tool — **unconfirmed.**

---

## 4. HTML Scraping Cheat-Sheet (Confirmed Selectors by Page)

> Keep all of these as **named constants**, anchored on stable ids/names, not positional indices. Where two tools disagree on odds container class, **support both + verify live**.

### Login page (`/info/profil/login`) — Very High Confidence
- `input[name="kennung"]` / `#kennung` — username (all 5)
- `input[name="passwort"]` / `#passwort` — password (all 5)
- Submit: `button[name="submitbutton"]` (#1, #2, #3) **or** button labeled "Anmelden" (#5)

### Bet-entry page (`/{community}/tippabgabe`) — High Confidence
- **Main wrapper:** `#kicktipp-content` (#1, #3, #4)
- **Games table:** `#tippabgabeSpiele` (#2, #5) — *use this id, not "first tbody"*
- **Rows:** `tr.datarow` = a game row; `tr.rowheader` = a date/time header supplying kickoff for following rows (#2). The **`hide` class on `td[1]`** means time is inherited from the header row (#2's time-state machine — confirmed real behavior).
- **Score inputs (the crown jewels):**
  - Home: `input[id$="_heimTipp"]` (#1, #3) / `input[name*="heimTipp"]` (#2)
  - Away: `input[id$="_gastTipp"]` (#1, #3) / `input[name*="gastTipp"]` (#2)
  - Real form field names follow `spieltippForms[N].heimTipp` / `.gastTipp` pattern (#5 note) — **discover & bind by name, don't use positional `//input[2]/[3]`** (#5's bug).
- **Locked/non-editable cell:** `td.nichttippbar` (#3) — skip already-locked games (better than #1's length-trimming).
- **Team / time cells** (positional, use as fallback only): `td[2]`=home, `td[3]`=away, `td[4]`=result (#2); `.col1`=home, `.col2`=away, `.kicktipp-time`=kickoff (#5).
- **Submit:** `button[name="submitbutton"]` (#1, #2, #3) / "Tipps speichern" (#5).
- **Kickoff datetime format:** `'%d.%m.%y %H:%M'` (two-digit year) — **#1, #2, #5 all agree.** #3 also handles US `M/D/YY h:mm AM/PM` for `.com`.

### Odds ("Wettquote") — **CONFLICTING, support all variants + verify**
| Source | Selector | Notes |
|--------|----------|-------|
| #4 (2016) | `td.kicktipp-wettquote` | text `home / draw / away` triples; **the brief's "kicktipp-wettquote" matches this** |
| #5 (2024) | `.wettquote-link` | inner_text `"Quote: 1.50 / 3.40 / 5.00"` or pipe-separated |
| #2 (2026, ad accounts) | `a.quote` containing `span.quote-label` ('1'/'X'/'2') + `span.quote-text` (decimal) | **map by label, not position** |
| #2 (2026, ad-free) | `span.quote` with child `span.quote-label` + `span.quote-text` | |
| #2 legacy fallback | `a.quote-link` text `"Quote: 1.5 / 3.2 / 5.0"` | |
| #3 (2026, `.com`) | `span.quote-heim span.quote-text` (home), `span.quote-remis span.quote-text` (draw), `span.quote-gast span.quote-text` (away) | most explicit per-outcome |
| #1 | row's "Quote" column text `home / draw / road`, split on `/`, strip spaces | positional |

> **Critical note (from #2's lessons):** the class `kicktipp-wettquote` (brief's hint) is **NOT used in #2** — it's #4's 2016 class. Modern markup uses `quote-heim/remis/gast` + `quote-text` (#3) or `a.quote/span.quote` + label/text (#2). **Build a multi-strategy odds parser covering all four families, mapped by the `1`/`X`/`2` label where available. Normalize German comma→dot (no tool does this — a gap).**

### Communities page (`/info/profil/meinetipprunden`) — Medium
- `#kicktipp-content a` links; a link is a community if `href` (slashes stripped) == link text, OR contains child `div.menu-title-mit-tippglocke` whose text == stripped href (#1, #3).

### Leaderboard / Rankings (`/leaderboard`) — Medium (#3 only)
- Table `#ranking`; cells: `td.position`, `td.spieltagspunkte`, `td.bonus`, `td.gesamtpunkte` (leaderboard total), `td.punkte` (overview total), `td.siege` (wins), `td.spieltagN` (per-matchday, N from class suffix). Player name `div.mg_name`.

### Schedule / Results — Medium
- Schedule table `#spiele` (#3) / `table#spielplanSpiele` embedded on leaderboard (#3).
- Result spans: `span.kicktipp-ergebnis` > `span.kicktipp-heim` / `span.kicktipp-gast` (#3); `.kicktipp-abpfiff` with child spans [0]=home, [2]=away, [3]='n.V.' marker (#5).

### Bonus questions (`/tippabgabe?bonus=true`) — Medium (#3 only)
- Entry table `#tippabgabeFragen`; `select` dropdowns (read `name`, `option[value]`/text; value `-1` = placeholder; `option[selected]` = current). Results table `table.ktable`.

### League table (`/tabellen`) — Medium
- `.drei_punkte_regel` tables; `.col2` = games played count, `.col4` = goals `home:away` (#5). (#3: `table` standings with played/points/GF/GA/GD/W/D/L.)

### Cookie-consent CMP — **VARIES, verify live**
- SourcePoint iframe `iframe[id*="sp_message_iframe"]` → `//button[contains(text(),"Akzeptieren")]` (#2, tipping page)
- SourcePoint `iframe[src*="privacy-mgmt"]` → `button:has-text("Accept and continue")` (#3, **English only — gap**)
- Quantcast `//*[@id="qc-cmp2-ui"]/div[2]/div/button[2]` (#2, defined but **unused**)
- Button labeled "ZUSTIMMEN" via role (#5)
> **Localize consent: match both German ("Akzeptieren"/"Zustimmen") and English, prefer selector over text.**

---

## 5. Odds → Prediction Strategies

Four of the five tools predict from bookmaker 1X2 odds (#3 is the exception — it discards the signal). All are heuristic; **none uses proper implied-probability/Poisson.** This is where we can decisively win.

| Tool | Inputs | Algorithm | Notes / Flaws |
|------|--------|-----------|---------------|
| **#1 SimplePredictor** | home & away odds (draw ignored) | `diff=|home−away|`; `<1.2` → 1:1; bucket by `DOMINATION_THRESHOLD=6`: `≥6`→3:1, `≥3`→2:1, else 1:0. Favorite = lower odds. | Clean, deterministic. Draw odds unused. |
| **#1 CalculationPredictor** | home & away odds | `MAX_GOALS=5, DOMINATION_THRESHOLD=9, DRAW_THRESHOLD=1.3, NONLINEARITY=0.5`. `diff<1.3`→1:1. `totalGoals=round(min(diff/9,1)*5)`. `ratio=((max/min)/(home+away))**0.5`. winner=round(total*ratio), looser=round(total*(1−ratio)); if winner≤looser winner+=1. | Continuous, deterministic. Favorite (lower odds) gets winner goals. Draw odds unused. |
| **#2 calculate_tip** | home=quotes[0], away=quotes[2] (**draw quotes[1] parsed but unused**) | `quote_diff=home−away`. `random_goal=randint(0,1)`. `coef=0.3 if |diff|>7 else 0.75`. `|diff|<0.25`→draw (rand,rand). Else favored side = `max(0,round(|diff|*coef))+random_goal`, other side = `random_goal`. | **Non-deterministic** (random jitter), magic constants, ignores draw odds. |
| **#4 calc_results** | home odds i[0], away odds i[2] | `diff=|i[0]−i[2]|`. `<1.0`→1:1; `>8.0`→great-win 3:1/1:3; else 2:1/1:2. | **BUGGY:** decides winner by comparing `i[0]` vs **draw** `i[1]` and **backs the underdog** (higher odds). Do not copy direction logic. |
| **#5 predict_with_win_loss_ratio** | home=odds[0], away=odds[2] (**draw unused in calc**) | `loss_ratio=home/(home+away)`; `loss_goals=expected_goals*loss_ratio`; `win_goals=expected_goals−loss_goals`; round each. `expected_goals` = **context-aware avg total goals** scraped from `/tabellen` + `/tippspielplan` (separate values for full-time, after-extra-time `n.V.`, after-penalties). `need_winner` breaks draws for knockouts (coin-flip at exactly 0.5). | Most sophisticated input (real expected-goals estimate, knockout handling). Var names mislabeled but math is sane. Draw odds still unused. |

**Synthesis for OUR predictor (the differentiator):**
1. **Convert ALL THREE odds to implied probabilities:** `p_i = 1/odds_i`, then **normalize by the overround** `Σp` to remove bookmaker margin. (No tool does this — every tool ignores the draw odds entirely.)
2. **Use a real model:** Poisson / Dixon-Coles from implied outcome probabilities, or a calibrated probability→scoreline mapping. Borrow #5's **context-aware expected-goals** (full-time vs n.V. vs penalties; discover dynamically, don't hardcode season).
3. **Make it deterministic + seedable** (kill #2's `random.randint` jitter; expose an optional seed).
4. **Offer multiple pluggable strategies** (keep #1's `PredictorBase` + auto-discovery design): `safe` / `expected` / `aggressive`, plus a "leave-as-is/manual" strategy, plus #5's knockout `need_winner` mode.
5. **Always pick the favorite correctly** (lower odds = favorite). Fix #4's inversion bug.
6. **Normalize German decimal commas → dots** and gracefully handle missing/unpublished odds (no tool does this).

---

## 6. Recommended Architecture for OUR Build

### 6.1 Transport: HTTP-direct first, browser as fallback
**Decision: HTTP-direct core (httpx/requests + lxml/BeautifulSoup), Playwright only as a fallback for login/CMP/JS-gated pages.**
- **Proof it works:** #1 and #4 perform the *entire* login + scrape + bet-submit flow over plain `requests`/RoboBrowser — KickTipp's `tippabgabe` is server-rendered HTML forms. (#1, #4)
- **Why beat the competitor here:** #3 and #2 do a full Chromium navigation per operation (~2–5s + 400–800 MiB). HTTP-direct is **10–50× faster, far lower memory** (#3's own lesson), and trivially runnable as an MCP tool/cron job.
- **Fallback path:** keep a headless browser (Playwright) for first-login if a JS/CMP consent wall blocks the HTTP flow, then **hand the cookies back to the HTTP client** and never touch the browser again that session.

### 6.2 Language: **TypeScript** (recommended) — with reasoning
The 4 reference *engines* are Python, but:
- **The MCP+CLI competitor is TypeScript**, and its unified-core / two-bin pattern (`@modelcontextprotocol/sdk`, Commander) is exactly the shape we want to beat on its own turf. The MCP TS SDK is first-class and battle-tested.
- TS gives us **typed Result objects + Zod schemas** for MCP `outputSchema` (structured content), which is precisely the gap #3 left open.
- An HTTP-direct TS core (fetch/undici + Cheerio, optional Playwright fallback) is light and ships as one npm package with two bins.
- **Caveat / alternative:** if the team is more fluent in Python, Python is fully viable (httpx + selectolax/lxml + the official Python MCP SDK) and lets us lift #1's predictor design and #5's expected-goals scraper almost verbatim. **Either is defensible; pick TS to directly out-engineer the competitor and get typed MCP output.**

### 6.3 Session caching
- Persist the **`login` cookie + `JSESSIONID`** (#1's token model + #3's storageState idea) to an **OS keychain** (macOS Keychain / libsecret / Windows Credential Manager) or an encrypted file — **NOT** #3's fake hostname-derived AES (call out plaintext honestly if no keychain).
- On each run: load cookies → probe validity (GET base, check for authenticated marker / not redirected to `/login`) → if stale, auto-relogin from stored creds. **Never re-login per call** (the #2/#4/#5 mistake).
- For the MCP server: keep one warm HTTP session across tool calls.

### 6.4 MCP tool + CLI surface (to beat #3)

**Read tools (match #3's coverage, add structured output + caching):**
`get_status`, `list_communities`, `set_community`, `list_players`, `set_player`, `get_today_matches`, `get_matchday` (matches + odds + current bets + predictions, params: `community`, `spieltagIndex`), `get_schedule`, `get_leaderboard`, `get_overview`, `get_table`, `get_rules`, `get_bonus_questions`.

**Write tools (idempotent, safe):**
`place_bets` (`bets[]` or auto-filled from a strategy, `matchday?`, `dry_run`, `override`, `confirm_token`), `place_bonus_bets` (`dry_run`, `confirm`).

**The differentiating tools (#3 has none of these):**
- `predict_matchday` — compute scorelines from odds via a chosen strategy (returns implied probs + score + rationale), **separable from submit** (true dry-run/preview).
- `list_strategies` / `set_strategy` — pluggable predictors (`safe/expected/aggressive/manual/knockout`).
- `auth_login` → returns/stores token; `whoami` → verify session.

**Every tool returns typed structured content (`outputSchema` + JSON), not a `JSON.stringify` text blob.** Expose **MCP resources** (`kicktipp://community/{name}/leaderboard`, `…/matchday/{n}`) and **prompts** for common flows — three things #3 entirely lacks.

**CLI:** mirror every MCP tool as a subcommand via the **same core**, add a real `--json` output mode (and pretty ASCII renderer on top), a real `--dry-run` for `bet` (which #3's CLI lacks), and structured error types — **no `process.exit` in shared code** (#3's bug).

### 6.5 "Cool function" ideas (all technically grounded in what we've confirmed scrapeable)
- **Auto-predict + preview diff:** show old→new bets side-by-side before submit, require an explicit confirm token (extends #3's `dry_run` + DESTRUCTIVE labeling).
- **Implied-probability + expected-points optimizer:** since we scrape the rules/scoring system (`/rules`, #3) and odds, **pick the scoreline that maximizes expected KickTipp points** under that community's exact scoring rules — not just "most likely score." No tool does this; it's directly feasible from data we already parse.
- **Multi-community + multi-account in one process** (beat #2's one-slug-per-container and #3's single scope).
- **Head-to-head / rival analytics:** read other players' tips where visible after deadline (leaderboard/overview already expose `#ranking`/player grids in #3) and aggregate season history — #3 only marks "your" row.
- **Deadline-aware betting:** only fill matches within a configurable window (#1's `--deadline`, #2's `KICKTIPP_HOURS_UNTIL_GAME`), timezone-correct via **Europe/Berlin zoneinfo** (#2's discipline — avoids "already started" bugs).
- **Fuzzy team-name matching** (strip `FC`/`04`/diacritics, aliases `Bayern`=`FC Bayern München`) so the agent needn't produce exact German strings (#3 throws on mismatch).
- **Notifications hook** (ntfy/Zapier/generic webhook) as a generic post-submit hook (copy #2/#5's idea, avoid per-game webhook spam inside the loop).
- **Saved-HTML fixture test suite** for every scraper (no reference tool has this) so KickTipp markup changes fail loudly in CI.

---

## 7. Open Questions / Risks — Must Confirm Against a Live Logged-In Account

These are things **no public tool revealed** or where tools **disagree**:

1. **CSRF / hidden token on the `tippabgabe` POST.** Every tool relied on a browser/RoboBrowser silently resubmitting hidden fields; **none explicitly read a token.** We must capture a live `tippabgabe` form, enumerate ALL hidden inputs (`spieltippForms[N].*`, any `_token`/`csrf`/game-id fields), and confirm whether an explicit token must be echoed for an HTTP-direct POST. **(Biggest correctness risk.)**
2. **Domain & slug canonicalization:** `.de` German slugs (`tippabgabe/tippspielplan/tabellen`) vs `.com` English-ish slugs (`predict/schedule/leaderboard/overview/tables/rules`). Are these the same pages locale-routed, or distinct? Which is canonical for our users? (#3 vs #1/#2/#5 disagree.)
3. **Unconfirmed URLs from the brief:** `tippuebersicht`, `gesamtuebersicht`, and query params `wertung`, `sortBy` appear in **zero** tools. Confirm they exist and their params.
4. **Current odds DOM:** four different selector families across 2016→2026 (`td.kicktipp-wettquote` vs `.wettquote-link` vs `a.quote/span.quote` vs `span.quote-heim/remis/gast`). **Capture a live `tippabgabe` page to determine the current class(es) and whether ad vs ad-free accounts differ** (#2 says they do). Confirm decimal separator (comma vs dot).
5. **Bonus-question POST shape:** only #3 documents `#tippabgabeFragen` + `select`/`option`. Confirm field names and the `bonus=true` param live.
6. **Exact field-name pattern for score inputs:** confirm whether they're `spieltippForms[N].heimTipp/.gastTipp` (#5's claim) vs id-suffix `_heimTipp/_gastTipp` (#1/#3) — and whether the `name` attribute (needed for HTTP POST) differs from the `id`.
7. **Login-success / failure signals:** every tool's detection is a fragile heuristic. Confirm a reliable authenticated marker (logout link / account menu) and capture what CAPTCHA / rate-limit / 2FA pages look like (no tool handles these).
8. **Cookie-consent wall on the HTTP path:** does an un-consented HTTP session get blocked or served the form anyway? Determine whether we ever truly need the Playwright fallback, and the current CMP (SourcePoint vs Quantcast) + button label (DE vs EN).
9. **Dynamic matchday/season discovery:** confirm how to read available `spieltagIndex` options and the current `tippsaisonId` from the page nav (so we never hardcode 1–34 or `2801716` — the rot-bugs in #3 and #5).
10. **Cookie lifetime & expiry behavior:** how long the `login` cookie lasts and how a stale cookie manifests (so session-refresh logic is correct).

---

**Bottom line for the build:** Go **HTTP-direct** (Playwright fallback only), **TypeScript** with a **unified typed core** powering both an MCP server (with `outputSchema`, resources, prompts) and a `--json`-capable CLI. **Persist the `login`+`JSESSIONID` cookies in the OS keychain** and reuse them. **Reimplement the prediction layer properly** (normalized implied probabilities + expected-KickTipp-points optimizer + pluggable strategies) — that single feature beats the competitor outright, since `kicktipp-agent` scrapes the odds and throws the signal away. Before coding the POST paths, **resolve the CSRF/hidden-field and domain/slug questions live** (items 1–2 above), as they are the highest correctness risks.