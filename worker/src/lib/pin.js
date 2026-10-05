import { hashPin, getPepper, timingSafeEqualHex } from './crypto.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// Checks `pin` against `user` and updates the lockout counters.
// Returns 'ok', 'wrong' or 'locked'. A locked account is rejected even if the
// PIN is correct.
//
// The attempt is reserved with ONE atomic UPDATE *before* the PIN is compared.
// Concurrent requests therefore each take a numbered slot, and once the 5th
// slot is taken the row is locked and every other request is rejected without
// its PIN ever being checked. (Reading the counter first and writing it back
// afterwards lets parallel requests all see "0 failures" and all be checked.)
// An expired lock starts a fresh window (counter back to 1).
export async function verifyPin(env, user, pin) {
  const now = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();

  const reserved = await env.DB.prepare(
    `UPDATE users SET
       failed_attempts = CASE WHEN locked_until IS NOT NULL AND locked_until <= ?1
                              THEN 1 ELSE failed_attempts + 1 END,
       locked_until = CASE WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= ?1
                                      THEN 1 ELSE failed_attempts + 1 END) >= ?2
                           THEN ?3 ELSE NULL END
     WHERE rut = ?4 AND (locked_until IS NULL OR locked_until <= ?1)
     RETURNING failed_attempts`
  ).bind(now, MAX_FAILED_ATTEMPTS, lockedUntil, user.rut).first();

  if (!reserved) return 'locked';

  const valid =
    /^\d{4}$/.test(pin) &&
    timingSafeEqualHex(await hashPin(pin, user.salt, getPepper(env)), user.pin_hash);
  if (!valid) return 'wrong';

  // Success clears the counter, but never lifts a lock that a concurrent
  // request has just set.
  await env.DB.prepare(
    'UPDATE users SET failed_attempts = 0 WHERE rut = ? AND locked_until IS NULL'
  ).bind(user.rut).run();
  return 'ok';
}

// PINs that are guessed first: repeated digits (0000), straight runs (1234,
// 4321, 0123) and the last 4 digits of the user's RUT (the old default).
export function isWeakPin(pin, rut) {
  if (!/^\d{4}$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((step) => step === 0)) return true;
  if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) return true;
  return pin === String(rut).split('-')[0].slice(-4);
}
