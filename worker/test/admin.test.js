import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { call, resetDb, seedUser, loginAs, ADMIN_SECRET } from './helpers.js';

const ADMIN = '11111111-1';
const USER = '22222222-2';
const NEW_RUT = '12345678-5';

let adminToken;

beforeEach(async () => {
  await resetDb();
  await seedUser({ rut: ADMIN, name: 'Admin', pin: '7391', isAdmin: 1 });
  await seedUser({ rut: USER, name: 'Regular', pin: '5150' });
  adminToken = await loginAs(ADMIN, '7391');
});

describe('access control', () => {
  it('rejects a non-admin session with 403', async () => {
    const token = await loginAs(USER, '5150');
    expect((await call('GET', '/api/admin/users', { token })).status).toBe(403);
  });

  it('rejects anonymous callers with 401', async () => {
    expect((await call('GET', '/api/admin/users')).status).toBe(401);
  });

  it('accepts the ADMIN_SECRET emergency key', async () => {
    const res = await call('GET', '/api/admin/users', { token: ADMIN_SECRET });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong emergency key', async () => {
    expect((await call('GET', '/api/admin/users', { token: 'wrong-secret' })).status).toBe(401);
  });

  it('blocks an admin whose PIN change is still pending', async () => {
    await seedUser({ rut: '10000013-K', name: 'Pending', pin: '4455', isAdmin: 1, mustChangePin: 1 });
    const token = await loginAs('10000013-K', '4455');
    const res = await call('GET', '/api/admin/users', { token });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('pin_change_required');
  });
});

describe('GET /api/admin/users', () => {
  it('lists users without any secret material', async () => {
    const res = await call('GET', '/api/admin/users', { token: adminToken });
    const { users } = await res.json();
    expect(users.map((u) => u.rut)).toEqual(expect.arrayContaining([ADMIN, USER]));
    const dump = JSON.stringify(users);
    expect(dump).not.toContain('pin_hash');
    expect(dump).not.toContain('salt');
    expect(users.find((u) => u.rut === ADMIN)).toMatchObject({ isAdmin: true, isActive: true });
  });
});

