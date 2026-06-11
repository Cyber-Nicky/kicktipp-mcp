import { z } from 'zod';

// ── Shared domain interfaces ─────────────────────────────────────────────────

export interface Community { slug: string; name: string; }
export type Tendency = 'home' | 'draw' | 'away';
export interface Odds { home: number; draw: number; away: number; }
export interface TendencyProbs { home: number; draw: number; away: number; }
export interface Score { home: number; away: number; }

export interface MatchOverview { matchId: number; home: string; away: string; kickoff: string | null; }
/**
 * Represents a single match row from the tippabgabe (bet-entry) form.
 *
 * NOTE: `formIndex` is the local sequential index extracted from the score
 * input's id/name attribute (e.g. `r1_heimTipp` → 1, `spieltippForms[0]…` → 0).
 * It is NOT the KickTipp `tippspielId` used by `MatchOverview` and `Fixture`.
 * Do NOT join `BetFormMatch.formIndex` with `MatchOverview.matchId` — they are
 * different identifier spaces and the pairing will silently be wrong.
 */
export interface BetFormMatch {
  /** Local form index from the score-input id/name — NOT the tippspielId. */
  formIndex: number;
  home: string;
  away: string;
  kickoff: string | null;
  homeInputName: string;
  awayInputName: string;
  odds: Odds | null;
  locked: boolean;
  currentHome: number | null;
  currentAway: number | null;
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
/** One participant row of the betting-pool leaderboard. `name` is the kicktipp display name verbatim. */
export interface LeaderboardEntry { rank: number; name: string; points: number; bonusPoints: number; }
export interface Leaderboard { community: string; spieltagIndex: number | null; items: LeaderboardEntry[]; }
export interface Fixture { matchId: number; home: string; away: string; kickoff: string | null; homeGoals: number | null; awayGoals: number | null; }
export interface ScoringRules { exact: number; goalDiff: number; tendency: number; }
export interface Profile { email: string; defaultCommunity?: string; }
export interface Prediction {
  matchId: number; home: string; away: string;
  probs: TendencyProbs; score: Score; expectedPoints: number; rationale: string;
}

/** Why a requested bet will or will not be applied on submission. */
export type BetDiffStatus = 'ok' | 'locked' | 'unknown';
export interface BetDiffEntry {
  matchId: number;
  from: Score | null;
  to: Score;
  status: BetDiffStatus;
  /** Read-back result after a real submit ('ok' rows only); absent on dry-run. */
  verified?: boolean;
}
export interface PlaceBetsResult {
  submitted: boolean;
  /** null on dry-run or when nothing was applicable; otherwise true iff every applied bet was read back from the saved form. */
  verified: boolean | null;
  diff: BetDiffEntry[];
}

// ── Bonus questions (tippabgabe?bonus=true) ──────────────────────────────────

export interface BonusOption { id: number; label: string; }
/**
 * One answer dropdown of a bonus question. Multi-answer questions
 * ("Wer erreicht das Halbfinale?") have several slots. Option IDs are
 * PER-QUESTION: identical across a question's slots, but the same team has
 * a DIFFERENT id in every other question — so an answer must always be
 * resolved against its own slot's option list, never globally.
 */
export interface BonusSlot {
  slotId: number;
  inputName: string;
  options: BonusOption[];
  currentId: number | null;
  currentLabel: string | null;
}
export interface BonusQuestion {
  questionId: number;
  text: string;
  deadline: string | null;
  locked: boolean;
  slots: BonusSlot[];
}
export interface BonusBetDiffEntry {
  question: string;
  /** Current answer labels for the affected slots; null when nothing stored. */
  from: string[] | null;
  to: string[];
  status: BetDiffStatus;
  /** Read-back result after a real submit ('ok' rows only); absent on dry-run. */
  verified?: boolean;
}
export interface PlaceBonusBetsResult {
  submitted: boolean;
  /** null on dry-run or when nothing was applicable; otherwise true iff every applied answer was read back from the saved form. */
  verified: boolean | null;
  diff: BonusBetDiffEntry[];
}

// ── HTTP contract ─────────────────────────────────────────────────────────────

export interface HttpResponse { status: number; finalUrl: string; html: string; }

// ── Zod schemas ───────────────────────────────────────────────────────────────

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
