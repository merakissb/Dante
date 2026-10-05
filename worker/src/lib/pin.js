import { hashPin } from './crypto.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// Checks `pin` against `user` and updates the lockout counters.
// Returns 'ok', 'wrong' or 'locked'. A locked account is rejected even if the
// PIN is correct.
export async function verifyPin(env, user, pin) {
  if (user.locked_until && new Date(user.locked_until) > new Date()) return 'locked';

  const valid = /^\d{4}$/.test(pin) && (await hashPin(pin, user.salt)) === user.pin_hash;

  if (!valid) {
    const failedAttempts = user.failed_attempts + 1;
    const lockedUntil =
      failedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
        : null;
    await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE rut = ?')
      .bind(failedAttempts, lockedUntil, user.rut)
      .run();
    return 'wrong';
  }

  await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE rut = ?')
    .bind(user.rut)
    .run();
  return 'ok';
}
