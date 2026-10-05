import { describe, it, expect } from 'vitest';
import { call } from './helpers.js';

const VERCEL = 'https://dante-frontend-ashen.vercel.app';

describe('CORS', () => {
  it('answers the preflight with 204 and allows the Vercel origin', async () => {
    const res = await call('OPTIONS', '/api/login', { headers: { Origin: VERCEL } });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(VERCEL);
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
  });

  it('does not grant CORS headers to other origins', async () => {
    const res = await call('OPTIONS', '/api/login', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS headers to normal responses for allowed origins', async () => {
    const res = await call('GET', '/api/nope', { headers: { Origin: 'http://localhost:8080' } });
    expect(res.status).toBe(404);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8080');
  });
});
