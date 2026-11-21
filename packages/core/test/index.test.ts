import { describe, expect, it } from 'vitest';
import { isValidPortNumber } from '../src/index.js';

describe('@portcn/core', () => {
  it('accepts valid port boundaries', () => {
    expect(isValidPortNumber(1)).toBe(true);
    expect(isValidPortNumber(65_535)).toBe(true);
    expect(isValidPortNumber(8080)).toBe(true);
  });

  it('rejects invalid port values', () => {
    for (const value of [0, -1, 65_536, 1.5, '8080', null, Number.NaN]) {
      expect(isValidPortNumber(value)).toBe(false);
    }
  });
});
