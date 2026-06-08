import { describe, it, expect } from 'vitest';
import { parseCommunities } from '../src/scrape/communities.js';
import { fixture } from './helpers.js';
describe('parseCommunities', () => {
  it('returns [] for a member-less account', () => {
    expect(parseCommunities(fixture('meinetipprunden-empty.html'))).toEqual([]);
  });
  it('extracts slug+name when display name differs from slug (real-world pattern)', () => {
    // Real KickTipp pattern: slug is URL-safe, name is human-readable with spaces/year
    const html = `<div id="kicktipp-content"><div class="menu">
      <div class="level0"><a href="/bundesliga-tippspiel/"><div class="menu-title-mit-tippglocke">Bundesliga Tippspiel 24/25</div></a></div>
      <div class="level0"><a href="/my-league">My League 2025</a></div>
    </div></div>`;
    const c = parseCommunities(html);
    expect(c).toContainEqual({ slug: 'bundesliga-tippspiel', name: 'Bundesliga Tippspiel 24/25' });
    expect(c).toContainEqual({ slug: 'my-league', name: 'My League 2025' });
  });
  it('ignores nav/footer links outside #kicktipp-content', () => {
    // The selector must not match links in the nav or footer
    const html = `<nav><a href="/info">Info</a></nav>
      <div id="kicktipp-content"><a href="/my-community">My Community</a></div>
      <footer><a href="/impressum">Impressum</a></footer>`;
    const c = parseCommunities(html);
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ slug: 'my-community', name: 'My Community' });
  });
  it('detects a member community from the "Meine Tipprunden" nav dropdown (real meinetipprunden; name != slug)', () => {
    const c = parseCommunities(fixture('meinetipprunden-member.html'));
    expect(c).toContainEqual({ slug: 'supertipper', name: 'Super Tipper 2026' });
  });
});
