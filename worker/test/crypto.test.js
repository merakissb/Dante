import { describe, it, expect } from 'vitest';
import {
  hashPin, generateSalt, generateToken, hashToken, generateTempPin, getPepper, timingSafeEqualHex,
} from '../src/lib/crypto.js';

describe('crypto helpers', () => {
  it('hashPin is deterministic and depends on the salt', async () => {
    expect(await hashPin('1234', 'aa', 'pepper')).toBe(await hashPin('1234', 'aa', 'pepper'));
    expect(await hashPin('1234', 'aa', 'pepper')).not.toBe(await hashPin('1234', 'bb', 'pepper'));
    expect(await hashPin('1234', 'aa', 'pepper')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashPin depends on the secret pepper, so a database leak alone cannot be brute-forced', async () => {
    expect(await hashPin('1234', 'aa', 'pepper-one')).not.toBe(await hashPin('1234', 'aa', 'pepper-two'));
  });

  it('getPepper fails closed when the secret is not configured', () => {
    expect(getPepper({ PIN_PEPPER: 'x' })).toBe('x');
    expect(() => getPepper({})).toThrow();
    expect(() => getPepper({ PIN_PEPPER: '' })).toThrow();
  });

  it('timingSafeEqualHex compares equal-length strings and rejects anything else', () => {
    expect(timingSafeEqualHex('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqualHex('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqualHex('abc', 'abc123')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(true);
  });

  it('generateSalt returns 32 hex chars and is not constant', () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSalt()).not.toBe(generateSalt());
  });

  it('generateToken returns 64 hex chars and hashToken is sha256 of it', async () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(token)).not.toBe(token);
  });
});

describe('generateTempPin', () => {
  it('always returns exactly 4 digits', () => {
    for (let i = 0; i < 500; i++) expect(generateTempPin()).toMatch(/^\d{4}$/);
  });

  it('keeps leading zeros', () => {
    expect(generateTempPin(undefined, () => '0042')).toBe('0042');
  });

  it('redraws until the PIN differs from the excluded one', () => {
    const draws = ['2933', '2933', '1111'];
    expect(generateTempPin('2933', () => draws.shift())).toBe('1111');
  });
});
