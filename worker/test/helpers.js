import { env, exports } from 'cloudflare:workers';
import { generateSalt, hashPin } from '../src/lib/crypto.js';

export const ADMIN_SECRET = 'test-admin-secret';

export function call(method, path, { token, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return exports.default.fetch(new Request(`http://example.com${path}`, init));
}

export async function resetDb() {
  for (const table of ['signatures', 'decrees', 'sessions', 'access_log', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

export async function seedUser({
  rut,
  name = 'Test User',
  pin = '4321',
  isAdmin = 0,
  mustChangePin = 0,
  isActive = 1,
}) {
  const salt = generateSalt();
  const pinHash = await hashPin(pin, salt);
  await env.DB.prepare(
    `INSERT INTO users (rut, name, pin_hash, salt, is_active, must_change_pin, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(rut, name, pinHash, salt, isActive, mustChangePin, isAdmin).run();
}

export async function loginAs(rut, pin = '4321') {
  const res = await call('POST', '/api/login', { body: { rut, pin } });
  const data = await res.json();
  return data.token;
}
