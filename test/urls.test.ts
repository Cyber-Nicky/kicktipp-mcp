import { describe, it, expect } from 'vitest';
import { urls } from '../src/urls.js';

describe('urls', () => {
  const u = urls('https://www.kicktipp.de');
  it('builds login + action', () => {
    expect(u.loginPage()).toBe('https://www.kicktipp.de/info/profil/login');
    expect(u.loginAction()).toBe('https://www.kicktipp.de/info/profil/loginaction');
  });
  it('builds per-community pages with matchday', () => {
    expect(u.tippabgabe('bundesliga-tippspiel')).toBe('https://www.kicktipp.de/bundesliga-tippspiel/tippabgabe');
    expect(u.tippuebersicht('x', 5)).toBe('https://www.kicktipp.de/x/tippuebersicht?spieltagIndex=5');
    expect(u.matchDetail('x', 99)).toBe('https://www.kicktipp.de/x/tippuebersicht/spiel?tippspielId=99');
  });
  it('bonusabgabe appends bonus=true', () => {
    expect(u.bonusabgabe('runde')).toBe('https://www.kicktipp.de/runde/tippabgabe?bonus=true');
  });
});
