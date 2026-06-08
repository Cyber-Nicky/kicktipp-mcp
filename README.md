# kicktipp-mcp

A TypeScript MCP server and CLI for [KickTipp](https://www.kicktipp.de) — the German football prediction game. Reads rounds, fixtures, odds, standings, and the crowd tip-distribution; computes expected-points-optimal predictions; and (dry-run-first) submits tips — across multiple communities and accounts, over a fast HTTP-direct core (no browser required).

## Requirements

- Node.js 22+
- macOS (Keychain used for credential storage; falls back to an encrypted file on other platforms)

## Install

```bash
npm install -g kicktipp-mcp
```

Or launch the MCP server directly without a global install (useful for Claude Code integration without adding `kicktipp-mcp` to your PATH):

```bash
npx kicktipp-mcp
```

> **Note:** `npx kicktipp-mcp` starts the MCP stdio server, not the `ktipp` CLI. For the `ktipp` CLI commands, use `npm install -g kicktipp-mcp`.

## Quick start

### 1. Log in

```bash
ktipp login
```

You will be prompted for your KickTipp email and password. Credentials are stored securely in the macOS Keychain under the key `kicktipp:<email>`.

### 2. Set a default community

```bash
ktipp communities          # list your Tipprunden
ktipp use <slug>           # set a default community (e.g. "bundesliga-tippspiel")
```

### 3. Read matchday data

```bash
ktipp matchday                     # current matchday: matches, odds, your bets
ktipp matchday -d 5                # specific spieltagIndex
ktipp distribution                 # crowd tip distribution (Tippverteilung)
ktipp predict                      # expected-points-optimal predictions
ktipp standings                    # football league table
```

### 4. Submit tips (dry-run by default)

```bash
# Preview the diff first (no changes made):
ktipp bet --scores "101=2:1,102=0:0"

# Actually submit once you are satisfied:
ktipp bet --scores "101=2:1,102=0:0" --yes
```

## CLI command reference

All commands accept `--json` for machine-readable output, `-c <slug>` to override the community, and `-p <email>` to select a different profile.

| Command | Description |
|---|---|
| `login` | Prompt for credentials and save to Keychain |
| `communities` | List all your Tipprunden |
| `use <slug>` | Set the default community for the active profile |
| `matchday [-d N]` | Matches, odds, and your current bets for spieltagIndex N (default: current) |
| `distribution [-d N]` | Crowd tip distribution (Tippverteilung) per match |
| `predict [-d N]` | Expected-points-optimal predictions derived from published odds |
| `standings` | Football league table for the community |
| `bet --scores <pairs> [--yes] [-d N]` | Preview (default) or submit tips. Format: `<matchId>=<home>:<away>,...` |

## MCP server — Claude Code setup

Register the MCP server with Claude Code once (requires a saved session from `ktipp login`):

```bash
claude mcp add kicktipp -- kicktipp-mcp
```

If you prefer to pass credentials via environment variables instead of the Keychain:

```bash
claude mcp add kicktipp \
  -e KICKTIPP_EMAIL=you@example.com \
  -e KICKTIPP_PASSWORD=secret \
  -- kicktipp-mcp
```

### Verifying the registration

```bash
claude mcp list
```

The server name `kicktipp` should appear in the list with a `connected` status.

## MCP tool reference

The server exposes the following tools. Claude Code will call `get_status` first automatically (the server `instructions` steer it to do so).

| Tool | Parameters | Description |
|---|---|---|
| `get_status` | — | Account status and list of communities. Call first. |
| `list_communities` | — | List all your Tipprunden |
| `get_matchday` | `community`, `spieltagIndex?` | Matches, odds, and your current bets |
| `get_schedule` | `community`, `spieltagIndex?` | Fixtures and results |
| `get_standings` | `community` | Football league table |
| `get_rules` | `community` | Scoring rules (exact/goal-diff/tendency points) |
| `get_tip_distribution` | `community`, `spieltagIndex?` | Crowd tip distribution (Tippverteilung) per match |
| `predict_matchday` | `community`, `spieltagIndex?` | Expected-points-optimal predictions from odds |
| `place_bets` | `community`, `bets[]`, `dry_run?`, `spieltagIndex?`, `override?` | Submit tips. DESTRUCTIVE. `dry_run` defaults to `true`. |

### Example: tip distribution API

`get_tip_distribution` returns the crowd spread for each match on the matchday:

```json
{
  "community": "bundesliga-tippspiel",
  "spieltagIndex": 12,
  "visibility": "Nach Ablauf der Tippzeit sichtbar",
  "matches": [
    {
      "matchId": 1503034391,
      "home": "Bayern Munich",
      "away": "Borussia Dortmund",
      "byTendency": { "home": 42, "draw": 18, "away": 12 },
      "byResult": [
        { "score": "2:1", "pct": 22.5 },
        { "score": "2:0", "pct": 18.3 }
      ],
      "dataAvailable": true
    }
  ]
}
```

Visibility is controlled per round ("Sichtbarkeit der Tipps"). Public rounds show data after the betting deadline; private rounds with "immediately visible" setting show data at any time.

## Prediction engine

`ktipp predict` (CLI) and `predict_matchday` (MCP) use a deterministic heuristic:

1. Read published odds (`home / draw / away`) from the bet form.
2. **De-margin:** `p_i = 1/o_i`, then normalize by `sum(p)` to strip the bookmaker overround.
3. **Best scoreline:** for each tendency (home/draw/away), distribute that tendency's probability across a small fixed list of canonical scorelines (e.g. `[1:0, 2:1, 2:0, 3:1]` for home wins) weighted by `1/(i+1)`. Then scan a bounded grid (0–4 goals each side), compute **expected points** for each candidate tip as `sum_outcomes P(outcome) * points(tip, outcome)` using the round's scraped scoring rules (exact / goal-diff / tendency), and pick the argmax.
4. Return a prediction with the optimal scoreline, expected points, and a rationale string.

Matches without published odds are skipped with a reason.

## Safety — dry-run first

`place_bets` (CLI: `ktipp bet`) defaults to **dry-run mode**. In dry-run mode:

- No HTTP write is performed.
- A diff is returned showing the old tip (if any) and the proposed new tip for each match.
- Locked matches (past the betting deadline) are shown as locked and skipped on real submission.

To actually submit you must pass `--yes` (CLI) or `"dry_run": false` (MCP). Always review the diff before submitting. The server instructions remind Claude Code to dry-run first.

## Multi-account / multi-community

`ktipp` supports multiple KickTipp accounts via profiles stored in `~/.config/kicktipp-mcp/config.json`. Each profile has an email and an optional default community. Use `-p <email>` to select a different account for a single command, or manage profiles directly in the config file.

## Architecture

```
HTTP-direct (Node 22 native fetch + cheerio, no browser)
Pure parsers/optimizer (no I/O) -> Http client -> Session (cookie persistence)
-> KickTippClient core facade -> MCP adapter / CLI adapter
```

Session cookies are stored in the macOS Keychain under `kicktipp:<email>` and reused across calls. If a stored session is stale the library re-logins automatically.

## Development

```bash
npm install
npm test              # vitest (all parser + optimizer + integration tests)
npm run typecheck     # tsc --noEmit
npm run build         # tsup -> dist/ktipp.js + dist/mcp.js
npm run dev:cli       # run CLI without building
npm run dev:mcp       # run MCP server without building
```

## License

MIT — see [LICENSE](LICENSE).

