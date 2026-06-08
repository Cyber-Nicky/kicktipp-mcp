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
export interface Fixture { matchId: number; home: string; away: string; kickoff: string | null; homeGoals: number | null; awayGoals: number | null; }
export interface ScoringRules { exact: number; goalDiff: number; tendency: number; }
export interface Profile { email: string; defaultCommunity?: string; }
export interface Prediction {
  matchId: number; home: string; away: string;
  probs: TendencyProbs; score: Score; expectedPoints: number; rationale: string;
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
