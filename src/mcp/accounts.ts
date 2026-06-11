import type { KickTippClient } from '../core.js';

export interface AccountRegistryOpts {
  emails: string[];
  defaultEmail: string;
  makeClient: (email: string) => KickTippClient;
}

/**
 * Resolves an optional account email to a per-account KickTippClient.
 * Clients are created lazily on first use and cached, so accounts that are
 * never addressed never trigger a session/login.
 */
export class AccountRegistry {
  private clients = new Map<string, KickTippClient>(); // key: lowercased email
  private list: string[];

  constructor(private o: AccountRegistryOpts) {
    this.list = [...new Set(o.emails.map((e) => e.trim()).filter(Boolean))];
    if (!this.list.length) throw new Error('AccountRegistry needs at least one account');
    if (!this.find(o.defaultEmail))
      throw new Error(`default account ${o.defaultEmail} is not among the configured accounts`);
  }

  private find(email: string): string | undefined {
    const want = email.trim().toLowerCase();
    return this.list.find((e) => e.toLowerCase() === want);
  }

  emails(): string[] { return [...this.list]; }
  defaultEmail(): string { return this.find(this.o.defaultEmail)!; }

  resolve(account?: string): KickTippClient {
    const email = account?.trim() ? this.find(account) : this.defaultEmail();
    if (!email)
      throw new Error(`unknown account "${account}". Configured accounts: ${this.list.join(', ')}`);
    const key = email.toLowerCase();
    let client = this.clients.get(key);
    if (!client) {
      client = this.o.makeClient(email);
      this.clients.set(key, client);
    }
    return client;
  }
}
