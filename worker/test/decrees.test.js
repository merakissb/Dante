import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { call, resetDb, seedUser, loginAs } from './helpers.js';

const ANA = '11111111-1';
const BRUNO = '22222222-2';

beforeEach(async () => {
  await resetDb();
  await seedUser({ rut: ANA, name: 'Ana', pin: '7391' });
  await seedUser({ rut: BRUNO, name: 'Bruno', pin: '5150' });
});

const sign = (token, id, pin) =>
  call('POST', `/api/decrees/${id}/sign`, { token, body: { pin } });

describe('GET /api/decrees/:id', () => {
  it('requires a session', async () => {
    expect((await call('GET', '/api/decrees/DP-1')).status).toBe(401);
  });

  it('returns an empty record for a decree nobody has received', async () => {
    const token = await loginAs(ANA, '7391');
    const res = await call('GET', '/api/decrees/DP-2026', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'dp-2026', currentHolder: null, history: [] });
  });

  it('is blocked with pin_change_required while the PIN is the temporary one', async () => {
    await seedUser({ rut: '12345678-5', name: 'Temp', pin: '4455', mustChangePin: 1 });
    const token = await loginAs('12345678-5', '4455');
    const res = await call('GET', '/api/decrees/DP-1', { token });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('pin_change_required');
  });
});

describe('decree ID format: only DP-<digits> / dp-<digits>', () => {
  it('accepts upper and lower case and returns the canonical lowercase id', async () => {
    const token = await loginAs(ANA, '7391');
    for (const id of ['DP-1234', 'dp-1234', 'Dp-1234', 'DP-1', 'DP-12345678']) {
      const res = await call('GET', `/api/decrees/${id}`, { token });
      expect(res.status, id).toBe(200);
      expect((await res.json()).id).toBe(id.toLowerCase());
    }
  });

  it('rejects anything else with 400, never 500', async () => {
    const token = await loginAs(ANA, '7391');
    const bad = [
      '1234', 'DP1234', 'DP-', 'DP-12a', 'DP-123456789', 'XP-1234', 'DP-1234-5',
      'DP--1', 'DP-1.5', 'DP_1234', 'DP 1', 'DP<1>', '%E0%A4%A', 'a'.repeat(41),
    ];
    for (const id of bad) {
      const res = await call('GET', `/api/decrees/${id}`, { token });
      expect(res.status, id).toBe(400);
    }
    const signRes = await sign(token, '1234', '7391');
    expect(signRes.status).toBe(400);
  });

  it('DP-1234 and dp-1234 are the same decree: one holder, one history, stored in lowercase', async () => {
    const ana = await loginAs(ANA, '7391');
    const bruno = await loginAs(BRUNO, '5150');
    expect((await sign(ana, 'DP-1234', '7391')).status).toBe(200);
    expect((await sign(bruno, 'dp-1234', '5150')).status).toBe(200);

    for (const id of ['DP-1234', 'dp-1234']) {
      const view = await (await call('GET', `/api/decrees/${id}`, { token: ana })).json();
      expect(view.id).toBe('dp-1234');
      expect(view.currentHolder.rut).toBe(BRUNO);
      expect(view.history.map((h) => h.signerRut)).toEqual([BRUNO, ANA]);
    }
    const { results } = await env.DB.prepare('SELECT id FROM decrees').all();
    expect(results).toEqual([{ id: 'dp-1234' }]);
  });
});

describe('POST /api/decrees/:id/sign (confirm reception)', () => {
  it('records the logged-in user as the holder and keeps the history', async () => {
    const token = await loginAs(ANA, '7391');
    const res = await sign(token, 'DP-2026', '7391');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true, decreeId: 'dp-2026', currentHolder: { rut: ANA, name: 'Ana' },
    });
    const view = await (await call('GET', '/api/decrees/DP-2026', { token })).json();
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({ signerRut: ANA, signerName: 'Ana' });
  });

  it('keeps a chain of custody: the latest receiver becomes the holder', async () => {
    const ana = await loginAs(ANA, '7391');
    const bruno = await loginAs(BRUNO, '5150');
    await sign(ana, 'DP-9', '7391');
    await sign(bruno, 'DP-9', '5150');
    const view = await (await call('GET', '/api/decrees/DP-9', { token: ana })).json();
    expect(view.currentHolder.rut).toBe(BRUNO);
    expect(view.history.map((h) => h.signerRut)).toEqual([BRUNO, ANA]);
  });

  it('requires the PIN again even with a valid session', async () => {
    const token = await loginAs(ANA, '7391');
    expect((await sign(token, 'DP-1', undefined)).status).toBe(401);
    expect((await sign(token, 'DP-1', '0000')).status).toBe(401);
  });

  it('does not accept a reception after 5 wrong PINs even with the right one', async () => {
    const token = await loginAs(ANA, '7391');
    for (let i = 0; i < 5; i++) await sign(token, 'DP-1', '0000');
    expect((await sign(token, 'DP-1', '7391')).status).toBe(423);
  });

  it('requires a session', async () => {
    const res = await call('POST', '/api/decrees/DP-1/sign', { body: { pin: '7391' } });
    expect(res.status).toBe(401);
  });
});

describe('the last holder cannot confirm again', () => {
  it('answers 409 already_holder, adds nothing to the history and does not ask for the PIN', async () => {
    const token = await loginAs(ANA, '7391');
    expect((await sign(token, 'DP-1234', '7391')).status).toBe(200);

    const again = await sign(token, 'dp-1234', '7391');
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('already_holder');

    // Not even a wrong PIN is checked, so it cannot burn the account's attempts.
    const wrongPin = await sign(token, 'DP-1234', '0000');
    expect(wrongPin.status).toBe(409);
    const row = await env.DB.prepare('SELECT failed_attempts FROM users WHERE rut = ?').bind(ANA).first();
    expect(row.failed_attempts).toBe(0);

    const view = await (await call('GET', '/api/decrees/DP-1234', { token })).json();
    expect(view.history).toHaveLength(1);
  });

  it('can receive it again after somebody else took it (A, B, A)', async () => {
    const ana = await loginAs(ANA, '7391');
    const bruno = await loginAs(BRUNO, '5150');
    await sign(ana, 'DP-5', '7391');
    await sign(bruno, 'DP-5', '5150');
    expect((await sign(ana, 'DP-5', '7391')).status).toBe(200);
    const view = await (await call('GET', '/api/decrees/DP-5', { token: ana })).json();
    expect(view.history.map((h) => h.signerRut)).toEqual([ANA, BRUNO, ANA]);
  });

  it('simultaneous confirmations by the same person create exactly one entry', async () => {
    const token = await loginAs(ANA, '7391');
    const results = await Promise.all(
      Array.from({ length: 3 }, () => sign(token, 'DP-7', '7391'))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const view = await (await call('GET', '/api/decrees/DP-7', { token })).json();
    expect(view.history).toHaveLength(1);
  });
});
