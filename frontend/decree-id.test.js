// Run with: docker run --rm -v "$PWD/frontend":/app -w /app node:22-slim node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDecreeId } = require('./decree-id.js');

test('accepts DP-<digits> in any letter case and returns the lowercase form', () => {
  assert.equal(normalizeDecreeId('DP-1234'), 'dp-1234');
  assert.equal(normalizeDecreeId('dp-1234'), 'dp-1234');
  assert.equal(normalizeDecreeId('Dp-1'), 'dp-1');
  assert.equal(normalizeDecreeId('  DP-12345678  '), 'dp-12345678');
});

test('rejects everything else', () => {
  for (const value of ['1234', 'DP1234', 'DP-', 'DP-12a', 'DP-123456789', 'XP-1234', 'DP-1234-5', 'DP--1', 'DP 1234', '', null, undefined]) {
    assert.equal(normalizeDecreeId(value), null, String(value));
  }
});
