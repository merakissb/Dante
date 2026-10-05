import { describe, it, expect } from 'vitest';
import {
  hashPin, generateSalt, generateToken, hashToken, generateTempPin,
} from '../src/lib/crypto.js';

describe('crypto helpers', () => {
  it('hashPin is deterministic and depends on the salt', async () => {
    expect(await hashPin('1234', 'aa')).toBe(await hashPin('1234', 'aa'));
    expect(await hashPin('1234', 'aa')).not.toBe(await hashPin('1234', 'bb'));
    expect(await hashPin('1234', 'aa')).toMatch(/^[0-9a-f]{64}$/);
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
