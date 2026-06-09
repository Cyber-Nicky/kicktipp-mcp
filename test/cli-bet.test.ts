import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildProgram } from '../src/cli/index.js';

const stubCfg: any = { activeProfile: () => null };

afterEach(() => vi.restoreAllMocks());

describe('ktipp bet output', () => {
  it('marks unknown and locked diff rows as skipped in the dry-run preview', async () => {
    const core: any = {
      placeBets: async () => ({
        submitted: false,
        verified: null,
        diff: [
          { matchId: 100, from: null, to: { home: 2, away: 1 }, status: 'ok' },
          { matchId: 200, from: { home: 1, away: 1 }, to: { home: 0, away: 0 }, status: 'locked' },
          { matchId: 999999, from: null, to: { home: 3, away: 3 }, status: 'unknown' },
        ],
      }),
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await buildProgram({ core, cfg: stubCfg }).parseAsync([
      'node', 'ktipp', 'bet', '-c', 'x', '--scores', '100=2:1,200=0:0,999999=3:3',
    ]);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('DRY-RUN');
    expect(out).toMatch(/200:.*locked.*skipped/i);
    expect(out).toMatch(/999999:.*unknown.*skipped/i);
    expect(out).not.toMatch(/100:.*skipped/i);
  });

  it('reports per-bet verification outcome after a real submit', async () => {
    const core: any = {
      placeBets: async () => ({
        submitted: true,
        verified: false,
        diff: [
          { matchId: 100, from: null, to: { home: 3, away: 0 }, status: 'ok', verified: true },
          { matchId: 101, from: null, to: { home: 1, away: 1 }, status: 'ok', verified: false },
        ],
      }),
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await buildProgram({ core, cfg: stubCfg }).parseAsync([
      'node', 'ktipp', 'bet', '-c', 'x', '--scores', '100=3:0,101=1:1', '--yes',
    ]);
    const out = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('SUBMITTED');
    expect(out).toMatch(/VERIFICATION FAILED/i);
    expect(out).toMatch(/100:.*verified/i);
    expect(out).toMatch(/101:.*NOT SAVED/i);
  });
});
