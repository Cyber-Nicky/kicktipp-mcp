import { describe, it, expect } from 'vitest';
import { AccountRegistry } from '../src/mcp/accounts.js';

function make() {
  const made: string[] = [];
  const reg = new AccountRegistry({
    emails: ['a@x.de', 'B@y.de'],
    defaultEmail: 'a@x.de',
    makeClient: (email) => { made.push(email); return { email } as any; },
  });
  return { made, reg };
}

describe('AccountRegistry', () => {
  it('resolves the default account when none is given', () => {
    const { reg } = make();
    expect((reg.resolve() as any).email).toBe('a@x.de');
    expect(reg.defaultEmail()).toBe('a@x.de');
    expect(reg.emails()).toEqual(['a@x.de', 'B@y.de']);
  });

  it('matches account emails case-insensitively', () => {
    const { reg } = make();
    expect((reg.resolve('b@Y.DE') as any).email).toBe('B@y.de');
  });

  it('throws on unknown accounts, listing the configured emails', () => {
    const { reg } = make();
    expect(() => reg.resolve('nobody@nowhere.de')).toThrow(/nobody@nowhere\.de.*a@x\.de.*B@y\.de/s);
  });

  it('creates clients lazily and caches them per email', () => {
    const { reg, made } = make();
    expect(made).toEqual([]);          // nothing created at construction
    reg.resolve();
    reg.resolve('A@X.DE');
    expect(made).toEqual(['a@x.de']);  // one client, reused, B never created
  });

  it('rejects a default that is not among the configured emails', () => {
    expect(() => new AccountRegistry({ emails: ['a@x.de'], defaultEmail: 'c@z.de', makeClient: () => ({}) as any }))
      .toThrow(/c@z\.de/);
  });

  it('rejects an empty email list', () => {
    expect(() => new AccountRegistry({ emails: [], defaultEmail: 'a@x.de', makeClient: () => ({}) as any }))
      .toThrow(/at least one/i);
  });
});
