import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
import { ConfigStore } from '../src/config.js';
describe('ConfigStore', () => {
  it('saves and lists profiles, tracks default community', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-'));
    const c = new ConfigStore(join(dir, 'config.json'));
    c.addProfile({ email: 'a@x.de', defaultCommunity: 'round1' });
    c.setActiveProfile('a@x.de');
    expect(c.activeProfile()?.defaultCommunity).toBe('round1');
    const c2 = new ConfigStore(join(dir, 'config.json'));
    expect(c2.profiles()).toHaveLength(1);
  });
});
