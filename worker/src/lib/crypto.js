const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

async function hmacSha256Hex(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return toHex(new Uint8Array(signature));
}

// The pepper is a Worker secret that never touches the database: a leaked copy
// of the DB alone cannot be used to brute-force the 10,000 possible PINs.
export function getPepper(env) {
  if (!env.PIN_PEPPER) throw new Error('PIN_PEPPER is not configured');
  return env.PIN_PEPPER;
}

export const hashPin = (pin, salt, pepper) => hmacSha256Hex(pepper, salt + pin);

// Compares two hex strings without bailing out on the first difference.
export function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function generateSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function generateToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export const hashToken = (token) => sha256Hex(token);

// Uniform 4-digit PIN using rejection sampling (no modulo bias).
function randomPin() {
  const range = 2 ** 32;
  const limit = range - (range % 10000);
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return String(buffer[0] % 10000).padStart(4, '0');
}

// `excludePin` keeps the temporary PIN from equalling the last 4 digits of
// the RUT (the old default). `draw` exists so tests can control the sequence.
export function generateTempPin(excludePin, draw = randomPin) {
  let pin = draw();
  while (pin === excludePin) pin = draw();
  return pin;
}
