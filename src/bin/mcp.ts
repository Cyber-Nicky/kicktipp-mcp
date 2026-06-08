import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from '../mcp/server.js';
import { KickTippClient } from '../core.js';
import { Session } from '../auth/session.js';
import { defaultKeychain } from '../auth/keychain.js';
import { ConfigStore } from '../config.js';

const cfg = new ConfigStore();
const profile = cfg.activeProfile();
const email = process.env.KICKTIPP_EMAIL || profile?.email;
const password = process.env.KICKTIPP_PASSWORD || '';
if (!email) {
  console.error('No KickTipp profile. Run: ktipp login');
  process.exit(1);
}
const session = new Session({ email, password, keychain: defaultKeychain() });
const { server } = buildServer(new KickTippClient(session));
await server.connect(new StdioServerTransport());
