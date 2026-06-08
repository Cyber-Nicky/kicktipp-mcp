import { describe, it, expect } from 'vitest';
import { version } from '../src/index.js';

describe('scaffold', () => {
  it('version export resolves to a non-empty string', () => {
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });
});
