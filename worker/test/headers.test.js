import { describe, it, expect } from 'vitest';
import { call } from './helpers.js';

const expectSecurityHeaders = (res) => {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
};

describe('security headers', () => {
  it('are present on 404, 401 and error responses', async () => {
    expectSecurityHeaders(await call('GET', '/api/nope'));
    expectSecurityHeaders(await call('GET', '/api/me'));
    expectSecurityHeaders(await call('POST', '/api/login', { body: 'not json' }));
  });

  it('are present on the CORS preflight too', async () => {
    const res = await call('OPTIONS', '/api/login', {
      headers: { Origin: 'https://dante-frontend-ashen.vercel.app' },
    });
    expectSecurityHeaders(res);
  });
});
