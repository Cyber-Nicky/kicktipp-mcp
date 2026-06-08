import { describe, it, expect } from 'vitest';
import { OddsSchema, PredictionSchema } from '../src/domain/types.js';

describe('schemas', () => {
  it('accepts valid odds', () => {
    expect(OddsSchema.parse({ home: 1.5, draw: 3.4, away: 5.0 })).toEqual({ home: 1.5, draw: 3.4, away: 5.0 });
  });
  it('rejects negative odds', () => {
    expect(() => OddsSchema.parse({ home: -1, draw: 3, away: 5 })).toThrow();
  });
  it('validates a prediction shape', () => {
    const p = { matchId: 1, home: 'A', away: 'B', probs: { home: 0.5, draw: 0.3, away: 0.2 }, score: { home: 2, away: 1 }, expectedPoints: 1.2, rationale: 'x' };
    expect(PredictionSchema.parse(p).score.home).toBe(2);
  });
});
