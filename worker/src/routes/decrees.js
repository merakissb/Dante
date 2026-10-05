import { json, readJson } from '../lib/http.js';
import { verifyPin } from '../lib/pin.js';

const DECREE_ID_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
const invalidId = () => json({ error: 'ID de decreto inválido' }, 400);

export async function getDecree(request, env, { params }) {
  const [decreeId] = params;
  if (!DECREE_ID_PATTERN.test(decreeId)) return invalidId();

  const decree = await env.DB.prepare(
    `SELECT d.id, d.current_holder, u.name AS holder_name
     FROM decrees d LEFT JOIN users u ON u.rut = d.current_holder
     WHERE d.id = ?`
  ).bind(decreeId).first();

  if (!decree) return json({ id: decreeId, currentHolder: null, history: [] });

  const { results } = await env.DB.prepare(
    `SELECT signer_rut, signer_name, signed_at
     FROM signatures WHERE decree_id = ? ORDER BY signed_at DESC, id DESC`
  ).bind(decreeId).all();

  return json({
    id: decree.id,
    currentHolder: decree.current_holder
      ? { rut: decree.current_holder, name: decree.holder_name }
      : null,
    history: results.map((r) => ({
      signerRut: r.signer_rut,
      signerName: r.signer_name,
      signedAt: r.signed_at,
    })),
  });
}

export async function signDecree(request, env, { user, params }) {
  const [decreeId] = params;
  if (!DECREE_ID_PATTERN.test(decreeId)) return invalidId();

  const body = await readJson(request);
  const outcome = await verifyPin(env, user, String(body.pin || ''));
  if (outcome === 'locked') return json({ error: 'Cuenta bloqueada temporalmente' }, 423);
  if (outcome === 'wrong') return json({ error: 'PIN incorrecto' }, 401);

  const signedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO decrees (id, current_holder) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET current_holder = excluded.current_holder`
  ).bind(decreeId, user.rut).run();

  await env.DB.prepare(
    `INSERT INTO signatures (decree_id, signer_rut, signer_name, signed_at)
     VALUES (?, ?, ?, ?)`
  ).bind(decreeId, user.rut, user.name, signedAt).run();

  return json({
    ok: true,
    decreeId,
    currentHolder: { rut: user.rut, name: user.name },
    signedAt,
  });
}
