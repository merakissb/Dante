import { describe, it, expect, beforeEach } from 'vitest';
import { call, resetDb, seedUser, loginAs } from './helpers.js';

const ANA = '11111111-1';
const BRUNO = '22222222-2';

beforeEach(async () => {
  await resetDb();
  await seedUser({ rut: ANA, name: 'Ana', pin: '7391' });
  await seedUser({ rut: BRUNO, name: 'Bruno', pin: '5150' });
});

describe('GET /api/decrees/:id', () => {
  it('requires a session', async () => {
    expect((await call('GET', '/api/decrees/DP-1')).status).toBe(401);
  });

  it('returns an empty record for a decree nobody has signed', async () => {
    const token = await loginAs(ANA, '7391');
    const res = await call('GET', '/api/decrees/DP-2026-0001', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'DP-2026-0001', currentHolder: null, history: [] });
  });

  it('is blocked with pin_change_required while the PIN is the temporary one', async () => {
    await seedUser({ rut: '12345678-5', name: 'Temp', pin: '4455', mustChangePin: 1 });
    const token = await loginAs('12345678-5', '4455');
    const res = await call('GET', '/api/decrees/DP-1', { token });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('pin_change_required');
  });

  it('rejects malformed IDs with 400, never 500', async () => {
    const token = await loginAs(ANA, '7391');
    const bad = ['a'.repeat(41), 'DP 1', 'DP<1>', '%E0%A4%A'];
    for (const id of bad) {
      const res = await call('GET', `/api/decrees/${id}`, { token });
      expect(res.status).toBe(400);
    }
  });
});

describe('POST /api/decrees/:id/sign', () => {
  it('signs as the logged-in user, creates the decree, and records history', async () => {
    const token = await loginAs(ANA, '7391');
    const res = await call('POST', '/api/decrees/DP-2026-0001/sign', { token, body: { pin: '7391' } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, decreeId: 'DP-2026-0001', currentHolder: { rut: ANA, name: 'Ana' } });

    const view = await (await call('GET', '/api/decrees/DP-2026-0001', { token })).json();
    expect(view.currentHolder).toEqual({ rut: ANA, name: 'Ana' });
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({ signerRut: ANA, signerName: 'Ana' });
  });

  it('keeps a chain of custody: the latest signer becomes the holder', async () => {
    const ana = await loginAs(ANA, '7391');
    const bruno = await loginAs(BRUNO, '5150');
    await call('POST', '/api/decrees/DP-9/sign', { token: ana, body: { pin: '7391' } });
    await call('POST', '/api/decrees/DP-9/sign', { token: bruno, body: { pin: '5150' } });
    const view = await (await call('GET', '/api/decrees/DP-9', { token: ana })).json();
    expect(view.currentHolder.rut).toBe(BRUNO);
    expect(view.history.map((h) => h.signerRut)).toEqual([BRUNO, ANA]);
  });

  it('requires the PIN again even with a valid session', async () => {
    const token = await loginAs(ANA, '7391');
    const noPin = await call('POST', '/api/decrees/DP-1/sign', { token, body: {} });
    expect(noPin.status).toBe(401);
    const wrong = await call('POST', '/api/decrees/DP-1/sign', { token, body: { pin: '0000' } });
    expect(wrong.status).toBe(401);
  });

  it('does not sign a decree after 5 wrong PINs even with the right one', async () => {
    const token = await loginAs(ANA, '7391');
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/decrees/DP-1/sign', { token, body: { pin: '0000' } });
    }
    const res = await call('POST', '/api/decrees/DP-1/sign', { token, body: { pin: '7391' } });
    expect(res.status).toBe(423);
  });

  it('requires a session and a valid decree ID', async () => {
    expect((await call('POST', '/api/decrees/DP-1/sign', { body: { pin: '7391' } })).status).toBe(401);
    const token = await loginAs(ANA, '7391');
    const res = await call('POST', `/api/decrees/${'x'.repeat(41)}/sign`, { token, body: { pin: '7391' } });
    expect(res.status).toBe(400);
  });
});
