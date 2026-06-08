import * as cheerio from 'cheerio';
import type { Community } from '../domain/types.js';
const RESERVED = new Set(['info', 'assets', 'images']);
export function parseCommunities(html: string): Community[] {
  const $ = cheerio.load(html);
  const out = new Map<string, Community>();
  $('#kicktipp-content a[href^="/"]').each((_, el) => {
    const href = ($(el).attr('href') || '').replace(/^\/|\/$/g, '');
    if (!href || href.includes('/') || RESERVED.has(href)) return;
    const text = $(el).text().trim();
    const glocke = $(el).find('.menu-title-mit-tippglocke').text().trim();
    const name = glocke || text;
    if (name) out.set(href, { slug: href, name });
  });
  return [...out.values()];
}
