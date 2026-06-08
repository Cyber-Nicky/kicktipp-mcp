# KickTipp — LIVE Recon Findings (ground truth)

> Confirmed against a real logged-in account on **2026-06-08** via `recon/probe.mjs` +
> `recon/probe_communities.mjs` (HTTP-direct, no browser). Complements the offline
> `SYNTHESIS.md`. Where this file and SYNTHESIS.md disagree, **this file wins** (it's live).

## 1. Auth — HTTP-direct works, NO CSRF ✅
- **Login page (GET):** `https://www.kicktipp.de/info/profil/login` — form has exactly two fields: `kennung` (type=email, id=kennung) and `passwort` (type=password, id=passwort). **No hidden/CSRF fields.**
- **Login POST target:** `https://www.kicktipp.de/info/profil/loginaction` (NOT `/login`). Body: `kennung`, `passwort` (+ `submitbutton` harmless). `application/x-www-form-urlencoded`.
- **Response:** `302 → https://www.kicktipp.de/` (redirect to home == success).
- **Cookies set:** `login`, `SESSION`, `kurzname`. (Competitor assumed `JSESSIONID`; the real session cookie is **`SESSION`**.)
- **`login` cookie = self-contained signed token.** base64 decodes to `:`-joined fields:
  `{urlencoded-email}:{expiry-epoch-ms}:SHA256:{hex-hmac}`. Expiry observed ≈ **1 year out** → long-lived. **This is our persistable session**: capture `login` (and `SESSION`), replay forever, re-login only when it stops working. Store in macOS Keychain.
- **Login-success check:** authed pages have no `name="kennung"` and a logout/abmelden affordance; logged-out → redirected to `/login` or the kennung field present.

## 2. URL map — live-confirmed (German `.de` slugs) ✅
Per-Tipprunde base is a top-level path slug: `https://www.kicktipp.de/{community}/...`

| Path | Purpose | Notes (confirmed) |
|---|---|---|
| `/info/profil/login` + `/info/profil/loginaction` | auth | see §1 |
| `/info/profil/meinetipprunden` | list *your* Tipprunden | empty for a member-less account (just country-switcher nav) |
| `/{community}/` | round home | `h1` = round name |
| `/{community}/tippabgabe` | **submit tips** (members) / "Mitglied werden" join page (non-members) | bet form is member-gated — see §5 gap |
| `/{community}/tippuebersicht` | tips overview per Spieltag | `h1` e.g. "Tippübersicht • 1. Spieltag • Einzelwertung"; lists match links w/ `tippspielId` |
| `/{community}/tippuebersicht/spiel?tippspielId=N` | **match detail incl. TIPPVERTEILUNG** | see §3 ⭐ |
| `/{community}/tabellen` | standings | `h1` "Tabelle" |
| `/{community}/tippspielplan` | schedule/results | `h1` "Spielplan" |
| `/{community}/gesamtuebersicht` | season grid | (exists) |

Query params seen live: `tippspielId` (a match), `spieltagIndex` (matchday), `tippsaisonId` (season).
404 rounds still render a styled "Startseite" shell (200-with-content vs hard 404 both happen).

## 3. ⭐ Tippverteilung ("spread of predictions") — the requested feature
**Endpoint:** `GET /{community}/tippuebersicht/spiel?tippspielId={id}`

Data is **embedded server-side in the HTML** inside a Google-Charts `prepare()` JS function — we
parse it with regex/DOM, **no JS execution / no browser / no Google Charts needed.** Three panels:

1. **`tippverteilungNachTendenz`** (PieChart) — counts by tendency:
   `addRow(['Heim', 4]); addRow(['Remis', 0]); addRow(['Gast', 0]);` → `{home, draw, away}` **absolute counts**.
2. **`tippverteilungNachErgebnis`** (BarChart) — spread by exact scoreline, value = **percent**, plus a formatted annotation:
   `addRow(['2:1', 50, '<style>', '50,00%']); addRow(['3:2', 25, …, '25,00%']); addRow(['10:9', 25, …, '25,00%']);`
   → `[{score:'2:1', pct:50.0}, …]`. (German decimal comma in the annotation → normalize `,`→`.`.)
3. **`tippsByTreffer`** ("Treffer") — post-match hit stats.

**Reverse-engineered JSON API (target shape):**
```json
{
  "tippspielId": 1199443860,
  "byTendency": { "home": 4, "draw": 0, "away": 0 },
  "byResult":   [ {"score":"2:1","pct":50.0}, {"score":"3:2","pct":25.0}, {"score":"10:9","pct":25.0} ],
  "visibility": "Nach Ablauf der Tippzeit sichtbar"
}
```

### ⚠ Visibility caveat (most important nuance)
The page shows `Sichtbarkeit der Tipps: <value>`. On **public** rounds the value is
**"Nach Ablauf der Tippzeit sichtbar"** → the distribution only populates **after the tip deadline**;
upcoming matches show *"Für diese Statistik liegen noch keine Daten vor."* (verified: only the past
`fussball-wm` final had data; all upcoming WM/BL/CL matches were empty).
**This is a per-round setting** — rounds set to "tips immediately visible" populate the spread
**pre-deadline**, which is the upcoming-match use case. → Our tool returns the spread whenever
KickTipp exposes it, and clearly reports the round's visibility mode + "no data yet" state.

## 4. Workflow to build the distribution API
`tippuebersicht?spieltagIndex=N` → scrape all `tippspielId`s for the matchday →
for each, GET `…/spiel?tippspielId=` → parse the 3 panels → return per-match + per-matchday JSON.

## 5. Remaining gaps (need a round MEMBERSHIP to close)
The recon account `<your-kicktipp-email>` is in **no** Tipprunde, so these are still from the
reference repos, not live-confirmed:
- **Live `tippabgabe` bet form**: exact score-input `name` attributes for the POST
  (repos: id `…_heimTipp`/`…_gastTipp`, name pattern `spieltippForms[N].heimTipp`), submit button,
  and any hidden fields. Member-gated.
- **Current odds (Wettquote) DOM** on the live tippabgabe (4 selector families across 2016→2026).
- **Pre-deadline distribution** in a round with "immediately visible" tips.
→ **Action:** user joins/creates one Tipprunde (a free private round is ideal: full control of the
  visibility setting + a safe place to test real tip submission). Then rerun recon to close §5.
