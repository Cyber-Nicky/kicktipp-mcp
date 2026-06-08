import { Command } from 'commander';
import { KickTippClient } from '../core.js';
import { Session } from '../auth/session.js';
import { defaultKeychain } from '../auth/keychain.js';
import { ConfigStore } from '../config.js';
import { renderDistribution, renderPredictions, renderMatchday } from './render.js';
import * as readline from 'node:readline/promises';

/**
 * Read a line from stdin while masking the echoed characters with `*`.
 * Falls back to a normal (unmasked) prompt when stdin is not an interactive
 * TTY (e.g. piped input), where raw mode is unavailable.
 */
function readPasswordMasked(prompt: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    // Non-interactive: cannot mask. Fall back to a plain readline prompt.
    const rl = readline.createInterface({ input, output });
    return rl.question(prompt).finally(() => rl.close());
  }
  return new Promise<string>((resolve, reject) => {
    output.write(prompt);
    let value = '';
    const prevRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const cleanup = () => {
      input.setRawMode(prevRaw ?? false);
      input.pause();
      input.removeListener('data', onData);
      output.write('\n');
    };
    const ETX = '\u0003'; // Ctrl-C
    const EOT = '\u0004'; // Ctrl-D
    const DEL = '\u007f';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        switch (ch) {
          case '\n':
          case '\r':
          case EOT:
            cleanup();
            resolve(value);
            return;
          case ETX:
            cleanup();
            reject(new Error('Aborted'));
            return;
          case DEL:
          case '\b': // Backspace
            if (value.length > 0) {
              value = value.slice(0, -1);
              output.write('\b \b');
            }
            break;
          default:
            value += ch;
            output.write('*');
        }
      }
    };
    input.on('data', onData);
  });
}

export function buildProgram(deps?: { core?: KickTippClient; cfg?: ConfigStore }) {
  const program = new Command();
  program
    .name('ktipp')
    .option('--json', 'machine-readable output')
    .option('-c, --community <slug>', 'community slug')
    .option('-p, --profile <email>', 'profile email');

  const cfg = deps?.cfg ?? new ConfigStore();
  const getCore = () => {
    if (deps?.core) return deps.core;
    const p = program.opts().profile || cfg.activeProfile()?.email;
    const email = process.env.KICKTIPP_EMAIL || p;
    const password = process.env.KICKTIPP_PASSWORD || '';
    if (!email) throw new Error('No profile. Run: ktipp login');
    return new KickTippClient(new Session({ email, password, keychain: defaultKeychain() }));
  };
  const community = () => program.opts().community || cfg.activeProfile()?.defaultCommunity;
  const requireCommunity = (): string => {
    const c = community();
    if (!c) throw new Error('No community. Pass -c <slug> or run: ktipp use <slug>');
    return c;
  };
  const out = (data: unknown, pretty: string) =>
    console.log(program.opts().json ? JSON.stringify(data, null, 2) : pretty);

  program.command('login').action(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const email = await rl.question('Email: ');
    rl.close();
    const password = await readPasswordMasked('Password: ');
    const s = new Session({ email, password, keychain: defaultKeychain() });
    await s.login();
    cfg.addProfile({ email });
    console.log('Logged in and saved.');
  });

  program.command('communities').action(async () => {
    const c = await getCore().listCommunities();
    out(c, c.map((x) => `${x.slug}  (${x.name})`).join('\n'));
  });

  program.command('use <slug>').action((slug: string) => {
    const p = cfg.activeProfile();
    if (!p) {
      console.error('No active profile — run: ktipp login first');
      process.exitCode = 1;
      return;
    }
    cfg.setDefaultCommunity(p.email, slug);
    console.log(`Default community = ${slug}`);
  });

  program
    .command('matchday')
    .option('-d, --day <n>', 'spieltagIndex')
    .action(async (o) => {
      const ms = await getCore().getMatchday({ community: requireCommunity(), spieltagIndex: o.day ? +o.day : undefined });
      out(ms, renderMatchday(ms));
    });

  program
    .command('distribution')
    .option('-d, --day <n>', 'spieltagIndex')
    .action(async (o) => {
      const d = await getCore().getTipDistribution({ community: requireCommunity(), spieltagIndex: o.day ? +o.day : undefined });
      out(d, renderDistribution(d));
    });

  program
    .command('predict')
    .option('-d, --day <n>', 'spieltagIndex')
    .action(async (o) => {
      const p = await getCore().predictMatchday({ community: requireCommunity(), spieltagIndex: o.day ? +o.day : undefined });
      out(p, renderPredictions(p));
    });

  program.command('standings').action(async () => {
    const s = await getCore().getStandings({ community: requireCommunity() });
    out(s, s.map((r) => `${r.rank}. ${r.team}  ${r.points}pt`).join('\n'));
  });

  program
    .command('bet')
    .option('-d, --day <n>', 'spieltagIndex')
    .option('--yes', 'actually submit')
    .requiredOption('--scores <pairs>', 'e.g. 101=2:1,102=0:0')
    .action(async (o) => {
      const bets = o.scores.split(',').map((s: string) => {
        const m = /^(\d+)=(\d+):(\d+)$/.exec(s.trim());
        if (!m) throw new Error('Bad --scores format: expected id=h:a pairs, got: ' + s);
        return { matchId: +m[1], home: +m[2], away: +m[3] };
      });
      const r = await getCore().placeBets({
        community: requireCommunity(),
        spieltagIndex: o.day ? +o.day : undefined,
        bets,
        dryRun: !o.yes,
      });
      out(
        r,
        `${r.submitted ? 'SUBMITTED' : 'DRY-RUN'}:\n` +
          r.diff
            .map((d) => `  ${d.matchId}: ${d.from ? `${d.from.home}:${d.from.away}` : '-'} -> ${d.to.home}:${d.to.away}`)
            .join('\n'),
      );
    });

  return program;
}
