import { json } from './lib/http.js';
import { withCors } from './lib/cors.js';
import { runGuard } from './lib/auth.js';
import { login, logout, me, changePin } from './routes/auth.js';
import { getDecree, signDecree } from './routes/decrees.js';
import { listUsers, createUser, updateUser, listAccessLog } from './routes/admin.js';

// guard: 'public' | 'session' | 'active' | 'admin'  (see lib/auth.js)
const routes = [
  { method: 'POST', pattern: /^\/api\/login$/, guard: 'public', handler: login },
  { method: 'POST', pattern: /^\/api\/logout$/, guard: 'session', handler: logout },
  { method: 'GET', pattern: /^\/api\/me$/, guard: 'session', handler: me },
  { method: 'POST', pattern: /^\/api\/change-pin$/, guard: 'session', handler: changePin },
  { method: 'GET', pattern: /^\/api\/decrees\/([^/]+)$/, guard: 'active', handler: getDecree },
  { method: 'POST', pattern: /^\/api\/decrees\/([^/]+)\/sign$/, guard: 'active', handler: signDecree },
  { method: 'GET', pattern: /^\/api\/admin\/users$/, guard: 'admin', handler: listUsers },
  { method: 'POST', pattern: /^\/api\/admin\/users$/, guard: 'admin', handler: createUser },
  { method: 'PATCH', pattern: /^\/api\/admin\/users\/([^/]+)$/, guard: 'admin', handler: updateUser },
  { method: 'GET', pattern: /^\/api\/admin\/access-log$/, guard: 'admin', handler: listAccessLog },
];

async function handle(request, env) {
  const { pathname } = new URL(request.url);

  for (const route of routes) {
    if (route.method !== request.method) continue;
    const match = pathname.match(route.pattern);
    if (!match) continue;

    let params;
    try {
      params = match.slice(1).map(decodeURIComponent);
    } catch {
      return json({ error: 'Solicitud inválida' }, 400);
    }

    const guard = await runGuard(route.guard, request, env);
    if (guard.response) return guard.response;
    return route.handler(request, env, { user: guard.user, params });
  }
  return json({ error: 'Not found' }, 404);
}

// API responses are private and never meant to be sniffed, cached or leaked
// through the Referer header.
function withSecurityHeaders(response) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return withSecurityHeaders(withCors(new Response(null, { status: 204 }), request));
    }
    try {
      return withSecurityHeaders(withCors(await handle(request, env), request));
    } catch (err) {
      console.error(err);
      return withSecurityHeaders(withCors(json({ error: 'Error interno' }, 500), request));
    }
  },
};
