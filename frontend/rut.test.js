// Run with: docker run --rm -v "$PWD/frontend":/app -w /app node:22-slim node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatRut, isValidRut } = require('./rut.js');

test('formatRut formats while typing', () => {
  assert.equal(formatRut(''), '');
  assert.equal(formatRut('1'), '1');
  assert.equal(formatRut('12'), '1-2');
  assert.equal(formatRut('1234'), '123-4');
  assert.equal(formatRut('12345'), '1.234-5');
  assert.equal(formatRut('333333333'), '33.333.333-3');
  assert.equal(formatRut('7654321k'), '7.654.321-K');
});

test('formatRut strips junk, uppercases K and caps the length at 9 characters', () => {
  assert.equal(formatRut('33.333.333-3'), '33.333.333-3');
  assert.equal(formatRut(' 33 333 333 3 '), '33.333.333-3');
  assert.equal(formatRut('10000013k'), '10.000.013-K');
  assert.equal(formatRut('3333333330000'), '33.333.333-3');
  assert.equal(formatRut('abc'), '');
  assert.equal(formatRut(null), '');
});

test('isValidRut accepts valid RUTs in any format', () => {
  for (const rut of ['33333333-3', '33.333.333-3', '333333333', '11111111-1', '12345678-5', '10000013-K', '10000013k']) {
    assert.equal(isValidRut(rut), true, rut);
  }
});

test('isValidRut rejects wrong check digits, wrong lengths and junk', () => {
  for (const rut of ['33333333-2', '11111111-2', '1234-5', '123456789012', '', 'abc', null, undefined, '1']) {
    assert.equal(isValidRut(rut), false, String(rut));
  }
});
