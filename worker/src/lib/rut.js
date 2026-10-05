export function normalizeRut(value) {
  return String(value || '').replace(/\./g, '').replace(/\s/g, '').toUpperCase();
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
