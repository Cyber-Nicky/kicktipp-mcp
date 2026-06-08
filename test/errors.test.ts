import { describe, it, expect } from 'vitest';
import { AuthError, NotMemberError, ParseError, KickTippError } from '../src/errors.js';
describe('errors', () => {
  it('subclass instanceof base', () => {
    expect(new AuthError('x')).toBeInstanceOf(KickTippError);
    expect(new NotMemberError('round')).toBeInstanceOf(KickTippError);
  });
  it('ParseError carries the selector', () => {
    expect(new ParseError('msg', '#tippabgabeSpiele').selector).toBe('#tippabgabeSpiele');
  });
});
