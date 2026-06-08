#!/usr/bin/env node
// KickTipp live-recon probe — zero-dependency (Node 22+ native fetch).
//
// Goal: settle the 10 open questions from the reverse-engineering briefing against a
// REAL logged-in account, WITHOUT a browser, by doing the HTTP-direct flow:
//   1. GET the login page, enumerate ALL form fields (incl. hidden / CSRF).
//   2. POST credentials, capture Set-Cookie (login / JSESSIONID), follow redirects.
//   3. Probe whether HTTP-direct auth actually works (or if a CMP/JS wall blocks it).
//   4. Discover communities from /info/profil/meinetipprunden.
//   5. Snapshot tippabgabe / tippuebersicht / tabellen / tippspielplan + the
//      TIP-DISTRIBUTION ("Tippverteilung") screen for upcoming matches.
//   6. Save raw HTML + headers + a manifest so we can verify selectors as ground truth.
//
// READ-ONLY: the only non-GET request is the login POST. It NEVER submits a tip/bet.
//
// Usage: node recon/probe.mjs   (after filling .env)

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'research', 'recon');

// ---------- tiny .env loader (no dependency) ----------
async function loadEnv() {
  let raw = '';
  try { raw = await readFile(join(ROOT, '.env'), 'utf8'); }
  catch { throw new Error('.env not found — copy .env.example to .env and fill it in.'); }
  const env = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

// ---------- cookie jar ----------
class Jar {
  constructor() { this.c = new Map(); }
  ingest(setCookies = []) {
    for (const sc of setCookies) {
      const first = sc.split(';')[0];
      const j = first.indexOf('=');
      if (j === -1) continue;
      const name = first.slice(0, j).trim();
      const val = first.slice(j + 1).trim();
      if (val === '' || /deleted/i.test(val)) this.c.delete(name);
      else this.c.set(name, val);
    }
  }
  header() { return [...this.c.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  names() { return [...this.c.keys()]; }
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------- manual fetch with redirect-following + cookie capture ----------
async function go(jar, method, url, { body, contentType } = {}) {
  const chain = [];
  let curUrl = url, curMethod = method, curBody = body, hops = 0;
  while (true) {
    const headers = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    };
    const cookie = jar.header();
    if (cookie) headers['Cookie'] = cookie;
    if (curBody != null && contentType) headers['Content-Type'] = contentType;

    const res = await fetch(curUrl, { method: curMethod, headers, body: curBody, redirect: 'manual' });
    const setC = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    jar.ingest(setC);
    chain.push({ url: curUrl, method: curMethod, status: res.status, setCookies: setC.map(s => s.split(';')[0]) });

    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location') && hops < 10) {
      const loc = new URL(res.headers.get('location'), curUrl).toString();
      curMethod = res.status === 303 || res.status === 302 ? 'GET' : curMethod;
      if (curMethod === 'GET') { curBody = undefined; contentType = undefined; }
      curUrl = loc; hops++;
      continue;
    }
    const html = await res.text();
    return { finalUrl: curUrl, status: res.status, html, chain };
  }
}

// ---------- light HTML helpers (regex; we also save raw HTML for grepping) ----------
function findLoginForm(html) {
  // grab each <form>...</form>, pick the one containing name="kennung"
  const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)];
  for (const m of forms) {
    const whole = m[0];
    if (/name=["']?kennung/i.test(whole)) {
      const action = (whole.match(/<form\b[^>]*\baction=["']([^"']*)["']/i) || [])[1] || '';
      const inputs = [...whole.matchAll(/<input\b[^>]*>/gi)].map(i => i[0]);
      const fields = inputs.map(tag => ({
        name: (tag.match(/\bname=["']([^"']*)["']/i) || [])[1],
        type: (tag.match(/\btype=["']([^"']*)["']/i) || [])[1] || 'text',
        value: (tag.match(/\bvalue=["']([^"']*)["']/i) || [])[1] || '',
        id: (tag.match(/\bid=["']([^"']*)["']/i) || [])[1],
      })).filter(f => f.name);
      return { action, fields, raw: whole };
    }
  }
  return null;
}

function scan(html) {
  const has = (re) => re.test(html);
  const all = (re) => [...new Set([...html.matchAll(re)].map(m => m[1]))];
  return {
    loggedOutMarker_kennung: has(/name=["']?kennung/i),
    logoutLink: has(/logout|abmelden|ausloggen/i),
    consent_sourcepoint: has(/sp_message_iframe|privacy-mgmt|sourcepoint/i),
    consent_quantcast: has(/qc-cmp2-ui|quantcast/i),
    consent_words: has(/Akzeptieren|Zustimmen|Accept and continue|ZUSTIMMEN/i),
    csrf_like_fields: all(/<input[^>]*\bname=["']([^"']*(?:csrf|token|_token|authenticity|nonce)[^"']*)["']/gi),
    hidden_field_names: all(/<input[^>]*\btype=["']hidden["'][^>]*\bname=["']([^"']*)["']/gi),
    score_input_names: all(/<input[^>]*\bname=["']([^"']*(?:heimTipp|gastTipp)[^"']*)["']/gi),
    score_input_ids: all(/<input[^>]*\bid=["']([^"']*(?:heimTipp|gastTipp)[^"']*)["']/gi),
    odds_classes_found: [
      'kicktipp-wettquote', 'wettquote-link', 'quote-heim', 'quote-remis', 'quote-gast',
      'quote-text', 'quote-label', 'quote-link', 'class="quote"', "class='quote'",
    ].filter(c => html.includes(c)),
    tippabgabeSpiele_table: has(/id=["']tippabgabeSpiele["']/i),
    kicktipp_content: has(/id=["']kicktipp-content["']/i),
    // tip-distribution ("Tippverteilung") signals:
    tippverteilung_words: has(/Tippverteilung|Verteilung der Tipps|tip distribution/i),
    distribution_links: all(/href=["']([^"']*(?:verteilung|tippverteilung|spielinfo|tippuebersicht\/spiel|tippspielId=)[^"']*)["']/gi).slice(0, 25),
    tippspielIds: all(/tippspielId=([0-9]+)/gi).slice(0, 10),
    tippsaisonIds: all(/tippsaisonId=([0-9]+)/gi).slice(0, 5),
  };
}

function communitySlugs(html) {
  // links under /info/profil/meinetipprunden where href slug == link text (betbot heuristic)
  const out = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']\/([a-z0-9][a-z0-9-]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const slug = m[1];
    const text = m[2].replace(/<[^>]*>/g, '').trim();
    if (slug && text && slug.toLowerCase() === text.toLowerCase()) out.add(slug);
  }
  // also any /{slug}/tippabgabe style links
  for (const m of html.matchAll(/href=["']\/([a-z0-9][a-z0-9-]+)\/(?:tippabgabe|tippuebersicht|tabellen)["']/gi)) out.add(m[1]);
  return [...out];
}

async function save(name, data) {
  await writeFile(join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

// ---------- main ----------
async function main() {
  await mkdir(OUT, { recursive: true });
  const env = await loadEnv();
  if (!env.KICKTIPP_EMAIL || !env.KICKTIPP_PASSWORD) {
    console.error('✗ .env missing KICKTIPP_EMAIL / KICKTIPP_PASSWORD. Fill them and rerun.');
    process.exit(1);
  }
  const BASE = (env.KICKTIPP_BASE_URL || 'https://www.kicktipp.de').replace(/\/$/, '');
  const jar = new Jar();
  const manifest = { base: BASE, startedAt: new Date().toISOString(), steps: [], findings: {} };
  const record = (step) => { manifest.steps.push(step); console.log(`• ${step.label}: ${step.status} ${step.finalUrl || ''}`); };

  // 1) login page
  const loginUrl = `${BASE}/info/profil/login`;
  const lp = await go(jar, 'GET', loginUrl);
  await save('01_login_page.html', lp.html);
  const form = findLoginForm(lp.html);
  record({ label: 'GET login page', status: lp.status, finalUrl: lp.finalUrl, cookies: jar.names() });
  manifest.findings.loginForm = form ? { action: form.action, fields: form.fields } : null;
  manifest.findings.loginPageScan = scan(lp.html);

  if (!form) {
    console.error('✗ Could not find a login form with name="kennung". The page may be JS/CMP-gated. Saved 01_login_page.html for inspection.');
  } else {
    // 2) build POST body from hidden fields + creds
    const params = new URLSearchParams();
    for (const f of form.fields) {
      if (f.name === 'kennung') params.set(f.name, env.KICKTIPP_EMAIL);
      else if (f.name === 'passwort') params.set(f.name, env.KICKTIPP_PASSWORD);
      else if (f.type !== 'submit' || /submitbutton/i.test(f.name)) params.set(f.name, f.value || '');
    }
    if (!params.has('kennung')) params.set('kennung', env.KICKTIPP_EMAIL);
    if (!params.has('passwort')) params.set('passwort', env.KICKTIPP_PASSWORD);
    if (!params.has('submitbutton')) params.set('submitbutton', 'Anmelden');

    const action = new URL(form.action || loginUrl, loginUrl).toString();
    const lr = await go(jar, 'POST', action, { body: params.toString(), contentType: 'application/x-www-form-urlencoded' });
    await save('02_after_login.html', lr.html);
    const afterScan = scan(lr.html);
    const loggedIn = !afterScan.loggedOutMarker_kennung && (afterScan.logoutLink || !/\/login/i.test(lr.finalUrl));
    record({ label: 'POST login', status: lr.status, finalUrl: lr.finalUrl, cookies: jar.names(), loggedIn });
    manifest.findings.cookiesAfterLogin = jar.names();
    manifest.findings.loginRedirectChain = lr.chain;
    manifest.findings.loggedIn = loggedIn;

    // 3) confirm session by hitting base
    const home = await go(jar, 'GET', BASE + '/');
    await save('03_home_authed.html', home.html);
    record({ label: 'GET home (auth check)', status: home.status, finalUrl: home.finalUrl, redirectedToLogin: /\/login/i.test(home.finalUrl) });

    // 4) communities
    const mt = await go(jar, 'GET', `${BASE}/info/profil/meinetipprunden`);
    await save('04_meinetipprunden.html', mt.html);
    const slugs = communitySlugs(mt.html);
    record({ label: 'GET meinetipprunden', status: mt.status, finalUrl: mt.finalUrl, slugs });
    manifest.findings.communities = slugs;

    const community = env.KICKTIPP_COMMUNITY || slugs[0];
    manifest.findings.focusCommunity = community;

    if (community) {
      // 5) snapshot the key per-community pages on BOTH .de slugs
      const pages = [
        ['tippabgabe', `${BASE}/${community}/tippabgabe`],
        ['tippuebersicht', `${BASE}/${community}/tippuebersicht`],
        ['tabellen', `${BASE}/${community}/tabellen`],
        ['tippspielplan', `${BASE}/${community}/tippspielplan`],
        ['spielplan', `${BASE}/${community}/spielplan`],
        ['gesamtuebersicht', `${BASE}/${community}/gesamtuebersicht`],
      ];
      manifest.findings.pageScans = {};
      for (const [name, url] of pages) {
        try {
          const r = await go(jar, 'GET', url);
          await save(`05_${name}.html`, r.html);
          const s = scan(r.html);
          manifest.findings.pageScans[name] = { status: r.status, finalUrl: r.finalUrl, scan: s };
          record({ label: `GET ${name}`, status: r.status, finalUrl: r.finalUrl });
        } catch (e) {
          manifest.findings.pageScans[name] = { error: String(e) };
          record({ label: `GET ${name}`, status: 'ERR', finalUrl: e.message });
        }
      }

      // 6) TIP DISTRIBUTION ("Tippverteilung") hunt — the user's requested feature.
      // Try discovered match-detail links + constructed match-detail URLs.
      const abgabeScan = manifest.findings.pageScans['tippabgabe']?.scan || {};
      const uebersichtScan = manifest.findings.pageScans['tippuebersicht']?.scan || {};
      const candidateLinks = [
        ...(abgabeScan.distribution_links || []),
        ...(uebersichtScan.distribution_links || []),
      ];
      const ids = [...new Set([...(abgabeScan.tippspielIds || []), ...(uebersichtScan.tippspielIds || [])])];
      const constructed = ids.slice(0, 3).map(id => `${BASE}/${community}/tippuebersicht/spiel?tippspielId=${id}`);
      const distTargets = [...new Set([...candidateLinks.map(h => new URL(h, BASE).toString()), ...constructed])].slice(0, 6);
      manifest.findings.distributionTargets = distTargets;
      manifest.findings.distributionResults = [];
      let di = 0;
      for (const url of distTargets) {
        try {
          const r = await go(jar, 'GET', url);
          await save(`06_distribution_${di}.html`, r.html);
          const s = scan(r.html);
          manifest.findings.distributionResults.push({
            url, status: r.status, finalUrl: r.finalUrl,
            hasTippverteilung: s.tippverteilung_words,
          });
          record({ label: `GET distribution[${di}]`, status: r.status, finalUrl: r.finalUrl, hasTippverteilung: s.tippverteilung_words });
          di++;
        } catch (e) {
          manifest.findings.distributionResults.push({ url, error: String(e) });
        }
      }
    }
  }

  manifest.finishedAt = new Date().toISOString();
  await save('manifest.json', manifest);
  console.log(`\n✓ Recon complete. Snapshots + manifest.json in research/recon/`);
  console.log(`  cookies obtained: ${jar.names().join(', ') || '(none)'}`);
  console.log(`  communities: ${(manifest.findings.communities || []).join(', ') || '(none found)'}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
