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
import type {
  Community,
  MatchdayDistribution,
  BetFormMatch,
  Standing,
  Fixture,
  ScoringRules,
  Prediction,
  Score,
} from './domain/types.js';

export class KickTippClient {
  private u;
  constructor(private session: Session, base = 'https://www.kicktipp.de') {
    this.u = urls(base);
  }

  private async getHtml(url: string): Promise<string> {
    return (await (await this.session.http()).get(url)).html;
  }

  async listCommunities(): Promise<Community[]> {
    return parseCommunities(await this.getHtml(this.u.meineTipprunden()));
  }

  async getStatus(): Promise<{ loggedIn: boolean; email: string | null; communities: Community[] }> {
    const communities = await this.listCommunities().catch(() => [] as Community[]);
    return { loggedIn: true, email: null, communities };
  }

  async getMatchday(o: { community: string; spieltagIndex?: number }): Promise<BetFormMatch[]> {
    return parseBetForm(await this.getHtml(this.u.tippabgabe(o.community, o.spieltagIndex))).matches;
  }

  async getSchedule(o: { community: string; spieltagIndex?: number }): Promise<Fixture[]> {
    return parseSchedule(await this.getHtml(this.u.tippspielplan(o.community, o.spieltagIndex)));
  }

  async getStandings(o: { community: string }): Promise<Standing[]> {
    return parseStandings(await this.getHtml(this.u.tabellen(o.community)));
  }

  async getRules(o: { community: string }): Promise<ScoringRules> {
    return parseRules(await this.getHtml(this.u.tabellen(o.community)).catch(() => ''));
  }

  async getTipDistribution(o: { community: string; spieltagIndex?: number }): Promise<MatchdayDistribution> {
    const overview = parseMatchdayOverview(await this.getHtml(this.u.tippuebersicht(o.community, o.spieltagIndex)));
    const matches: MatchdayDistribution['matches'] = [];
    let visibility: string | null = null;
    for (const m of overview.matches) {
      const d = parseDistribution(await this.getHtml(this.u.matchDetail(o.community, m.matchId)));
      visibility = visibility ?? d.visibility;
      matches.push({
        matchId: m.matchId,
        home: m.home,
        away: m.away,
        byTendency: d.byTendency,
        byResult: d.byResult,
        dataAvailable: d.dataAvailable,
      });
    }
    return {
      community: o.community,
      spieltagIndex: overview.spieltagIndex ?? o.spieltagIndex ?? null,
      visibility,
      matches,
    };
  }

  async predictMatchday(o: { community: string; spieltagIndex?: number }): Promise<Prediction[]> {
    const matches = await this.getMatchday(o);
    const rules = await this.getRules(o).catch(() => ({ exact: 4, goalDiff: 3, tendency: 2 }) as ScoringRules);
    return matches
      .filter((m) => m.odds)
      .map((m) => expectedStrategy({ matchId: m.formIndex, home: m.home, away: m.away, odds: m.odds! }, rules));
  }

  async placeBets(o: {
    community: string;
    spieltagIndex?: number;
    bets: { matchId: number; home: number; away: number }[];
    dryRun: boolean;
    override?: boolean;
  }): Promise<{ submitted: boolean; diff: { matchId: number; from: Score | null; to: Score }[] }> {
    const form = parseBetForm(await this.getHtml(this.u.tippabgabe(o.community, o.spieltagIndex)));
    const diff = o.bets.map((b) => {
      const m = form.matches.find((x) => x.formIndex === b.matchId);
      return {
        matchId: b.matchId,
        from: m && m.currentHome != null ? ({ home: m.currentHome, away: m.currentAway! } as Score) : null,
        to: { home: b.home, away: b.away },
      };
    });
    if (o.dryRun) return { submitted: false, diff };
    const params: Record<string, string> = { ...form.fields, submitbutton: 'submit' };
    for (const b of o.bets) {
      const m = form.matches.find((x) => x.formIndex === b.matchId);
      if (!m || m.locked) continue;
      params[m.homeInputName] = String(b.home);
      params[m.awayInputName] = String(b.away);
    }
    await (await this.session.http()).postForm(this.u.tippabgabe(o.community, o.spieltagIndex), params);
    return { submitted: true, diff };
  }
}
