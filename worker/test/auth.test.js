import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { call, resetDb, seedUser, loginAs } from './helpers.js';
import { hashToken } from '../src/lib/crypto.js';

const ANA = '11111111-1';

beforeEach(async () => {
  await resetDb();
  await seedUser({ rut: ANA, name: 'Ana', pin: '7391' });
});

async function accessLog() {
  const { results } = await env.DB.prepare('SELECT * FROM access_log ORDER BY id').all();
  return results;
}

describe('POST /api/login', () => {
  it('returns a token and the user on valid credentials', async () => {
    const res = await call('POST', '/api/login', { body: { rut: ANA, pin: '7391' } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(data.user).toEqual({ rut: ANA, name: 'Ana', isAdmin: false, mustChangePin: false });
    expect(Date.parse(data.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('accepts a RUT typed with dots and a lowercase check digit', async () => {
    await seedUser({ rut: '10000013-K', name: 'Kay', pin: '5150' });
    const res = await call('POST', '/api/login', { body: { rut: '10.000.013-k', pin: '5150' } });
    expect(res.status).toBe(200);
  });

  it('gives the same generic 401 for wrong PIN, unknown RUT and inactive account', async () => {
    await seedUser({ rut: '22222222-2', name: 'Off', pin: '5150', isActive: 0 });
    const attempts = [
      { rut: ANA, pin: '2846' },
      { rut: '12345678-5', pin: '7391' },
      { rut: '22222222-2', pin: '5150' },
    ];
    for (const body of attempts) {
      const res = await call('POST', '/api/login', { body });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'RUT o PIN incorrecto' });
    }
  });

  it('records each attempt with its result and never stores the PIN', async () => {
    await call('POST', '/api/login', {
      body: { rut: ANA, pin: '2846' },
      headers: { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'TestBrowser/1.0' },
    });
    await call('POST', '/api/login', { body: { rut: ANA, pin: '7391' } });
    await call('POST', '/api/login', { body: { rut: '12345678-5', pin: '2846' } });

    const log = await accessLog();
    expect(log.map((r) => r.result)).toEqual(['wrong_pin', 'ok', 'unknown_rut']);
    expect(log[0]).toMatchObject({ rut_attempted: ANA, ip: '203.0.113.9', user_agent: 'TestBrowser/1.0' });
    const dump = JSON.stringify(log);
    expect(dump).not.toContain('7391');
    expect(dump).not.toContain('2846');
  });

  it('locks the account after 5 wrong PINs, even if the 6th attempt is correct', async () => {
    for (let i = 0; i < 5; i++) {
      await call('POST', '/api/login', { body: { rut: ANA, pin: '2846' } });
    }
    const res = await call('POST', '/api/login', { body: { rut: ANA, pin: '7391' } });
    expect(res.status).toBe(423);
    expect((await accessLog()).at(-1).result).toBe('locked');
  });

  it('never answers 500 for a malformed body', async () => {
    for (const body of ['not json', 'null', '[1,2]', '42']) {
      const res = await call('POST', '/api/login', { body });
      expect(res.status).toBe(401);
    }
  });

  it('truncates hostile text before storing it in access_log', async () => {
    const hostile = `<img src=x onerror=alert(1)>${'A'.repeat(500)}`;
    await call('POST', '/api/login', {
      body: { rut: hostile, pin: '0000' },
      headers: { 'User-Agent': `<script>${'B'.repeat(500)}` },
    });
    const [row] = await accessLog();
    expect(row.rut_attempted.length).toBeLessThanOrEqual(20);
    expect(row.user_agent.length).toBeLessThanOrEqual(200);
  });
});

describe('sessions', () => {
  it('GET /api/me returns the logged-in user', async () => {
    const token = await loginAs(ANA, '7391');
    const res = await call('GET', '/api/me', { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rut: ANA, name: 'Ana', isAdmin: false, mustChangePin: false });
  });

  it('rejects requests without a token or with a made-up one', async () => {
    for (const token of [undefined, 'f'.repeat(64)]) {
      const res = await call('GET', '/api/me', { token });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe('session_expired');
    }
  });

  it('rejects an expired session', async () => {
    const token = 'a'.repeat(64);
    await env.DB.prepare(
      'INSERT INTO sessions (token_hash, rut, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(await hashToken(token), ANA, '2020-01-01T00:00:00.000Z', '2020-01-01T08:00:00.000Z').run();
    const res = await call('GET', '/api/me', { token });
    expect(res.status).toBe(401);
  });

  it('stops working when the user is deactivated', async () => {
    const token = await loginAs(ANA, '7391');
    await env.DB.prepare('UPDATE users SET is_active = 0 WHERE rut = ?').bind(ANA).run();
    expect((await call('GET', '/api/me', { token })).status).toBe(401);
  });

  it('POST /api/logout invalidates the token', async () => {
    const token = await loginAs(ANA, '7391');
    expect((await call('POST', '/api/logout', { token })).status).toBe(200);
    expect((await call('GET', '/api/me', { token })).status).toBe(401);
  });

  it('GET /api/me still works while a PIN change is pending', async () => {
    await seedUser({ rut: '22222222-2', name: 'New', pin: '5150', mustChangePin: 1 });
    const token = await loginAs('22222222-2', '5150');
    const res = await call('GET', '/api/me', { token });
    expect(res.status).toBe(200);
    expect((await res.json()).mustChangePin).toBe(true);
  });
});

describe('POST /api/change-pin', () => {
  it('changes the PIN, clears mustChangePin, and the new PIN logs in', async () => {
    await seedUser({ rut: '22222222-2', name: 'New', pin: '5150', mustChangePin: 1 });
    const token = await loginAs('22222222-2', '5150');
    const res = await call('POST', '/api/change-pin', {
      token,
      body: { currentPin: '5150', newPin: '8264' },
    });
    expect(res.status).toBe(200);
    expect((await (await call('GET', '/api/me', { token })).json()).mustChangePin).toBe(false);
    expect(await loginAs('22222222-2', '8264')).toMatch(/^[0-9a-f]{64}$/);
    const old = await call('POST', '/api/login', { body: { rut: '22222222-2', pin: '5150' } });
    expect(old.status).toBe(401);
  });

  it('rejects a wrong current PIN, a bad new PIN and an unchanged PIN', async () => {
    const token = await loginAs(ANA, '7391');
    const cases = [
      [{ currentPin: '0000', newPin: '8264' }, 401],
      [{ currentPin: '7391', newPin: '82' }, 400],
      [{ currentPin: '7391', newPin: 'abcd' }, 400],
      [{ currentPin: '7391', newPin: '7391' }, 400],
    ];
    for (const [body, status] of cases) {
      const res = await call('POST', '/api/change-pin', { token, body });
      expect(res.status).toBe(status);
    }
  });

  it('requires a session', async () => {
    const res = await call('POST', '/api/change-pin', { body: { currentPin: '7391', newPin: '8264' } });
    expect(res.status).toBe(401);
  });
});
