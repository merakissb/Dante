import { json } from './http.js';
import { generateToken, hashToken, sha256Hex, timingSafeEqualHex } from './crypto.js';

export const SESSION_HOURS = 8;

export function getBearerToken(request) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

export async function createSession(env, rut) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000).toISOString();

  // Opportunistic cleanup of expired sessions.
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()).run();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, rut, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(await hashToken(token), rut, now.toISOString(), expiresAt).run();

  return { token, expiresAt };
}

// Returns the active user that owns a valid, unexpired session, or null.
export async function findSessionUser(env, request) {
  const token = getBearerToken(request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.rut = s.rut
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`
  ).bind(await hashToken(token), new Date().toISOString()).first();
}

// Never store the PIN here. `rutAttempted` is attacker-controlled, so it is truncated.
export async function logAccess(env, request, rutAttempted, result) {
  const userAgent = (request.headers.get('User-Agent') || '').slice(0, 200);
  await env.DB.prepare(
    `INSERT INTO access_log (rut_attempted, result, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    String(rutAttempted).slice(0, 20),
    result,
    request.headers.get('CF-Connecting-IP'),
    userAgent || null,
    new Date().toISOString()
  ).run();
}

async function isAdminSecret(request, env) {
  const token = getBearerToken(request);
  if (!token || !env.ADMIN_SECRET) return false;
  const [a, b] = await Promise.all([sha256Hex(token), sha256Hex(env.ADMIN_SECRET)]);
  return timingSafeEqualHex(a, b);
}

// Guards:
//   public  - no credentials
//   session - any valid session (even with a pending PIN change)
//   active  - valid session and no pending PIN change
//   admin   - active admin session, or the ADMIN_SECRET emergency key (user = null)
export async function runGuard(guard, request, env) {
  if (guard === 'public') return { user: null };

  const user = await findSessionUser(env, request);

  if (!user) {
    if (guard === 'admin' && (await isAdminSecret(request, env))) return { user: null };
    return { response: json({ code: 'session_expired', error: 'Sesión expirada' }, 401) };
  }
  if (guard !== 'session' && user.must_change_pin) {
    return {
      response: json(
        { code: 'pin_change_required', error: 'Debes cambiar tu PIN antes de continuar' },
        403
      ),
    };
  }
  if (guard === 'admin' && !user.is_admin) {
    return { response: json({ error: 'No autorizado' }, 403) };
  }
  return { user };
}
