// Accepts a RUT in any common format (12.345.678-9, 12345678-9, 123456789, with
// spaces or a lowercase k) and returns the canonical "12345678-9". Anything that
// is not a digit or K is dropped.
export function normalizeRut(value) {
  const clean = String(value || '').replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return clean;
  return `${clean.slice(0, -1)}-${clean.slice(-1)}`;
}

export function isValidRut(rut) {
  if (!/^\d{7,8}-[\dK]$/.test(rut)) return false;
  const [body, checkDigit] = rut.split('-');
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
