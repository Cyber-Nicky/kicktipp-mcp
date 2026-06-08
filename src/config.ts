import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'; import { dirname, join } from 'node:path'; import { homedir } from 'node:os';
import type { Profile } from './domain/types.js';
interface Data { profiles: Profile[]; active?: string; }
export class ConfigStore {
  private path: string; private data: Data;
  constructor(path = join(homedir(), '.config', 'kicktipp-mcp', 'config.json')) {
    this.path = path; this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { profiles: [] };
  }
  private save() { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, JSON.stringify(this.data, null, 2)); }
  profiles() { return this.data.profiles; }
  addProfile(p: Profile) { this.data.profiles = this.data.profiles.filter((x) => x.email !== p.email).concat(p); if (!this.data.active) this.data.active = p.email; this.save(); }
  setActiveProfile(email: string) { this.data.active = email; this.save(); }
  activeProfile() { return this.data.profiles.find((p) => p.email === this.data.active) ?? null; }
  setDefaultCommunity(email: string, community: string) { const p = this.data.profiles.find((x) => x.email === email); if (p) { p.defaultCommunity = community; this.save(); } }
}
