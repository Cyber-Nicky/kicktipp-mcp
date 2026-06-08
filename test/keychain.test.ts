import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileKeychain } from '../src/auth/keychain.js';

describe('fileKeychain (encrypted-file fallback)', () => {
  const prevPass = process.env.KICKTIPP_PASSPHRASE;
  afterEach(() => {
    if (prevPass === undefined) delete process.env.KICKTIPP_PASSPHRASE;
    else process.env.KICKTIPP_PASSPHRASE = prevPass;
  });

  it('round-trips a secret and persists it across instances', async () => {
    delete process.env.KICKTIPP_PASSPHRASE;
    const dir = mkdtempSync(join(tmpdir(), 'kt-kc-'));
    const kc = fileKeychain({ dir });
    await kc.set('kicktipp:e@x.de', JSON.stringify({ login: 'TOK' }));

    // Persisted on disk and NOT in plaintext.
    const raw = readFileSync(join(dir, 'secrets.json'), 'utf8');
    expect(raw).not.toContain('TOK');

    // A fresh instance reads the same (reused) key from disk.
    const kc2 = fileKeychain({ dir });
    expect(await kc2.get('kicktipp:e@x.de')).toContain('TOK');
  });

  it('deletes secrets', async () => {
    delete process.env.KICKTIPP_PASSPHRASE;
    const dir = mkdtempSync(join(tmpdir(), 'kt-kc-'));
    const kc = fileKeychain({ dir });
    await kc.set('a', 'one');
    await kc.del('a');
    expect(await kc.get('a')).toBeNull();
  });

  it('derives the key from a passphrase when set, isolating stores', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-kc-'));
    process.env.KICKTIPP_PASSPHRASE = 'correct horse battery staple';
    const kc = fileKeychain({ dir });
    await kc.set('a', 'secret');
    expect(await kc.get('a')).toBe('secret');

    // Wrong passphrase cannot decrypt (auth tag mismatch → null, not throw).
    process.env.KICKTIPP_PASSPHRASE = 'wrong passphrase';
    const kcWrong = fileKeychain({ dir });
    expect(await kcWrong.get('a')).toBeNull();
  });

  it('does not derive the key from the hostname', async () => {
    delete process.env.KICKTIPP_PASSPHRASE;
    const dir = mkdtempSync(join(tmpdir(), 'kt-kc-'));
    const kc = fileKeychain({ dir });
    await kc.set('a', 'secret');
    // A persisted random key file backs the store — proving the key is a real
    // secret rather than a value derivable from the machine hostname.
    expect(existsSync(join(dir, '.kek'))).toBe(true);
    expect(readFileSync(join(dir, '.kek')).length).toBe(32);
  });
});
