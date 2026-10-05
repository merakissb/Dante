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

  it('accepts a RUT typed without the hyphen', async () => {
    const res = await call('POST', '/api/login', { body: { rut: '111111111', pin: '7391' } });
    expect(res.status).toBe(200);
  });

  it('still logs hostile text typed in the RUT field, truncated, when it has no usable digits', async () => {
    await call('POST', '/api/login', { body: { rut: '<script>alert</script>', pin: '0000' } });
    const [row] = await accessLog();
    expect(row.result).toBe('unknown_rut');
    expect(row.rut_attempted).toBe('<script>alert</script>'.slice(0, 20));
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
  it('changes the PIN and ends every session, including the current one', async () => {
    await seedUser({ rut: '22222222-2', name: 'New', pin: '5150', mustChangePin: 1 });
    const current = await loginAs('22222222-2', '5150');
    const other = await loginAs('22222222-2', '5150');
    const res = await call('POST', '/api/change-pin', {
      token: current,
      body: { currentPin: '5150', newPin: '8264' },
    });
    expect(res.status).toBe(200);

    // Both sessions are gone: the user must log in again with the new PIN.
    expect((await call('GET', '/api/me', { token: current })).status).toBe(401);
    expect((await call('GET', '/api/me', { token: other })).status).toBe(401);

    const fresh = await call('POST', '/api/login', { body: { rut: '22222222-2', pin: '8264' } });
    expect(fresh.status).toBe(200);
    expect((await fresh.json()).user.mustChangePin).toBe(false);
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

  it('rejects weak new PINs: repeated digits, sequences and the last 4 digits of the RUT', async () => {
    await seedUser({ rut: '10000013-K', name: 'Persona', pin: '7391' });
    const token = await loginAs('10000013-K', '7391');
    for (const newPin of ['0000', '7777', '1234', '4321', '0123', '9876', '0013']) {
      const res = await call('POST', '/api/change-pin', { token, body: { currentPin: '7391', newPin } });
      expect(res.status, `PIN ${newPin}`).toBe(400);
    }
    // Rejections do not end the session or change the PIN.
    expect((await call('GET', '/api/me', { token })).status).toBe(200);
    const ok = await call('POST', '/api/change-pin', { token, body: { currentPin: '7391', newPin: '8264' } });
    expect(ok.status).toBe(200);
  });

  it('requires a session', async () => {
    const res = await call('POST', '/api/change-pin', { body: { currentPin: '7391', newPin: '8264' } });
    expect(res.status).toBe(401);
  });
});

describe('lockout under concurrency', () => {
  it('parallel wrong PINs cannot bypass the lockout', async () => {
    const burst = await Promise.all(
      Array.from({ length: 40 }, () => call('POST', '/api/login', { body: { rut: ANA, pin: '2846' } }))
    );
    // Only 5 guesses may actually be checked; the rest must be rejected as locked.
    expect(burst.filter((r) => r.status === 401)).toHaveLength(5);
    expect(burst.filter((r) => r.status === 423)).toHaveLength(35);

    const right = await call('POST', '/api/login', { body: { rut: ANA, pin: '7391' } });
    expect(right.status).toBe(423);
  });

  it('parallel guesses that include the correct PIN still only check 5 PINs', async () => {
    const pins = ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '7391', '0008', '0009'];
    const burst = await Promise.all(
      pins.map((pin) => call('POST', '/api/login', { body: { rut: ANA, pin } }))
    );
    const checked = burst.filter((r) => r.status !== 423);
    expect(checked.length).toBeLessThanOrEqual(5);
  });

  it('after the lock expires, one wrong PIN starts a fresh window instead of re-locking', async () => {
    await env.DB.prepare(
      'UPDATE users SET failed_attempts = 5, locked_until = ? WHERE rut = ?'
    ).bind(new Date(Date.now() - 60000).toISOString(), ANA).run();

    const wrong = await call('POST', '/api/login', { body: { rut: ANA, pin: '2846' } });
    expect(wrong.status).toBe(401);
    const row = await env.DB.prepare('SELECT failed_attempts, locked_until FROM users WHERE rut = ?').bind(ANA).first();
    expect(row.failed_attempts).toBe(1);
    expect(row.locked_until).toBeNull();

    const right = await call('POST', '/api/login', { body: { rut: ANA, pin: '7391' } });
    expect(right.status).toBe(200);
  });
});
