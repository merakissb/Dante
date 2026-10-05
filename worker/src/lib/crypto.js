const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export const hashPin = (pin, salt) => sha256Hex(salt + pin);

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
