import { json, readJson } from '../lib/http.js';
import { normalizeRut } from '../lib/rut.js';
import { generateSalt, hashPin, hashToken, getPepper } from '../lib/crypto.js';
import { verifyPin, isWeakPin } from '../lib/pin.js';
import { isIpThrottled } from '../lib/throttle.js';
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

// Used to spend the same hashing time on RUTs that do not exist, so response
// timing does not reveal which RUTs are registered.
const DUMMY_SALT = '00000000000000000000000000000000';

export async function login(request, env) {
  if (await isIpThrottled(env, request.headers.get('CF-Connecting-IP'))) {
    await logAccess(env, request, 'throttled', 'throttled');
    return json({ error: 'Demasiados intentos desde tu red. Intenta de nuevo en unos minutos.' }, 429);
  }

  const body = await readJson(request);
  const rut = normalizeRut(body.rut);
  const pin = String(body.pin || '');
  const genericFailure = () => json({ error: 'RUT o PIN incorrecto' }, 401);

  const user = await env.DB.prepare('SELECT * FROM users WHERE rut = ?').bind(rut).first();
  if (!user) {
    await hashPin(pin, DUMMY_SALT, getPepper(env));
    await logAccess(env, request, rut, 'unknown_rut');
    return genericFailure();
  }
  if (!user.is_active) {
    await hashPin(pin, DUMMY_SALT, getPepper(env));
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
  if (isWeakPin(newPin, user.rut)) {
    return json(
      { error: 'Ese PIN es muy fácil de adivinar (repetido, secuencia o parte de tu RUT). Elige otro.' },
      400
    );
  }

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
  // A credential change ends every session, including this one: the user logs
  // in again with the new PIN.
  await env.DB.prepare('DELETE FROM sessions WHERE rut = ?').bind(user.rut).run();
  return json({ ok: true });
}
