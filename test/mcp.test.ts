import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

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
