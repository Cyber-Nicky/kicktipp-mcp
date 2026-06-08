import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const exec = promisify(execFile);

export interface Keychain {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  del(k: string): Promise<void>;
}

export const macKeychain: Keychain = {
  async get(k) {
    try {
      const { stdout } = await exec('security', ['find-generic-password', '-s', k, '-w']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  },
  async set(k, v) {
    try {
      await exec('security', ['delete-generic-password', '-s', k]);
    } catch {
      // ignore: entry may not exist yet
    }
    await exec('security', ['add-generic-password', '-s', k, '-a', k, '-w', v]);
  },
  async del(k) {
    try {
      await exec('security', ['delete-generic-password', '-s', k]);
    } catch {
      // ignore: entry may not exist
    }
  },
};

const DEFAULT_DIR = join(homedir(), '.config', 'kicktipp-mcp');

/**
 * Resolve the symmetric key for the encrypted-file store.
 *
 * The key is a *real* secret — never derived from a guessable value like the
 * hostname. Preference order:
 *   1. A user-supplied passphrase via `KICKTIPP_PASSPHRASE` (scrypt-stretched).
 *   2. A random 32-byte key persisted (mode 0600) next to the store and reused
 *      across runs.
 */
function resolveKey(dir: string): Buffer {
  const passphrase = process.env.KICKTIPP_PASSPHRASE;
  const saltPath = join(dir, '.kek.salt');
  if (passphrase) {
    mkdirSync(dir, { recursive: true });
    let salt: Buffer;
    if (existsSync(saltPath)) {
      salt = readFileSync(saltPath);
    } else {
      salt = randomBytes(16);
      writeFileSync(saltPath, salt, { mode: 0o600 });
    }
    return scryptSync(passphrase, salt, 32);
  }
  const keyPath = join(dir, '.kek');
  mkdirSync(dir, { recursive: true });
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath);
    if (raw.length === 32) return raw;
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

interface FileStore {
  [k: string]: string;
}

/**
 * Portable encrypted-file fallback for platforms without the macOS `security`
 * CLI. Secrets are stored AES-256-GCM-encrypted in `secrets.json`; the
 * encryption key comes from {@link resolveKey} (passphrase or persisted random
 * key — not a hostname-derived fake key).
 */
export function fileKeychain(opts?: { dir?: string }): Keychain {
  const dir = opts?.dir ?? DEFAULT_DIR;
  const file = join(dir, 'secrets.json');

  function encrypt(plain: string): string {
    const key = resolveKey(dir);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
  }

  function decrypt(packed: string): string | null {
    try {
      const key = resolveKey(dir);
      const [ivB64, tagB64, encB64] = packed.split(':');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      const dec = Buffer.concat([
        decipher.update(Buffer.from(encB64, 'base64')),
        decipher.final(),
      ]);
      return dec.toString('utf8');
    } catch {
      return null;
    }
  }

  function read(): FileStore {
    if (!existsSync(file)) return {};
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as FileStore;
    } catch {
      return {};
    }
  }

  function write(store: FileStore): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 });
  }

  return {
    async get(k) {
      const store = read();
      const packed = store[k];
      return packed == null ? null : decrypt(packed);
    },
    async set(k, v) {
      const store = read();
      store[k] = encrypt(v);
      write(store);
    },
    async del(k) {
      const store = read();
      if (k in store) {
        delete store[k];
        if (Object.keys(store).length === 0 && existsSync(file)) {
          rmSync(file);
        } else {
          write(store);
        }
      }
    },
  };
}

/** True when the macOS `security` CLI is available for use as a Keychain backend. */
async function hasSecurityCli(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    await exec('security', ['-h']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Default Keychain: macOS `security` CLI when available, otherwise the portable
 * encrypted-file fallback. Backend is resolved lazily on first use.
 */
export function defaultKeychain(opts?: { dir?: string }): Keychain {
  let backend: Promise<Keychain> | null = null;
  const resolve = (): Promise<Keychain> => {
    if (!backend) {
      backend = hasSecurityCli().then((ok) => (ok ? macKeychain : fileKeychain(opts)));
    }
    return backend;
  };
  return {
    async get(k) {
      return (await resolve()).get(k);
    },
    async set(k, v) {
      return (await resolve()).set(k, v);
    },
    async del(k) {
      return (await resolve()).del(k);
    },
  };
}
