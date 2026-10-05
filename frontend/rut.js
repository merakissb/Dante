'use strict';

// RUT helpers (same rules as the Worker's lib/rut.js).

// Keeps only digits and K, uppercased, at most 9 characters.
function cleanRut(value) {
  return String(value ?? '').replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
}

// "333333333" -> "33.333.333-3". Called on every keystroke of a RUT field.
function formatRut(value) {
  const clean = cleanRut(value);
  if (clean.length <= 1) return clean;
  const body = clean.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${body}-${clean.slice(-1)}`;
}

// True when the RUT has 7-8 digits and a correct check digit.
function isValidRut(value) {
  const clean = String(value ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 8 || clean.length > 9) return false;
  const body = clean.slice(0, -1);
  const checkDigit = clean.slice(-1);
  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return checkDigit === expected;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatRut, isValidRut };
}
