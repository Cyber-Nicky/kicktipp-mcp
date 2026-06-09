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
