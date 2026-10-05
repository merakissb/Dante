import { json, readJson } from '../lib/http.js';
import { normalizeRut } from '../lib/rut.js';
import { generateSalt, hashPin, hashToken, getPepper } from '../lib/crypto.js';
import { verifyPin } from '../lib/pin.js';
import { createSession, getBearerToken, logAccess } from '../lib/auth.js';

export function userView(user) {
  return {
    rut: user.rut,
    name: user.name,
    isAdmin: Boolean(user.is_admin),
    mustChangePin: Boolean(user.must_change_pin),
  };
}

const minutesLeft = (until) => Math.max(1, Math.ceil((new Date(until) - Date.now()) / 60000));

export async function login(request, env) {
  const body = await readJson(request);
  const rut = normalizeRut(body.rut);
  const pin = String(body.pin || '');
  const genericFailure = () => json({ error: 'RUT o PIN incorrecto' }, 401);

  const user = await env.DB.prepare('SELECT * FROM users WHERE rut = ?').bind(rut).first();
  if (!user) {
    await logAccess(env, request, rut, 'unknown_rut');
    return genericFailure();
  }
  if (!user.is_active) {
    await logAccess(env, request, rut, 'inactive_account');
    return genericFailure();
  }

  const outcome = await verifyPin(env, user, pin);
  if (outcome === 'locked') {
    await logAccess(env, request, rut, 'locked');
    return json(
      { error: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutesLeft(user.locked_until)} minutos.` },
      423
    );
  }
  if (outcome === 'wrong') {
    await logAccess(env, request, rut, 'wrong_pin');
    return genericFailure();
  }

  const { token, expiresAt } = await createSession(env, rut);
  await logAccess(env, request, rut, 'ok');
  return json({ token, expiresAt, user: userView(user) });
}

export async function logout(request, env) {
  const token = getBearerToken(request);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
  return json({ ok: true });
}

export async function me(request, env, { user }) {
  return json(userView(user));
}

export async function changePin(request, env, { user }) {
  const body = await readJson(request);
  const currentPin = String(body.currentPin || '');
  const newPin = String(body.newPin || '');

  if (!/^\d{4}$/.test(newPin)) return json({ error: 'El PIN nuevo debe tener 4 dígitos' }, 400);

  const outcome = await verifyPin(env, user, currentPin);
  if (outcome === 'locked') return json({ error: 'Cuenta bloqueada temporalmente' }, 423);
  if (outcome === 'wrong') return json({ error: 'PIN actual incorrecto' }, 401);

  if (newPin === currentPin) {
    return json({ error: 'El PIN nuevo debe ser distinto al actual' }, 400);
  }

  const salt = generateSalt();
  await env.DB.prepare('UPDATE users SET pin_hash = ?, salt = ?, must_change_pin = 0 WHERE rut = ?')
    .bind(await hashPin(newPin, salt, getPepper(env)), salt, user.rut)
    .run();
  return json({ ok: true });
}
