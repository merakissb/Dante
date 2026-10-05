import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:workers';
import { call, resetDb, seedUser } from './helpers.js';

const ANA = '11111111-1';
const IP = '203.0.113.50';

async function recordFailures(ip, count, ageMinutes = 1, result = 'unknown_rut') {
  const createdAt = new Date(Date.now() - ageMinutes * 60000).toISOString();
  for (let i = 0; i < count; i++) {
    await env.DB.prepare(
      'INSERT INTO access_log (rut_attempted, result, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind('99999999-9', result, ip, null, createdAt).run();
  }
}

const login = (ip, pin = '7391') =>
  call('POST', '/api/login', {
    body: { rut: ANA, pin },
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  });

beforeEach(async () => {
  await resetDb();
  await seedUser({ rut: ANA, name: 'Ana', pin: '7391' });
});

describe('per-IP login throttle', () => {
  it('allows logins while an IP is under the failure limit', async () => {
    await recordFailures(IP, 29);
    expect((await login(IP)).status).toBe(200);
  });

  it('answers 429 after 30 failed attempts from one IP, even with the correct PIN', async () => {
    await recordFailures(IP, 30);
    const res = await login(IP);
    expect(res.status).toBe(429);
    const log = await env.DB.prepare('SELECT result FROM access_log ORDER BY id DESC LIMIT 1').first();
    expect(log.result).toBe('throttled');
  });

  it('does not affect other IPs', async () => {
    await recordFailures(IP, 30);
    expect((await login('198.51.100.7')).status).toBe(200);
  });

  it('forgets failures older than 15 minutes', async () => {
    await recordFailures(IP, 30, 16);
    expect((await login(IP)).status).toBe(200);
  });

  it('counts wrong PINs, locked and inactive attempts, but not successful logins', async () => {
    await recordFailures(IP, 30, 1, 'ok');
    expect((await login(IP)).status).toBe(200);
  });

  it('does not throttle when the IP is unknown', async () => {
    await recordFailures(null, 40);
    expect((await login(null)).status).toBe(200);
  });
});
