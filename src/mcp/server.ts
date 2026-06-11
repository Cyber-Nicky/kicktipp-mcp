import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { KickTippClient } from '../core.js';

export function buildServer(core: KickTippClient) {
  const server = new McpServer(
    { name: 'kicktipp', version: '0.1.0' },
    { instructions: 'Call get_status first. Always predict/preview with dry_run before place_bets.' },
  );
  const toolNames: string[] = [];
  const tool = (
    name: string,
    desc: string,
    shape: z.ZodRawShape,
    handler: (args: any) => Promise<any>,
  ) => {
    toolNames.push(name);
    server.tool(name, desc, shape, async (args: any) => {
      try {
        const data = await handler(args);
        // MCP requires structuredContent to be an object; wrap bare arrays.
        // The text block serializes the same wrapped shape so both views agree.
        const structured = Array.isArray(data) ? { items: data } : data;
        return { content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: `${name} failed: ${message}` }],
        };
      }
    });
  };
  tool('get_status', 'Account status + communities. Call first.', {}, () => core.getStatus());
  tool('list_communities', 'List your Tipprunden', {}, () => core.listCommunities());
  tool('get_matchday', 'Matches + odds + your current bets', { community: z.string(), spieltagIndex: z.number().optional() }, (a) => core.getMatchday(a));
  tool('get_schedule', 'Fixtures + results', { community: z.string(), spieltagIndex: z.number().optional() }, (a) => core.getSchedule(a));
  tool('get_standings', 'Football league table', { community: z.string() }, (a) => core.getStandings(a));
  tool('get_rules', 'Scoring rules', { community: z.string() }, (a) => core.getRules(a));
  tool('get_tip_distribution', 'Crowd tip distribution (Tippverteilung) per match', { community: z.string(), spieltagIndex: z.number().optional() }, (a) => core.getTipDistribution(a));
  tool('predict_matchday', 'Expected-points-optimal predictions from odds', { community: z.string(), spieltagIndex: z.number().optional() }, (a) => core.predictMatchday(a));
  tool(
    'place_bets',
    'Submit tips. DESTRUCTIVE. dry_run defaults true. Diff rows carry status ok|locked|unknown — locked/unknown bets are never submitted. After a real submit each ok row gets verified:true/false from a read-back of the saved form; trust verified, not submitted.',
    {
      community: z.string(),
      spieltagIndex: z.number().optional(),
      bets: z.array(
        z.object({ matchId: z.number(), home: z.number(), away: z.number() }),
      ),
      dry_run: z.boolean().default(true),
    },
    (a) =>
      core.placeBets({
        community: a.community,
        spieltagIndex: a.spieltagIndex,
        bets: a.bets,
        dryRun: a.dry_run,
      }),
  );
  tool(
    'get_bonus_questions',
    'Bonus questions (Weltmeister, group winners, …) with options, deadlines, and your current answers',
    { community: z.string() },
    (a) => core.getBonusQuestions(a),
  );
  tool(
    'place_bonus_bets',
    'Submit bonus answers by question/answer text (case-insensitive exact match; get_bonus_questions lists valid texts). Multi-answer questions take answers in slot order. DESTRUCTIVE. dry_run defaults true. Diff rows carry status ok|locked|unknown; after a real submit each ok row gets verified:true/false from a read-back — trust verified, not submitted.',
    {
      community: z.string(),
      bets: z.array(z.object({ question: z.string(), answers: z.array(z.string()).min(1) })),
      dry_run: z.boolean().default(true),
    },
    (a) => core.placeBonusBets({ community: a.community, bets: a.bets, dryRun: a.dry_run }),
  );
  return { server, toolNames };
}
