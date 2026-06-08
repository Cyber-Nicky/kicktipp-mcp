export class KickTippError extends Error { constructor(msg: string) { super(msg); this.name = new.target.name; } }
export class AuthError extends KickTippError {}
export class NotMemberError extends KickTippError {}
export class DeadlinePassedError extends KickTippError {}
export class RateLimitError extends KickTippError {}
export class ConsentWallError extends KickTippError {}
export class ParseError extends KickTippError {
  selector?: string;
  constructor(msg: string, selector?: string) { super(msg); this.selector = selector; }
}
