import { json, readJson } from '../lib/http.js';
import { normalizeRut, isValidRut } from '../lib/rut.js';
import { generateSalt, hashPin, generateTempPin, getPepper } from '../lib/crypto.js';

const MAX_NAME_LENGTH = 100;
const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 500;

function userRow(row) {
  return {
    rut: row.rut,
    name: row.name,
    isActive: Boolean(row.is_active),
    isAdmin: Boolean(row.is_admin),
    mustChangePin: Boolean(row.must_change_pin),
    lockedUntil: row.locked_until,
  };
}

// The old default PIN was the last 4 digits of the RUT body; never reuse it.
const tempPinFor = (rut) => generateTempPin(rut.split('-')[0].slice(-4));

export async function listUsers(request, env) {
  const { results } = await env.DB.prepare(
    `SELECT rut, name, is_active, is_admin, must_change_pin, locked_until
     FROM users ORDER BY name`
  ).all();
  return json({ users: results.map(userRow) });
}

export async function createUser(request, env) {
  const body = await readJson(request);
  const rut = normalizeRut(body.rut);
  const name = String(body.name || '').trim();

  if (!isValidRut(rut)) return json({ error: 'RUT inválido' }, 400);
  if (!name) return json({ error: 'Nombre requerido' }, 400);
  if (name.length > MAX_NAME_LENGTH) return json({ error: 'Nombre demasiado largo' }, 400);

  const existing = await env.DB.prepare('SELECT 1 AS x FROM users WHERE rut = ?').bind(rut).first();
  if (existing) return json({ error: 'El usuario ya existe' }, 409);

  const tempPin = tempPinFor(rut);
  const salt = generateSalt();
  await env.DB.prepare(
    `INSERT INTO users (rut, name, pin_hash, salt, is_active, must_change_pin, is_admin)
     VALUES (?, ?, ?, ?, 1, 1, 0)`
  ).bind(rut, name, await hashPin(tempPin, salt, getPepper(env)), salt).run();

  return json({ ok: true, rut, name, tempPin }, 201);
}

export async function updateUser(request, env, { user, params }) {
  const rut = normalizeRut(params[0]);
  const body = await readJson(request);

  const target = await env.DB.prepare('SELECT rut FROM users WHERE rut = ?').bind(rut).first();
  if (!target) return json({ error: 'Usuario no encontrado' }, 404);

  const hasIsActive = typeof body.isActive === 'boolean';
  const wantsReset = body.resetPin === true;
  if (!hasIsActive && !wantsReset) return json({ error: 'Nada que actualizar' }, 400);

  if (hasIsActive && !body.isActive && user && user.rut === rut) {
    return json({ error: 'No puedes desactivarte a ti mismo' }, 400);
  }

  if (hasIsActive) {
    await env.DB.prepare('UPDATE users SET is_active = ? WHERE rut = ?')
      .bind(body.isActive ? 1 : 0, rut)
      .run();
  }

  const result = { ok: true };
  if (wantsReset) {
    const tempPin = tempPinFor(rut);
    const salt = generateSalt();
    await env.DB.prepare(
      `UPDATE users
       SET pin_hash = ?, salt = ?, must_change_pin = 1, failed_attempts = 0, locked_until = NULL
       WHERE rut = ?`
    ).bind(await hashPin(tempPin, salt, getPepper(env)), salt, rut).run();
    await env.DB.prepare('DELETE FROM sessions WHERE rut = ?').bind(rut).run();
    result.tempPin = tempPin;
  }
  return json(result);
}

export async function listAccessLog(request, env) {
  const url = new URL(request.url);
  const requested = parseInt(url.searchParams.get('limit'), 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT);
  const beforeParam = parseInt(url.searchParams.get('before'), 10);
  const before = Number.isFinite(beforeParam) ? beforeParam : Number.MAX_SAFE_INTEGER;

  const { results } = await env.DB.prepare(
    `SELECT id, rut_attempted, result, ip, user_agent, created_at
     FROM access_log WHERE id < ? ORDER BY id DESC LIMIT ?`
  ).bind(before, limit).all();

  const entries = results.map((r) => ({
    id: r.id,
    rutAttempted: r.rut_attempted,
    result: r.result,
    ip: r.ip,
    userAgent: r.user_agent,
    createdAt: r.created_at,
  }));
  return json({
    entries,
    nextBefore: entries.length === limit ? entries[entries.length - 1].id : null,
  });
}
