import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/mcp/server.js';
import { AccountRegistry } from '../src/mcp/accounts.js';

/** Reach into the SDK's registered-tool map to invoke a handler directly. */
function getToolHandler(server: any, name: string): (args: any, extra: any) => Promise<any> {
  const registered = server._registeredTools?.[name];
  if (!registered) throw new Error(`tool ${name} not registered`);
  return registered.handler ?? registered.callback;
}

describe('mcp server', () => {
  it('registers the expected tools', () => {
    const stubCore: any = {
      getTipDistribution: async () => ({ community: 'x', spieltagIndex: 1, visibility: null, matches: [] }),
      listCommunities: async () => [],
    };
    const { toolNames } = buildServer(stubCore);
    expect(toolNames).toContain('get_tip_distribution');
    expect(toolNames).toContain('predict_matchday');
    expect(toolNames).toContain('place_bets');
  });

  it('routes a tool call to the matching core method and returns structured content', async () => {
    const distribution = { community: 'x', spieltagIndex: 1, visibility: null, matches: [] };
    let received: any;
    const stubCore: any = {
      getTipDistribution: async (o: any) => {
        received = o;
        return distribution;
      },
      listCommunities: async () => [],
    };
    const { server } = buildServer(stubCore);
    const handler = getToolHandler(server, 'get_tip_distribution');
    const result = await handler({ community: 'x', spieltagIndex: 1 }, {});
    expect(received).toEqual({ community: 'x', spieltagIndex: 1 });
    expect(result.structuredContent).toEqual(distribution);
    expect(result.content[0].text).toBe(JSON.stringify(distribution, null, 2));
  });

  it('registers get_leaderboard and routes it to the core method', async () => {
    const leaderboard = { community: 'x', spieltagIndex: null, items: [{ rank: 1, name: 'A', points: 4, bonusPoints: 0 }] };
    let received: any;
    const stubCore: any = { getLeaderboard: async (o: any) => { received = o; return leaderboard; } };
    const { server, toolNames } = buildServer(stubCore);
    expect(toolNames).toContain('get_leaderboard');
    const result = await getToolHandler(server, 'get_leaderboard')({ community: 'x' }, {});
    expect(received).toMatchObject({ community: 'x' });
    expect(result.structuredContent).toEqual(leaderboard);
  });

  it('wraps array results in an object for structuredContent (MCP spec requires a record)', async () => {
    const communities = [{ slug: 'a', name: 'A' }];
    const stubCore: any = { listCommunities: async () => communities };
    const { server } = buildServer(stubCore);
    const handler = getToolHandler(server, 'list_communities');
    const result = await handler({}, {});
    expect(Array.isArray(result.structuredContent)).toBe(false);
    expect(result.structuredContent).toEqual({ items: communities });
    // text block must serialize the SAME shape clients see in structuredContent
    expect(result.content[0].text).toBe(JSON.stringify({ items: communities }, null, 2));
  });

  it('registers bonus tools and wraps the question list in an object', async () => {
    const questions = [{ questionId: 1, text: 'Wer wird Weltmeister?', deadline: null, locked: false, slots: [] }];
    const stubCore: any = { getBonusQuestions: async () => questions };
    const { server, toolNames } = buildServer(stubCore);
    expect(toolNames).toContain('get_bonus_questions');
    expect(toolNames).toContain('place_bonus_bets');
    const result = await getToolHandler(server, 'get_bonus_questions')({ community: 'x' }, {});
    expect(result.structuredContent).toEqual({ items: questions }); // MCP: no bare arrays
  });

  it('place_bonus_bets maps dry_run to dryRun', async () => {
    let received: any;
    const out = { submitted: false, verified: null, diff: [] };
    const stubCore: any = { placeBonusBets: async (o: any) => { received = o; return out; } };
    const { server } = buildServer(stubCore);
    const result = await getToolHandler(server, 'place_bonus_bets')(
      { community: 'x', bets: [{ question: 'Q?', answers: ['A'] }], dry_run: true }, {},
    );
    expect(received).toEqual({ community: 'x', bets: [{ question: 'Q?', answers: ['A'] }], dryRun: true });
    expect(result.structuredContent).toEqual(out);
  });

  it('routes the account param to the matching registry client', async () => {
    const coreA: any = { listCommunities: async () => [{ slug: 'a', name: 'A' }] };
    const coreB: any = { listCommunities: async () => [{ slug: 'b', name: 'B' }] };
    const reg = new AccountRegistry({
      emails: ['a@x.de', 'b@y.de'],
      defaultEmail: 'a@x.de',
      makeClient: (e) => (e === 'a@x.de' ? coreA : coreB),
    });
    const { server } = buildServer(reg);
    const handler = getToolHandler(server, 'list_communities');
    const def = await handler({}, {});
    expect(def.structuredContent).toEqual({ items: [{ slug: 'a', name: 'A' }] });   // default account
    const other = await handler({ account: 'B@Y.de' }, {});
    expect(other.structuredContent).toEqual({ items: [{ slug: 'b', name: 'B' }] }); // case-insensitive switch
  });

  it('returns isError listing accounts for an unknown account', async () => {
    const reg = new AccountRegistry({ emails: ['a@x.de'], defaultEmail: 'a@x.de', makeClient: () => ({}) as any });
    const { server } = buildServer(reg);
    const result = await getToolHandler(server, 'list_communities')({ account: 'ghost@x.de' }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('a@x.de');
  });

  it('list_accounts reports emails with isDefault', async () => {
    const reg = new AccountRegistry({
      emails: ['a@x.de', 'b@y.de'],
      defaultEmail: 'b@y.de',
      makeClient: () => ({}) as any,
    });
    const { server, toolNames } = buildServer(reg);
    expect(toolNames).toContain('list_accounts');
    const result = await getToolHandler(server, 'list_accounts')({}, {});
    expect(result.structuredContent).toEqual({
      accounts: [
        { email: 'a@x.de', isDefault: false },
        { email: 'b@y.de', isDefault: true },
      ],
    });
  });

  it('returns a structured error response when a core method throws', async () => {
    const stubCore: any = {
      getTipDistribution: async () => {
        throw new Error('boom');
      },
      listCommunities: async () => [],
    };
    const { server } = buildServer(stubCore);
    const handler = getToolHandler(server, 'get_tip_distribution');
    const result = await handler({ community: 'x' }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
  });
});
