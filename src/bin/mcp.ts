import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from '../mcp/server.js';
import { KickTippClient } from '../core.js';
import { Session } from '../auth/session.js';
import { defaultKeychain } from '../auth/keychain.js';
import { ConfigStore } from '../config.js';
import { AccountRegistry } from '../mcp/accounts.js';

const cfg = new ConfigStore();
const envEmail = process.env.KICKTIPP_EMAIL;
const emails = cfg.profiles().map((p) => p.email);
if (envEmail && !emails.some((e) => e.toLowerCase() === envEmail.toLowerCase())) emails.push(envEmail);
const defaultEmail = envEmail || cfg.activeProfile()?.email || emails[0];
if (!defaultEmail) {
  console.error('No KickTipp profile. Run: ktipp login');
  process.exit(1);
}
const keychain = defaultKeychain();
const registry = new AccountRegistry({
  emails,
  defaultEmail,
  makeClient: (email) =>
    new KickTippClient(
      new Session({
        email,
        // KICKTIPP_PASSWORD belongs to the KICKTIPP_EMAIL account only; every
        // other account authenticates via its saved Keychain session.
        password:
          envEmail && email.toLowerCase() === envEmail.toLowerCase()
            ? process.env.KICKTIPP_PASSWORD || ''
            : '',
        keychain,
      }),
    ),
});
const { server } = buildServer(registry);
await server.connect(new StdioServerTransport());
