import { describe, it, expect } from 'vitest';
import { normalizeRut, isValidRut } from '../src/lib/rut.js';

describe('normalizeRut', () => {
  it('removes dots and spaces and uppercases the check digit', () => {
    expect(normalizeRut('19.572.933-6')).toBe('19572933-6');
    expect(normalizeRut(' 10.000.013-k ')).toBe('10000013-K');
  });
  it('accepts a RUT typed without the hyphen, with or without dots', () => {
    expect(normalizeRut('195729336')).toBe('19572933-6');
    expect(normalizeRut('19.572.9336')).toBe('19572933-6');
    expect(normalizeRut('10000013k')).toBe('10000013-K');
    expect(normalizeRut('12345678 5')).toBe('12345678-5');
  });
  it('drops anything that is not a digit or K, so hostile text cannot reach the database lookup', () => {
    expect(normalizeRut('<img src=x onerror=alert(1)>')).toBe('1');
    expect(normalizeRut('DROP TABLE users;--')).toBe('');
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
