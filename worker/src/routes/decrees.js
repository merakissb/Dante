import { json, readJson } from '../lib/http.js';
import { verifyPin } from '../lib/pin.js';
import { normalizeDecreeId } from '../lib/decree.js';

const invalidId = () => json({ error: 'ID de decreto inválido. Usa el formato DP-1234.' }, 400);
const alreadyHolder = () =>
  json({ code: 'already_holder', error: 'Ya tienes este decreto: tú fuiste el último en recibirlo.' }, 409);

export async function getDecree(request, env, { params }) {
  const decreeId = normalizeDecreeId(params[0]);
  if (!decreeId) return invalidId();

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
  const decreeId = normalizeDecreeId(params[0]);
  if (!decreeId) return invalidId();

  // The last receiver cannot confirm again. Checked before the PIN so it neither
  // asks for it nor counts against the account's attempts.
  const current = await env.DB.prepare('SELECT current_holder FROM decrees WHERE id = ?')
    .bind(decreeId).first();
  if (current && current.current_holder === user.rut) return alreadyHolder();

  const body = await readJson(request);
  const outcome = await verifyPin(env, user, String(body.pin || ''));
  if (outcome === 'locked') return json({ error: 'Cuenta bloqueada temporalmente' }, 423);
  if (outcome === 'wrong') return json({ error: 'PIN incorrecto' }, 401);

  const signedAt = new Date().toISOString();

  // Atomic: the holder only changes if it is somebody else. Two simultaneous
  // confirmations by the same person produce a single history entry.
  const taken = await env.DB.prepare(
    `INSERT INTO decrees (id, current_holder) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET current_holder = excluded.current_holder
     WHERE decrees.current_holder IS NOT excluded.current_holder`
  ).bind(decreeId, user.rut).run();
  if (taken.meta.changes === 0) return alreadyHolder();

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
