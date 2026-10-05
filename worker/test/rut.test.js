import { describe, it, expect } from 'vitest';
import { normalizeRut, isValidRut } from '../src/lib/rut.js';

describe('normalizeRut', () => {
  it('removes dots and spaces and uppercases the check digit', () => {
    expect(normalizeRut('19.572.933-6')).toBe('19572933-6');
    expect(normalizeRut(' 10.000.013-k ')).toBe('10000013-K');
  });
  it('returns an empty string for null or undefined', () => {
    expect(normalizeRut(null)).toBe('');
    expect(normalizeRut(undefined)).toBe('');
  });
});

describe('isValidRut', () => {
  it('accepts valid RUTs', () => {
    expect(isValidRut('11111111-1')).toBe(true);
    expect(isValidRut('12345678-5')).toBe(true);
    expect(isValidRut('10000013-K')).toBe(true);
  });
  it('rejects bad check digits and bad shapes', () => {
    expect(isValidRut('11111111-2')).toBe(false);
    expect(isValidRut('1234-5')).toBe(false);
    expect(isValidRut('abc')).toBe(false);
    expect(isValidRut('')).toBe(false);
  });
});