describe('POST /api/admin/users', () => {
  it('creates a user with a random 4-digit temporary PIN that is not the RUT digits', async () => {
    const res = await call('POST', '/api/admin/users', {
      token: adminToken,
      body: { rut: '12.345.678-5', name: '  Nuevo Usuario ' },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, rut: NEW_RUT, name: 'Nuevo Usuario' });
    expect(data.tempPin).toMatch(/^\d{4}$/);
    expect(data.tempPin).not.toBe('5678');

    // The temporary PIN works for the first login and forces a change.
    const login = await call('POST', '/api/login', { body: { rut: NEW_RUT, pin: data.tempPin } });
    expect(login.status).toBe(200);
    expect((await login.json()).user.mustChangePin).toBe(true);
  });

  it('works through the emergency key too', async () => {
    const res = await call('POST', '/api/admin/users', {
      token: ADMIN_SECRET,
      body: { rut: NEW_RUT, name: 'Via Secret' },
    });
    expect(res.status).toBe(201);
  });

  it('rejects invalid RUT, empty or oversized name, and malformed bodies', async () => {
    const bodies = [
      { rut: '11111111-2', name: 'Bad DV' },
      { rut: NEW_RUT, name: '   ' },
      { rut: NEW_RUT, name: 'x'.repeat(101) },
      {},
    ];
    for (const body of bodies) {
      const res = await call('POST', '/api/admin/users', { token: adminToken, body });
      expect(res.status).toBe(400);
    }
    for (const body of ['not json', 'null', '[]']) {
      const res = await call('POST', '/api/admin/users', { token: adminToken, body });
      expect(res.status).toBe(400);
    }
  });

  it('simultaneous creations of the same RUT give exactly one 201 and 409s, never a 500', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        call('POST', '/api/admin/users', { token: adminToken, body: { rut: NEW_RUT, name: 'Race' } })
      )
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
  });

  it('answers 409 when the RUT already exists', async () => {
    const res = await call('POST', '/api/admin/users', {
      token: adminToken,
      body: { rut: USER, name: 'Dup' },
    });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/admin/users/:rut', () => {
  it('deactivates and reactivates a user; a deactivated user cannot log in', async () => {
    const off = await call('PATCH', `/api/admin/users/${USER}`, { token: adminToken, body: { isActive: false } });
    expect(off.status).toBe(200);
    expect((await call('POST', '/api/login', { body: { rut: USER, pin: '5150' } })).status).toBe(401);

    await call('PATCH', `/api/admin/users/${USER}`, { token: adminToken, body: { isActive: true } });
    expect((await call('POST', '/api/login', { body: { rut: USER, pin: '5150' } })).status).toBe(200);
  });

  it('deactivating a user ends their sessions for good: reactivating does not revive old tokens', async () => {
    const userToken = await loginAs(USER, '5150');
    await call('PATCH', `/api/admin/users/${USER}`, { token: adminToken, body: { isActive: false } });
    await call('PATCH', `/api/admin/users/${USER}`, { token: adminToken, body: { isActive: true } });
    expect((await call('GET', '/api/me', { token: userToken })).status).toBe(401);
  });

  it('refuses to let an admin deactivate themselves', async () => {
    const res = await call('PATCH', `/api/admin/users/${ADMIN}`, { token: adminToken, body: { isActive: false } });
    expect(res.status).toBe(400);
    expect((await call('GET', '/api/me', { token: adminToken })).status).toBe(200);
  });

  it('resets the PIN to a new temporary one, forces a change and kills sessions', async () => {
    const userToken = await loginAs(USER, '5150');
    const res = await call('PATCH', `/api/admin/users/${USER}`, { token: adminToken, body: { resetPin: true } });
    expect(res.status).toBe(200);
    const { tempPin } = await res.json();
    expect(tempPin).toMatch(/^\d{4}$/);

    expect((await call('GET', '/api/me', { token: userToken })).status).toBe(401);
    expect((await call('POST', '/api/login', { body: { rut: USER, pin: '5150' } })).status).toBe(401);
    const login = await call('POST', '/api/login', { body: { rut: USER, pin: tempPin } });
    expect(login.status).toBe(200);
    expect((await login.json()).user.mustChangePin).toBe(true);
  });

  it('clears a lockout when resetting the PIN', async () => {
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/login', { body: { rut: USER, pin: '0000' } });
    }
    const res = await call('PATCH', `/api/admin/users/${USER}`, { token: adminToken, body: { resetPin: true } });
    const { tempPin } = await res.json();
    expect((await call('POST', '/api/login', { body: { rut: USER, pin: tempPin } })).status).toBe(200);
  });

  it('answers 404 for an unknown RUT and 400 for malformed bodies', async () => {
    const missing = await call('PATCH', '/api/admin/users/12345678-5', { token: adminToken, body: { isActive: false } });
    expect(missing.status).toBe(404);
    for (const body of ['not json', 'null']) {
      const res = await call('PATCH', `/api/admin/users/${USER}`, { token: adminToken, body });
      expect(res.status).toBe(400);
    }
  });
});

describe('GET /api/admin/access-log', () => {
  it('lists attempts newest first, without PINs', async () => {
    await call('POST', '/api/login', { body: { rut: USER, pin: '9999' } });
    const res = await call('GET', '/api/admin/access-log', { token: adminToken });
    expect(res.status).toBe(200);
    const { entries } = await res.json();
    expect(entries[0]).toMatchObject({ rutAttempted: USER, result: 'wrong_pin' });
    expect(entries.map((e) => e.id)).toEqual([...entries.map((e) => e.id)].sort((a, b) => b - a));
    expect(JSON.stringify(entries)).not.toContain('9999');
  });

  it('paginates with limit and before, and clamps absurd limits', async () => {
    for (let i = 0; i < 4; i++) {
      await call('POST', '/api/login', { body: { rut: USER, pin: '9999' } });
    }
    const first = await (await call('GET', '/api/admin/access-log?limit=2', { token: adminToken })).json();
    expect(first.entries).toHaveLength(2);
    expect(first.nextBefore).toBe(first.entries[1].id);

    const second = await (
      await call('GET', `/api/admin/access-log?limit=2&before=${first.nextBefore}`, { token: adminToken })
    ).json();
    expect(second.entries.every((e) => e.id < first.nextBefore)).toBe(true);

    const huge = await call('GET', '/api/admin/access-log?limit=999999&before=abc', { token: adminToken });
    expect(huge.status).toBe(200);
  });
});

describe('sessions table hygiene', () => {
  it('removes expired sessions on the next login', async () => {
    await env.DB.prepare(
      'INSERT INTO sessions (token_hash, rut, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind('expiredhash', USER, '2020-01-01T00:00:00.000Z', '2020-01-01T08:00:00.000Z').run();
    await loginAs(USER, '5150');
    const row = await env.DB.prepare("SELECT 1 AS x FROM sessions WHERE token_hash = 'expiredhash'").first();
    expect(row).toBeNull();
  });
});
