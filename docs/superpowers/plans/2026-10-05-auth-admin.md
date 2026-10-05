# Login, rol admin y auditoría de accesos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Login con RUT + PIN y sesión en D1, rol admin con panel (crear/desactivar/resetear usuarios, ver accesos), PIN inicial aleatorio con botón copiar, y todo el modelo/código renombrado a inglés.

**Architecture:** El Worker se divide en módulos pequeños (`lib/` para utilidades, `routes/` para handlers, `index.js` como router con "guards" de acceso). Las sesiones son tokens aleatorios cuyo SHA-256 se guarda en la tabla `sessions`. El frontend pasa a `index.html` + `app.js` (JS vanilla), con tres vistas: login, decretos y admin.

**Tech Stack:** Cloudflare Workers + D1 (JS ESM), Vitest 4 + `@cloudflare/vitest-pool-workers` 0.22 para pruebas, Docker (`node:22-slim` + npm 11) para correr todo, HTML/CSS/JS estático en Vercel.

**Spec:** `docs/superpowers/specs/2026-10-05-auth-admin-design.md`

## Global Constraints

- Todo lo técnico en inglés: tablas en plural y columnas `snake_case`; JS `camelCase`; rutas y claves JSON (`camelCase`) en inglés. Solo los textos visibles al usuario van en español.
- Nada se instala en la máquina del usuario: node, npm, wrangler y vitest corren solo dentro de Docker. `node_modules` vive en un volumen nombrado.
- **Nunca** guardar PINs (ni correctos ni incorrectos) en `access_log` ni en logs.
- Sesión: 8 horas. Bloqueo: 5 intentos fallidos → 15 minutos. PIN: exactamente 4 dígitos.
- Login siempre responde `401 { error: "RUT o PIN incorrecto" }` salvo bloqueo (`423`).
- Sesión inválida/vencida: `401 { code: "session_expired" }`. Con `must_change_pin = 1`: `403 { code: "pin_change_required" }` en todo salvo `me`, `change-pin`, `logout`. Sin permiso admin: `403`.
- `ADMIN_SECRET` sigue valiendo como llave de emergencia, solo en `/api/admin/*`.
- CORS: orígenes `https://dante-frontend-ashen.vercel.app`, `http://localhost:8080`, `http://127.0.0.1:8080`.
- Worker de producción: `https://decretos-firma-api.dfuentes-e72.workers.dev`. D1 `decretos_firma_db`, id `9c078beb-7465-41f5-93c3-3d076306b0ad`.
- Credenciales de Cloudflare en `/home/meraki/dante/.env` (`WORKER_TOKEN`, `ADMIN_SECRET_PROD`). **Nunca imprimirlas** ni pasarlas por argumentos de comando; usar `set -a && . ./.env && set +a && export CLOUDFLARE_API_TOKEN="$WORKER_TOKEN"`.
- Commits terminan con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Trabajo en la rama `feat/auth-admin`; no pushear a `main` hasta la Task 8.

## Enmiendas a la spec (decididas al planificar)

1. `schema.sql` se elimina: las migraciones (`worker/migrations/`) son la única fuente de verdad (evita dos esquemas que se desincronicen). `0000_initial.sql` reproduce el esquema antiguo con `IF NOT EXISTS`, para que sea inocua en la base remota que ya existe.
2. El 500 deja de filtrar `detalle: String(err)`; se registra con `console.error` y se responde `{ error: "Error interno" }`.
3. Se valida el ID de decreto (`/^[A-Za-z0-9._-]{1,40}$/`), porque hoy acepta cualquier cosa.
4. `access_log.rut_attempted` se trunca a 20 caracteres (el campo es controlado por el atacante).
5. Resetear el PIN o cerrar sesión borra las sesiones del usuario.

## Review Focus

Entradas/condiciones que la spec no nombra pero que más probablemente fallen; cada una tiene su prueba en la task indicada.

1. **Texto hostil en RUT o User-Agent** (`<img onerror=…>`) queda en `access_log` y se muestra al admin → truncado en el servidor (Task 3) y `escapeHtml` en el frontend (Task 6, prueba manual con payload).
2. **Cuerpo que no es JSON, `null`, un array o está vacío** → nunca 500 (Tasks 3 y 5).
3. **ID de decreto enorme, con caracteres raros o con `%` mal formado** → 400, no 500 (Task 4).
4. **Invalidación de sesión:** token vencido, usuario desactivado, PIN reseteado por admin, logout → 401 (Tasks 3 y 5).
5. **Duplicados y autolesiones:** crear un RUT que ya existe → 409; admin desactivándose a sí mismo → 400; 6.º intento con el PIN correcto tras 5 fallos → sigue bloqueado (Tasks 3 y 5).

## Estructura de archivos

```
worker/
  package.json                 (nuevo) dependencias de desarrollo
  Dockerfile.dev               (nuevo) node:22-slim + npm 11
  vitest.config.js             (nuevo)
  wrangler.toml                (mod)   migrations_dir
  migrations/0000_initial.sql  (nuevo) esquema antiguo, idempotente
  migrations/0001_english_names_auth.sql (nuevo)
  schema.sql                   (borrar)
  seed-local.sh                (reescribir)
  src/index.js                 (reescribir) router + CORS + errores
  src/lib/http.js              (nuevo) json(), readJson()
  src/lib/cors.js              (nuevo) withCors()
  src/lib/rut.js               (nuevo) normalizeRut(), isValidRut()
  src/lib/crypto.js            (nuevo) hashes, salt, token, PIN temporal
  src/lib/pin.js               (nuevo) verifyPin() con bloqueo
  src/lib/auth.js              (nuevo) sesiones, guards, logAccess()
  src/routes/auth.js           (nuevo) login, logout, me, changePin
  src/routes/decrees.js        (nuevo) getDecree, signDecree
  src/routes/admin.js          (nuevo) users + access log
  test/helpers.js, test/apply-migrations.js, test/*.test.js
frontend/
  index.html                   (mod) markup + CSS
  app.js                       (nuevo) toda la lógica
docker-compose.yml             (mod)
README.md                      (reescribir)
```

---

### Task 1: Infraestructura de pruebas y migraciones

**Files:**
- Create: `worker/package.json`, `worker/Dockerfile.dev`, `worker/vitest.config.js`, `worker/test/apply-migrations.js`, `worker/test/helpers.js`, `worker/test/schema.test.js`, `worker/migrations/0000_initial.sql`, `worker/migrations/0001_english_names_auth.sql`
- Modify: `worker/wrangler.toml`, `docker-compose.yml`
- Delete: `worker/schema.sql`

**Interfaces:**
- Produces: `docker compose run --rm test` ejecuta Vitest dentro de Docker. `test/helpers.js` exporta `call(method, path, { token, body, headers })`, `resetDb()`, `seedUser({ rut, name, pin, isAdmin, mustChangePin, isActive })`, `loginAs(rut, pin)`, `ADMIN_SECRET`. Binding de pruebas `ADMIN_SECRET = 'test-admin-secret'`.
- Consumes: nada.

- [ ] **Step 1: Crear `worker/package.json`**

```json
{
  "name": "decretos-firma-api",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.22.0",
    "vitest": "^4.1.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Crear `worker/Dockerfile.dev`** (npm 10 falla al instalar estas dependencias; npm 11 funciona)

```dockerfile
FROM node:22-slim
RUN npm install -g npm@11
WORKDIR /app/worker
```

- [ ] **Step 3: Crear `worker/vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, ADMIN_SECRET: 'test-admin-secret' },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.js'],
      fileParallelism: false,
    },
  };
});
```

- [ ] **Step 4: Crear `worker/test/apply-migrations.js`**

```js
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 5: Agregar `migrations_dir` a `worker/wrangler.toml`**

Dejar el bloque D1 así (el `database_id` ya es el real):

```toml
[[d1_databases]]
binding = "DB"
database_name = "decretos_firma_db"
database_id = "9c078beb-7465-41f5-93c3-3d076306b0ad"
migrations_dir = "migrations"
```

- [ ] **Step 6: Crear `worker/migrations/0000_initial.sql`** (esquema antiguo; en la base remota las tablas ya existen, así que no hace nada)

```sql
CREATE TABLE IF NOT EXISTS usuarios (
  rut TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  requiere_cambio_pin INTEGER NOT NULL DEFAULT 1,
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT
);

CREATE TABLE IF NOT EXISTS decretos (
  id TEXT PRIMARY KEY,
  tenedor_actual TEXT,
  FOREIGN KEY (tenedor_actual) REFERENCES usuarios(rut)
);

CREATE TABLE IF NOT EXISTS firmas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decreto_id TEXT NOT NULL,
  rut_firmante TEXT NOT NULL,
  nombre_firmante TEXT NOT NULL,
  fecha_hora TEXT NOT NULL,
  FOREIGN KEY (decreto_id) REFERENCES decretos(id)
);

CREATE INDEX IF NOT EXISTS idx_firmas_decreto ON firmas(decreto_id);
```

- [ ] **Step 7: Crear `worker/migrations/0001_english_names_auth.sql`**

```sql
-- users
ALTER TABLE usuarios RENAME TO users;
ALTER TABLE users RENAME COLUMN nombre TO name;
ALTER TABLE users RENAME COLUMN activo TO is_active;
ALTER TABLE users RENAME COLUMN requiere_cambio_pin TO must_change_pin;
ALTER TABLE users RENAME COLUMN intentos_fallidos TO failed_attempts;
ALTER TABLE users RENAME COLUMN bloqueado_hasta TO locked_until;
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- decrees
ALTER TABLE decretos RENAME TO decrees;
ALTER TABLE decrees RENAME COLUMN tenedor_actual TO current_holder;

-- signatures
ALTER TABLE firmas RENAME TO signatures;
ALTER TABLE signatures RENAME COLUMN decreto_id TO decree_id;
ALTER TABLE signatures RENAME COLUMN rut_firmante TO signer_rut;
ALTER TABLE signatures RENAME COLUMN nombre_firmante TO signer_name;
ALTER TABLE signatures RENAME COLUMN fecha_hora TO signed_at;
DROP INDEX IF EXISTS idx_firmas_decreto;
CREATE INDEX IF NOT EXISTS idx_signatures_decree ON signatures(decree_id);

-- the first admin
UPDATE users SET is_admin = 1 WHERE rut = '19572933-6';

-- sessions: one row per active login; only the SHA-256 of the token is stored
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  rut TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (rut) REFERENCES users(rut)
);
CREATE INDEX idx_sessions_rut ON sessions(rut);

-- audit trail of every login attempt. NEVER store the PIN here.
CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rut_attempted TEXT NOT NULL,
  result TEXT NOT NULL,   -- ok | wrong_pin | locked | unknown_rut | inactive_account
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_access_log_created_at ON access_log(created_at);
```

- [ ] **Step 8: Crear `worker/test/helpers.js`** (importa `src/lib/crypto.js`, que se crea en la Task 2; por eso esta task termina con solo `schema.test.js`, que no usa el helper)

```js
import { env, exports } from 'cloudflare:workers';
import { generateSalt, hashPin } from '../src/lib/crypto.js';

export const ADMIN_SECRET = 'test-admin-secret';

export function call(method, path, { token, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return exports.default.fetch(new Request(`http://example.com${path}`, init));
}

export async function resetDb() {
  for (const table of ['signatures', 'decrees', 'sessions', 'access_log', 'users']) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

export async function seedUser({
  rut,
  name = 'Test User',
  pin = '4321',
  isAdmin = 0,
  mustChangePin = 0,
  isActive = 1,
}) {
  const salt = generateSalt();
  const pinHash = await hashPin(pin, salt);
  await env.DB.prepare(
    `INSERT INTO users (rut, name, pin_hash, salt, is_active, must_change_pin, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(rut, name, pinHash, salt, isActive, mustChangePin, isAdmin).run();
}

export async function loginAs(rut, pin = '4321') {
  const res = await call('POST', '/api/login', { body: { rut, pin } });
  const data = await res.json();
  return data.token;
}
```

- [ ] **Step 9: Escribir la prueba de esquema `worker/test/schema.test.js`** (falla hasta que existan las migraciones y se pueda correr)

```js
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';

async function columns(table) {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  return results.map((r) => r.name);
}

describe('schema after migrations', () => {
  it('users has English columns plus is_admin', async () => {
    expect(await columns('users')).toEqual(
      expect.arrayContaining([
        'rut', 'name', 'pin_hash', 'salt', 'is_active',
        'must_change_pin', 'failed_attempts', 'locked_until', 'is_admin',
      ])
    );
  });

  it('decrees and signatures use English names', async () => {
    expect(await columns('decrees')).toEqual(['id', 'current_holder']);
    expect(await columns('signatures')).toEqual(
      ['id', 'decree_id', 'signer_rut', 'signer_name', 'signed_at']
    );
  });

  it('sessions and access_log exist, and access_log has no pin column', async () => {
    expect(await columns('sessions')).toEqual(['token_hash', 'rut', 'created_at', 'expires_at']);
    const log = await columns('access_log');
    expect(log).toEqual(['id', 'rut_attempted', 'result', 'ip', 'user_agent', 'created_at']);
    expect(log.some((c) => c.includes('pin'))).toBe(false);
  });

  it('old Spanish tables are gone', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all();
    const names = results.map((r) => r.name);
    expect(names).not.toContain('usuarios');
    expect(names).not.toContain('decretos');
    expect(names).not.toContain('firmas');
  });
});
```

- [ ] **Step 10: Reescribir `docker-compose.yml`**

```yaml
# Entorno local 100% en Docker: nada se instala en tu máquina.
#   docker compose up -d                 -> API en :8787, frontend en :8080
#   docker compose run --rm test         -> corre las pruebas del Worker
#   docker compose down -v               -> borra todo (contenedores + base local)
services:
  api:
    build:
      context: ./worker
      dockerfile: Dockerfile.dev
    working_dir: /app/worker
    volumes:
      - ./worker:/app/worker
      - worker-node-modules:/app/worker/node_modules
      # El estado local de D1 vive en un volumen, no en tu carpeta.
      - wrangler-state:/app/worker/.wrangler
    ports:
      - "8787:8787"
    environment:
      CI: "true"
      WRANGLER_SEND_METRICS: "false"
      ADMIN_SECRET: "un-secreto-cualquiera-para-pruebas-locales"
    command: >
      sh -c "npm install --no-audit --no-fund &&
             npx wrangler d1 migrations apply decretos_firma_db --local &&
             npx wrangler dev --ip 0.0.0.0 --port 8787 --var ADMIN_SECRET:$$ADMIN_SECRET"

  test:
    profiles: ["test"]
    build:
      context: ./worker
      dockerfile: Dockerfile.dev
    working_dir: /app/worker
    volumes:
      - ./worker:/app/worker
      - worker-node-modules:/app/worker/node_modules
      - test-wrangler:/app/worker/.wrangler
    environment:
      CI: "true"
      WRANGLER_SEND_METRICS: "false"
    command: sh -c "npm install --no-audit --no-fund && npx vitest run"

  web:
    image: nginx:alpine
    volumes:
      - ./frontend:/usr/share/nginx/html:ro
    ports:
      - "8080:80"

volumes:
  wrangler-state:
  worker-node-modules:
  test-wrangler:
```

- [ ] **Step 11: Borrar `worker/schema.sql`**

Run: `git rm worker/schema.sql`

- [ ] **Step 12: Correr la prueba de esquema y verificar que pasa**

Run: `docker compose down && docker compose run --rm test sh -c "npm install --no-audit --no-fund && npx vitest run test/schema.test.js"`
Expected: PASS, 4 tests en `schema.test.js`. (`helpers.js` no se carga porque `schema.test.js` no lo importa; la primera ejecución instala dependencias y tarda unos minutos.) Si falla `npm install` con `edgesOut`, el contenedor no está usando `Dockerfile.dev` (npm 10): reconstruir con `docker compose build test`.

- [ ] **Step 13: Verificar que la migración conserva los datos reales de la base local de desarrollo**

La base local (volumen `wrangler-state`) fue creada con el esquema antiguo e incluye a Ana y Bruno.

Run:
```bash
docker compose up -d --build api
sleep 60
docker compose logs api | grep -i -E "migrat|error" | head
docker compose exec -T api npx wrangler d1 execute decretos_firma_db --local --command "SELECT rut, name, is_active, must_change_pin, is_admin FROM users"
```
Expected: log con `0000_initial.sql` y `0001_english_names_auth.sql` aplicadas sin error, y la consulta lista `11111111-1 Ana Prueba` y `22222222-2 Bruno Prueba` con `is_active = 1`, `must_change_pin = 1`, `is_admin = 0`. Esto prueba que `RENAME` conserva filas y que las claves foráneas siguen válidas. Si falla un `RENAME`, **parar y reportar** (no seguir con el resto del plan).

- [ ] **Step 14: Commit**

```bash
git add worker/package.json worker/Dockerfile.dev worker/vitest.config.js worker/wrangler.toml worker/migrations worker/test docker-compose.yml
git commit -m "Agrega pruebas en Docker y migraciones (nombres en inglés, sessions, access_log)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Utilidades del Worker (`lib/`)

**Files:**
- Create: `worker/src/lib/http.js`, `worker/src/lib/cors.js`, `worker/src/lib/rut.js`, `worker/src/lib/crypto.js`, `worker/src/lib/pin.js`
- Test: `worker/test/rut.test.js`, `worker/test/crypto.test.js`, `worker/test/cors.test.js` (este último se ejecuta en la Task 3, cuando exista el router)

**Interfaces:**
- Produces:
  - `http.js`: `json(data, status = 200): Response`, `readJson(request): Promise<object>` (siempre un objeto plano; `{}` si el cuerpo no es JSON, es `null`, número o array).
  - `cors.js`: `ALLOWED_ORIGINS: string[]`, `withCors(response, request): Response`.
  - `rut.js`: `normalizeRut(value): string`, `isValidRut(rut): boolean`.
  - `crypto.js`: `sha256Hex(text): Promise<string>`, `hashPin(pin, salt): Promise<string>`, `generateSalt(): string`, `generateToken(): string` (64 hex), `hashToken(token): Promise<string>`, `generateTempPin(excludePin?: string, draw?: () => string): string`.
  - `pin.js`: `MAX_FAILED_ATTEMPTS = 5`, `LOCK_MINUTES = 15`, `verifyPin(env, user, pin): Promise<'ok' | 'wrong' | 'locked'>` (actualiza `failed_attempts`/`locked_until`).

- [ ] **Step 1: Escribir las pruebas `worker/test/rut.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { normalizeRut, isValidRut } from '../src/lib/rut.js';

describe('normalizeRut', () => {
  it('removes dots and spaces and uppercases the check digit', () => {
    expect(normalizeRut('19.572.933-6')).toBe('19572933-6');
    expect(normalizeRut(' 10.000.013-k ')).toBe('10000013-K');
  });
  it('returns an empty string for null or undefined', () => {
    expect(normalizeRut(null)).toBe('');
    expect(normalizeRut(undefined)).toBe('');
  });
});

describe('isValidRut', () => {
  it('accepts valid RUTs', () => {
    expect(isValidRut('11111111-1')).toBe(true);
    expect(isValidRut('12345678-5')).toBe(true);
    expect(isValidRut('10000013-K')).toBe(true);
  });
  it('rejects bad check digits and bad shapes', () => {
    expect(isValidRut('11111111-2')).toBe(false);
    expect(isValidRut('1234-5')).toBe(false);
    expect(isValidRut('abc')).toBe(false);
    expect(isValidRut('')).toBe(false);
  });
});
```

- [ ] **Step 2: Escribir las pruebas `worker/test/crypto.test.js`**

```js
import { describe, it, expect } from 'vitest';
import {
  hashPin, generateSalt, generateToken, hashToken, generateTempPin,
} from '../src/lib/crypto.js';

describe('crypto helpers', () => {
  it('hashPin is deterministic and depends on the salt', async () => {
    expect(await hashPin('1234', 'aa')).toBe(await hashPin('1234', 'aa'));
    expect(await hashPin('1234', 'aa')).not.toBe(await hashPin('1234', 'bb'));
    expect(await hashPin('1234', 'aa')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateSalt returns 32 hex chars and is not constant', () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSalt()).not.toBe(generateSalt());
  });

  it('generateToken returns 64 hex chars and hashToken is sha256 of it', async () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(token)).not.toBe(token);
  });
});

describe('generateTempPin', () => {
  it('always returns exactly 4 digits', () => {
    for (let i = 0; i < 500; i++) expect(generateTempPin()).toMatch(/^\d{4}$/);
  });

  it('keeps leading zeros', () => {
    expect(generateTempPin(undefined, () => '0042')).toBe('0042');
  });

  it('redraws until the PIN differs from the excluded one', () => {
    const draws = ['2933', '2933', '1111'];
    expect(generateTempPin('2933', () => draws.shift())).toBe('1111');
  });
});
```

- [ ] **Step 3: Correr las pruebas y verificar que fallan**

Run: `docker compose run --rm test sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx vitest run test/rut.test.js test/crypto.test.js"`
Expected: FAIL (`Failed to resolve import "../src/lib/rut.js"`).

- [ ] **Step 4: Crear `worker/src/lib/http.js`**

```js
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Always resolves to a plain object, so handlers can read fields without
// crashing on `null`, arrays, numbers or invalid JSON.
export async function readJson(request) {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}
```

- [ ] **Step 5: Crear `worker/src/lib/cors.js`**

```js
// Only these origins may call the API from a browser.
// The localhost ones are for the Docker development setup.
export const ALLOWED_ORIGINS = [
  'https://dante-frontend-ashen.vercel.app',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

export function withCors(response, request) {
  const origin = request.headers.get('Origin');
  if (ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}
```

- [ ] **Step 6: Crear `worker/src/lib/rut.js`**

```js
export function normalizeRut(value) {
  return String(value || '').replace(/\./g, '').replace(/\s/g, '').toUpperCase();
}

export function isValidRut(rut) {
  if (!/^\d{7,8}-[\dK]$/.test(rut)) return false;
  const [body, checkDigit] = rut.split('-');
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return checkDigit === expected;
}
```

- [ ] **Step 7: Crear `worker/src/lib/crypto.js`**

```js
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export const hashPin = (pin, salt) => sha256Hex(salt + pin);

export function generateSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function generateToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export const hashToken = (token) => sha256Hex(token);

// Uniform 4-digit PIN using rejection sampling (no modulo bias).
function randomPin() {
  const range = 2 ** 32;
  const limit = range - (range % 10000);
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return String(buffer[0] % 10000).padStart(4, '0');
}

// `excludePin` keeps the temporary PIN from equalling the last 4 digits of
// the RUT (the old default). `draw` exists so tests can control the sequence.
export function generateTempPin(excludePin, draw = randomPin) {
  let pin = draw();
  while (pin === excludePin) pin = draw();
  return pin;
}
```

- [ ] **Step 8: Crear `worker/src/lib/pin.js`**

```js
import { hashPin } from './crypto.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// Checks `pin` against `user` and updates the lockout counters.
// Returns 'ok', 'wrong' or 'locked'. A locked account is rejected even if the
// PIN is correct.
export async function verifyPin(env, user, pin) {
  if (user.locked_until && new Date(user.locked_until) > new Date()) return 'locked';

  const valid = /^\d{4}$/.test(pin) && (await hashPin(pin, user.salt)) === user.pin_hash;

  if (!valid) {
    const failedAttempts = user.failed_attempts + 1;
    const lockedUntil =
      failedAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
        : null;
    await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE rut = ?')
      .bind(failedAttempts, lockedUntil, user.rut)
      .run();
    return 'wrong';
  }

  await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE rut = ?')
    .bind(user.rut)
    .run();
  return 'ok';
}
```

- [ ] **Step 9: Crear `worker/test/cors.test.js`** (se ejecuta en la Task 3)

```js
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
```

- [ ] **Step 10: Correr rut y crypto y verificar que pasan**

Run: `docker compose run --rm test sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx vitest run test/rut.test.js test/crypto.test.js test/schema.test.js"`
Expected: PASS (rut 6 tests, crypto 6 tests, schema 4 tests).

- [ ] **Step 11: Commit**

```bash
git add worker/src/lib worker/test/rut.test.js worker/test/crypto.test.js worker/test/cors.test.js
git commit -m "Agrega utilidades del Worker: http, cors, rut, crypto, verificación de PIN

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sesiones, guards y rutas de autenticación

**Files:**
- Create: `worker/src/lib/auth.js`, `worker/src/routes/auth.js`, `worker/test/auth.test.js`
- Modify: `worker/src/index.js` (reescritura completa)

**Interfaces:**
- Consumes: `json`, `readJson` (http.js); `withCors` (cors.js); `normalizeRut` (rut.js); `hashPin`, `generateSalt`, `generateToken`, `hashToken`, `sha256Hex` (crypto.js); `verifyPin` (pin.js).
- Produces:
  - `auth.js`: `SESSION_HOURS = 8`, `getBearerToken(request): string | null`, `createSession(env, rut): Promise<{ token, expiresAt }>`, `findSessionUser(env, request): Promise<userRow | null>`, `logAccess(env, request, rutAttempted, result): Promise<void>`, `runGuard(guard, request, env): Promise<{ user } | { response }>` con guards `'public' | 'session' | 'active' | 'admin'`.
  - `routes/auth.js`: `login`, `logout`, `me`, `changePin`, todos `(request, env, { user, params }) => Response`.
  - Router: `routes` es un arreglo `{ method, pattern, guard, handler }`. Las Tasks 4 y 5 agregan entradas.
  - Forma de usuario en respuestas: `{ rut, name, isAdmin, mustChangePin }`.

- [ ] **Step 1: Escribir `worker/test/auth.test.js`**

```js
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
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `docker compose run --rm test sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx vitest run test/auth.test.js test/cors.test.js"`
Expected: FAIL (las rutas no existen: `index.js` todavía es el antiguo y `helpers.js` ya puede importarse).

- [ ] **Step 3: Crear `worker/src/lib/auth.js`**

```js
import { json } from './http.js';
import { generateToken, hashToken, sha256Hex } from './crypto.js';

export const SESSION_HOURS = 8;

export function getBearerToken(request) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

export async function createSession(env, rut) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000).toISOString();

  // Opportunistic cleanup of expired sessions.
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()).run();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, rut, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(await hashToken(token), rut, now.toISOString(), expiresAt).run();

  return { token, expiresAt };
}

// Returns the active user that owns a valid, unexpired session, or null.
export async function findSessionUser(env, request) {
  const token = getBearerToken(request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.rut = s.rut
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`
  ).bind(await hashToken(token), new Date().toISOString()).first();
}

// Never store the PIN here. `rutAttempted` is attacker-controlled, so it is truncated.
export async function logAccess(env, request, rutAttempted, result) {
  const userAgent = (request.headers.get('User-Agent') || '').slice(0, 200);
  await env.DB.prepare(
    `INSERT INTO access_log (rut_attempted, result, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    String(rutAttempted).slice(0, 20),
    result,
    request.headers.get('CF-Connecting-IP'),
    userAgent || null,
    new Date().toISOString()
  ).run();
}

async function isAdminSecret(request, env) {
  const token = getBearerToken(request);
  if (!token || !env.ADMIN_SECRET) return false;
  const [a, b] = await Promise.all([sha256Hex(token), sha256Hex(env.ADMIN_SECRET)]);
  return a === b;
}

// Guards:
//   public  - no credentials
//   session - any valid session (even with a pending PIN change)
//   active  - valid session and no pending PIN change
//   admin   - active admin session, or the ADMIN_SECRET emergency key (user = null)
export async function runGuard(guard, request, env) {
  if (guard === 'public') return { user: null };

  const user = await findSessionUser(env, request);

  if (!user) {
    if (guard === 'admin' && (await isAdminSecret(request, env))) return { user: null };
    return { response: json({ code: 'session_expired', error: 'Sesión expirada' }, 401) };
  }
  if (guard !== 'session' && user.must_change_pin) {
    return {
      response: json(
        { code: 'pin_change_required', error: 'Debes cambiar tu PIN antes de continuar' },
        403
      ),
    };
  }
  if (guard === 'admin' && !user.is_admin) {
    return { response: json({ error: 'No autorizado' }, 403) };
  }
  return { user };
}
```

- [ ] **Step 4: Crear `worker/src/routes/auth.js`**

```js
import { json, readJson } from '../lib/http.js';
import { normalizeRut } from '../lib/rut.js';
import { generateSalt, hashPin, hashToken } from '../lib/crypto.js';
import { verifyPin } from '../lib/pin.js';
import { createSession, getBearerToken, logAccess } from '../lib/auth.js';

export function userView(user) {
  return {
    rut: user.rut,
    name: user.name,
    isAdmin: Boolean(user.is_admin),
    mustChangePin: Boolean(user.must_change_pin),
  };
}

const minutesLeft = (until) => Math.max(1, Math.ceil((new Date(until) - Date.now()) / 60000));

export async function login(request, env) {
  const body = await readJson(request);
  const rut = normalizeRut(body.rut);
  const pin = String(body.pin || '');
  const genericFailure = () => json({ error: 'RUT o PIN incorrecto' }, 401);

  const user = await env.DB.prepare('SELECT * FROM users WHERE rut = ?').bind(rut).first();
  if (!user) {
    await logAccess(env, request, rut, 'unknown_rut');
    return genericFailure();
  }
  if (!user.is_active) {
    await logAccess(env, request, rut, 'inactive_account');
    return genericFailure();
  }

  const outcome = await verifyPin(env, user, pin);
  if (outcome === 'locked') {
    await logAccess(env, request, rut, 'locked');
    return json(
      { error: `Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutesLeft(user.locked_until)} minutos.` },
      423
    );
  }
  if (outcome === 'wrong') {
    await logAccess(env, request, rut, 'wrong_pin');
    return genericFailure();
  }

  const { token, expiresAt } = await createSession(env, rut);
  await logAccess(env, request, rut, 'ok');
  return json({ token, expiresAt, user: userView(user) });
}

export async function logout(request, env) {
  const token = getBearerToken(request);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
  return json({ ok: true });
}

export async function me(request, env, { user }) {
  return json(userView(user));
}

export async function changePin(request, env, { user }) {
  const body = await readJson(request);
  const currentPin = String(body.currentPin || '');
  const newPin = String(body.newPin || '');

  if (!/^\d{4}$/.test(newPin)) return json({ error: 'El PIN nuevo debe tener 4 dígitos' }, 400);

  const outcome = await verifyPin(env, user, currentPin);
  if (outcome === 'locked') return json({ error: 'Cuenta bloqueada temporalmente' }, 423);
  if (outcome === 'wrong') return json({ error: 'PIN actual incorrecto' }, 401);

  if (newPin === currentPin) {
    return json({ error: 'El PIN nuevo debe ser distinto al actual' }, 400);
  }

  const salt = generateSalt();
  await env.DB.prepare('UPDATE users SET pin_hash = ?, salt = ?, must_change_pin = 0 WHERE rut = ?')
    .bind(await hashPin(newPin, salt), salt, user.rut)
    .run();
  return json({ ok: true });
}
```

- [ ] **Step 5: Reescribir `worker/src/index.js`** (por ahora solo rutas de autenticación)

```js
import { json } from './lib/http.js';
import { withCors } from './lib/cors.js';
import { runGuard } from './lib/auth.js';
import { login, logout, me, changePin } from './routes/auth.js';

// guard: 'public' | 'session' | 'active' | 'admin'  (see lib/auth.js)
const routes = [
  { method: 'POST', pattern: /^\/api\/login$/, guard: 'public', handler: login },
  { method: 'POST', pattern: /^\/api\/logout$/, guard: 'session', handler: logout },
  { method: 'GET', pattern: /^\/api\/me$/, guard: 'session', handler: me },
  { method: 'POST', pattern: /^\/api\/change-pin$/, guard: 'session', handler: changePin },
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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request);
    }
    try {
      return withCors(await handle(request, env), request);
    } catch (err) {
      console.error(err);
      return withCors(json({ error: 'Error interno' }, 500), request);
    }
  },
};
```

- [ ] **Step 6: Correr y verificar que pasan**

Run: `docker compose run --rm test sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx vitest run"`
Expected: PASS en `schema`, `rut`, `crypto`, `cors` y `auth` (todos los tests).

- [ ] **Step 7: Commit**

```bash
git add worker/src worker/test/auth.test.js
git commit -m "Agrega login, sesiones en D1, guards y cambio de PIN

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rutas de decretos

**Files:**
- Create: `worker/src/routes/decrees.js`, `worker/test/decrees.test.js`
- Modify: `worker/src/index.js`

**Interfaces:**
- Consumes: `json`, `readJson`, `verifyPin`, `runGuard` (guard `'active'`), `userView` no se usa.
- Produces: `getDecree`, `signDecree` en `routes/decrees.js`. Formas de respuesta:
  - `GET /api/decrees/:id` → `{ id, currentHolder: { rut, name } | null, history: [{ signerRut, signerName, signedAt }] }` (history más reciente primero).
  - `POST /api/decrees/:id/sign` body `{ pin }` → `{ ok: true, decreeId, currentHolder: { rut, name }, signedAt }`.

- [ ] **Step 1: Escribir `worker/test/decrees.test.js`**

```js
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
    const bad = ['a'.repeat(41), 'DP 1', 'DP<1>', '%E0%A4%A', 'DP/1'];
    for (const id of bad) {
      const res = await call('GET', `/api/decrees/${id}`, { token });
      expect([400, 404]).toContain(res.status);
    }
    expect((await call('GET', `/api/decrees/${'a'.repeat(41)}`, { token })).status).toBe(400);
    expect((await call('GET', '/api/decrees/%E0%A4%A', { token })).status).toBe(400);
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
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `docker compose run --rm test sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx vitest run test/decrees.test.js"`
Expected: FAIL (404 en las rutas de decretos).

- [ ] **Step 3: Crear `worker/src/routes/decrees.js`**

```js
import { json, readJson } from '../lib/http.js';
import { verifyPin } from '../lib/pin.js';

const DECREE_ID_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
const invalidId = () => json({ error: 'ID de decreto inválido' }, 400);

export async function getDecree(request, env, { params }) {
  const [decreeId] = params;
  if (!DECREE_ID_PATTERN.test(decreeId)) return invalidId();

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
  const [decreeId] = params;
  if (!DECREE_ID_PATTERN.test(decreeId)) return invalidId();

  const body = await readJson(request);
  const outcome = await verifyPin(env, user, String(body.pin || ''));
  if (outcome === 'locked') return json({ error: 'Cuenta bloqueada temporalmente' }, 423);
  if (outcome === 'wrong') return json({ error: 'PIN incorrecto' }, 401);

  const signedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO decrees (id, current_holder) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET current_holder = excluded.current_holder`
  ).bind(decreeId, user.rut).run();

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
```

- [ ] **Step 4: Registrar las rutas en `worker/src/index.js`**

Agregar el import debajo del de `routes/auth.js`:

```js
import { getDecree, signDecree } from './routes/decrees.js';
```

Y estas dos entradas al final del arreglo `routes`:

```js
  { method: 'GET', pattern: /^\/api\/decrees\/([^/]+)$/, guard: 'active', handler: getDecree },
  { method: 'POST', pattern: /^\/api\/decrees\/([^/]+)\/sign$/, guard: 'active', handler: signDecree },
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `docker compose run --rm test sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx vitest run"`
Expected: PASS en todos los archivos.

- [ ] **Step 6: Commit**

```bash
git add worker/src worker/test/decrees.test.js
git commit -m "Agrega rutas de decretos (consulta y firma exigiendo PIN)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rutas de administración

**Files:**
- Create: `worker/src/routes/admin.js`, `worker/test/admin.test.js`
- Modify: `worker/src/index.js`

**Interfaces:**
- Consumes: `json`, `readJson`, `normalizeRut`, `isValidRut`, `generateSalt`, `hashPin`, `generateTempPin`, guard `'admin'` (`user` es `null` si se entra con `ADMIN_SECRET`).
- Produces (`routes/admin.js`): `listUsers`, `createUser`, `updateUser`, `listAccessLog`. Formas de respuesta:
  - `GET /api/admin/users` → `{ users: [{ rut, name, isActive, isAdmin, mustChangePin, lockedUntil }] }`.
  - `POST /api/admin/users` body `{ rut, name }` → `201 { ok: true, rut, name, tempPin }`; `409` si existe.
  - `PATCH /api/admin/users/:rut` body `{ isActive?: boolean, resetPin?: true }` → `{ ok: true, tempPin? }`; `404` si no existe; `400` si un admin intenta desactivarse.
  - `GET /api/admin/access-log?limit=&before=` → `{ entries: [{ id, rutAttempted, result, ip, userAgent, createdAt }], nextBefore: number | null }`.

- [ ] **Step 1: Escribir `worker/test/admin.test.js`**

```js
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
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `docker compose run --rm test sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx vitest run test/admin.test.js"`
Expected: FAIL (404 en `/api/admin/*`).

- [ ] **Step 3: Crear `worker/src/routes/admin.js`**

```js
import { json, readJson } from '../lib/http.js';
import { normalizeRut, isValidRut } from '../lib/rut.js';
import { generateSalt, hashPin, generateTempPin } from '../lib/crypto.js';

const MAX_NAME_LENGTH = 100;
const DEFAULT_LOG_LIMIT = 100;
const MAX_LOG_LIMIT = 500;

function userRow(row) {
  return {
    rut: row.rut,
    name: row.name,
    isActive: Boolean(row.is_active),
    isAdmin: Boolean(row.is_admin),
    mustChangePin: Boolean(row.must_change_pin),
    lockedUntil: row.locked_until,
  };
}

// The old default PIN was the last 4 digits of the RUT body; never reuse it.
const tempPinFor = (rut) => generateTempPin(rut.split('-')[0].slice(-4));

export async function listUsers(request, env) {
  const { results } = await env.DB.prepare(
    `SELECT rut, name, is_active, is_admin, must_change_pin, locked_until
     FROM users ORDER BY name`
  ).all();
  return json({ users: results.map(userRow) });
}

export async function createUser(request, env) {
  const body = await readJson(request);
  const rut = normalizeRut(body.rut);
  const name = String(body.name || '').trim();

  if (!isValidRut(rut)) return json({ error: 'RUT inválido' }, 400);
  if (!name) return json({ error: 'Nombre requerido' }, 400);
  if (name.length > MAX_NAME_LENGTH) return json({ error: 'Nombre demasiado largo' }, 400);

  const existing = await env.DB.prepare('SELECT 1 AS x FROM users WHERE rut = ?').bind(rut).first();
  if (existing) return json({ error: 'El usuario ya existe' }, 409);

  const tempPin = tempPinFor(rut);
  const salt = generateSalt();
  await env.DB.prepare(
    `INSERT INTO users (rut, name, pin_hash, salt, is_active, must_change_pin, is_admin)
     VALUES (?, ?, ?, ?, 1, 1, 0)`
  ).bind(rut, name, await hashPin(tempPin, salt), salt).run();

  return json({ ok: true, rut, name, tempPin }, 201);
}

export async function updateUser(request, env, { user, params }) {
  const rut = normalizeRut(params[0]);
  const body = await readJson(request);

  const target = await env.DB.prepare('SELECT rut FROM users WHERE rut = ?').bind(rut).first();
  if (!target) return json({ error: 'Usuario no encontrado' }, 404);

  const hasIsActive = typeof body.isActive === 'boolean';
  const wantsReset = body.resetPin === true;
  if (!hasIsActive && !wantsReset) return json({ error: 'Nada que actualizar' }, 400);

  if (hasIsActive && !body.isActive && user && user.rut === rut) {
    return json({ error: 'No puedes desactivarte a ti mismo' }, 400);
  }

  if (hasIsActive) {
    await env.DB.prepare('UPDATE users SET is_active = ? WHERE rut = ?')
      .bind(body.isActive ? 1 : 0, rut)
      .run();
  }

  const result = { ok: true };
  if (wantsReset) {
    const tempPin = tempPinFor(rut);
    const salt = generateSalt();
    await env.DB.prepare(
      `UPDATE users
       SET pin_hash = ?, salt = ?, must_change_pin = 1, failed_attempts = 0, locked_until = NULL
       WHERE rut = ?`
    ).bind(await hashPin(tempPin, salt), salt, rut).run();
    await env.DB.prepare('DELETE FROM sessions WHERE rut = ?').bind(rut).run();
    result.tempPin = tempPin;
  }
  return json(result);
}

export async function listAccessLog(request, env) {
  const url = new URL(request.url);
  const requested = parseInt(url.searchParams.get('limit'), 10);
  const limit = Math.min(Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT);
  const beforeParam = parseInt(url.searchParams.get('before'), 10);
  const before = Number.isFinite(beforeParam) ? beforeParam : Number.MAX_SAFE_INTEGER;

  const { results } = await env.DB.prepare(
    `SELECT id, rut_attempted, result, ip, user_agent, created_at
     FROM access_log WHERE id < ? ORDER BY id DESC LIMIT ?`
  ).bind(before, limit).all();

  const entries = results.map((r) => ({
    id: r.id,
    rutAttempted: r.rut_attempted,
    result: r.result,
    ip: r.ip,
    userAgent: r.user_agent,
    createdAt: r.created_at,
  }));
  return json({
    entries,
    nextBefore: entries.length === limit ? entries[entries.length - 1].id : null,
  });
}
```

- [ ] **Step 4: Registrar las rutas en `worker/src/index.js`**

Import:

```js
import { listUsers, createUser, updateUser, listAccessLog } from './routes/admin.js';
```

Entradas al final del arreglo `routes`:

```js
  { method: 'GET', pattern: /^\/api\/admin\/users$/, guard: 'admin', handler: listUsers },
  { method: 'POST', pattern: /^\/api\/admin\/users$/, guard: 'admin', handler: createUser },
  { method: 'PATCH', pattern: /^\/api\/admin\/users\/([^/]+)$/, guard: 'admin', handler: updateUser },
  { method: 'GET', pattern: /^\/api\/admin\/access-log$/, guard: 'admin', handler: listAccessLog },
```

- [ ] **Step 5: Correr toda la suite y verificar que pasa**

Run: `docker compose run --rm test sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && npx vitest run"`
Expected: PASS en los 7 archivos (`schema`, `rut`, `crypto`, `cors`, `auth`, `decrees`, `admin`).

- [ ] **Step 6: Commit**

```bash
git add worker/src worker/test/admin.test.js
git commit -m "Agrega rutas de administración: usuarios, PIN temporal aleatorio y registro de accesos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend (login, decretos, admin)

**Files:**
- Modify: `frontend/index.html` (markup y CSS; sin `<script>` inline)
- Create: `frontend/app.js`

**Interfaces:**
- Consumes: API de las Tasks 3–5 (claves JSON en `camelCase`).
- Produces: sitio estático; sin pruebas automáticas (se prueba a mano en la Task 7).

Convención: los selectores CSS e ids **existentes** (`.card`, `.tenedor`, `#estado-vacio`, etc.) se conservan para no reescribir los estilos; todo identificador JS y todo id/clase **nuevo** va en inglés.

- [ ] **Step 1: En `frontend/index.html`, agregar CSS antes de `</style>`**

```css
  [hidden] { display: none !important; }

  .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
  .session-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 0.85rem; }
  .session-bar .link-sutil { color: var(--paper); }

  .login-card { max-width: 380px; margin: 40px auto; }
  .login-card h2 { font-family: 'Source Serif 4', serif; margin-bottom: 18px; color: var(--ink); }
  .field-label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--ink-soft); margin-bottom: 6px; }
  .text-field {
    width: 100%; padding: 12px 14px; margin-bottom: 16px;
    border: 1.5px solid var(--line); border-radius: 8px;
    font-size: 1rem; background: white; color: var(--text);
  }
  .text-field:focus { outline: none; border-color: var(--ink); }
  .form-error { color: var(--seal); font-size: 0.85rem; min-height: 1.2em; margin-bottom: 12px; }

  .admin-section { margin-bottom: 36px; }
  .admin-section h2 { font-family: 'Source Serif 4', serif; font-size: 1.15rem; color: var(--ink); margin-bottom: 12px; }
  .create-user { display: grid; grid-template-columns: 1fr 1.5fr auto; gap: 10px; align-items: start; }
  .create-user .text-field { margin-bottom: 0; }
  .table-wrap { overflow-x: auto; }
  table.data { width: 100%; border-collapse: collapse; font-size: 0.85rem; background: white; border: 1.5px solid var(--line); border-radius: 8px; }
  table.data th, table.data td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  table.data th { color: var(--ink-soft); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .mono { font-family: 'JetBrains Mono', monospace; }
  .btn-small { padding: 5px 10px; font-size: 0.78rem; border-radius: 6px; background: var(--paper-dim); color: var(--ink); border: 1px solid var(--line); }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; background: var(--paper-dim); }
  .tag.bad { color: var(--seal); }
  .tag.good { color: var(--ok); }

  .temp-pin {
    font-family: 'JetBrains Mono', monospace; font-size: 2.2rem; letter-spacing: 0.35em;
    text-align: center; padding: 16px 0 16px 0.35em; margin: 12px 0;
    background: var(--paper-dim); border-radius: 8px; color: var(--ink);
  }
  @media (max-width: 640px) { .create-user { grid-template-columns: 1fr; } }
```

- [ ] **Step 2: Reemplazar en `frontend/index.html` todo desde `<header>` hasta el final del archivo** por este bloque

```html
<header>
  <div class="header-row">
    <div>
      <h1>Firma de Decretos de Pago</h1>
      <p>Consulta quién tiene un decreto y registra la firma de recepción</p>
    </div>
    <div class="session-bar" id="session-bar" hidden>
      <span id="session-name"></span>
      <button class="link-sutil" id="btn-admin" hidden>Administración</button>
      <button class="link-sutil" id="btn-open-change-pin">Cambiar mi PIN</button>
      <button class="link-sutil" id="btn-logout">Salir</button>
    </div>
  </div>
</header>

<main>
  <!-- Login -->
  <section id="view-login" hidden>
    <div class="card login-card">
      <h2>Ingresar</h2>
      <label class="field-label" for="login-rut">RUT</label>
      <input class="text-field" id="login-rut" type="text" placeholder="12345678-9" autocomplete="username" />
      <label class="field-label" for="login-pin">PIN (4 dígitos)</label>
      <input class="text-field" id="login-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="current-password" />
      <div class="form-error" id="login-error"></div>
      <button class="btn-seal" id="btn-login">Ingresar</button>
    </div>
  </section>

  <!-- Decretos -->
  <section id="view-main" hidden>
    <div class="buscar">
      <input type="text" id="input-decreto" placeholder="ID del decreto, ej: DP-2026-0453" autocomplete="off" maxlength="40" />
      <button class="btn-primary" id="btn-buscar">Consultar</button>
    </div>

    <div id="estado-vacio">Ingresa el ID de un decreto para ver su estado.</div>
    <div id="estado-error"></div>

    <div id="resultado" style="display:none">
      <div class="card">
        <div class="eyebrow">Decreto</div>
        <div class="decreto-id" id="r-decreto-id"></div>
        <div class="eyebrow" style="margin-bottom:10px">Actualmente en poder de</div>
        <div id="r-tenedor"></div>
        <button class="btn-seal" id="btn-firmar" style="margin-top:16px">Firmar este decreto</button>
      </div>
      <div class="historial-titulo">Historial de firmas</div>
      <div id="r-historial"></div>
    </div>
  </section>

  <!-- Administración -->
  <section id="view-admin" hidden>
    <div class="admin-section">
      <h2>Agregar usuario</h2>
      <div class="create-user">
        <input class="text-field" id="new-user-rut" type="text" placeholder="RUT, ej: 12345678-9" />
        <input class="text-field" id="new-user-name" type="text" placeholder="Nombre completo" maxlength="100" />
        <button class="btn-primary" id="btn-create-user">Crear</button>
      </div>
      <div class="form-error" id="admin-error" style="margin-top:10px"></div>
    </div>

    <div class="admin-section">
      <h2>Usuarios</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Nombre</th><th>RUT</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody id="users-body"></tbody>
        </table>
      </div>
    </div>

    <div class="admin-section">
      <h2>Últimos accesos</h2>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Fecha</th><th>RUT ingresado</th><th>Resultado</th><th>IP</th></tr></thead>
          <tbody id="access-log-body"></tbody>
        </table>
      </div>
    </div>
  </section>
</main>

<!-- Modal de firma -->
<div class="overlay" id="overlay">
  <div class="modal">
    <h2>Firmar decreto</h2>
    <div class="sub" id="modal-decreto-id"></div>
    <label>Confirma con tu PIN (4 dígitos)</label>
    <div class="pin-boxes">
      <input type="password" inputmode="numeric" maxlength="1" class="pin-box" />
      <input type="password" inputmode="numeric" maxlength="1" class="pin-box" />
      <input type="password" inputmode="numeric" maxlength="1" class="pin-box" />
      <input type="password" inputmode="numeric" maxlength="1" class="pin-box" />
    </div>
    <div class="modal-error" id="modal-error"></div>
    <div class="modal-acciones">
      <button class="btn-text" id="btn-cancelar">Cancelar</button>
      <button class="btn-seal" id="btn-confirmar-firma">Confirmar firma</button>
    </div>
  </div>
</div>

<!-- Modal de cambio de PIN -->
<div class="overlay" id="overlay-cambiar-pin">
  <div class="modal">
    <h2>Cambiar mi PIN</h2>
    <div class="sub" id="cambiar-pin-sub"></div>
    <label>PIN actual</label>
    <input type="password" inputmode="numeric" maxlength="4" class="campo-pin" id="cp-pin-actual" placeholder="••••" />
    <label>PIN nuevo (4 dígitos)</label>
    <input type="password" inputmode="numeric" maxlength="4" class="campo-pin" id="cp-pin-nuevo" placeholder="••••" />
    <label>Confirmar PIN nuevo</label>
    <input type="password" inputmode="numeric" maxlength="4" class="campo-pin" id="cp-pin-confirmar" placeholder="••••" style="margin-bottom:0" />
    <div class="modal-error" id="cambiar-pin-error"></div>
    <div class="modal-acciones">
      <button class="btn-text" id="btn-cambiar-pin-cancelar">Cancelar</button>
      <button class="btn-seal" id="btn-cambiar-pin-guardar">Guardar PIN nuevo</button>
    </div>
  </div>
</div>

<!-- Modal de PIN temporal (se muestra una sola vez) -->
<div class="overlay" id="overlay-temp-pin">
  <div class="modal">
    <h2>PIN temporal</h2>
    <div class="sub" id="temp-pin-sub"></div>
    <div class="temp-pin" id="temp-pin-value"></div>
    <div class="sub" style="margin-bottom:8px">Este PIN se muestra <strong>una sola vez</strong>. La persona deberá cambiarlo en su primer ingreso.</div>
    <div class="modal-acciones">
      <button class="btn-text" id="btn-temp-pin-close">Cerrar</button>
      <button class="btn-seal" id="btn-temp-pin-copy">Copiar PIN</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script src="app.js" defer></script>
</body>
</html>
```

- [ ] **Step 3: Crear `frontend/app.js`**

```js
'use strict';

const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const API_BASE = IS_LOCAL
  ? 'http://127.0.0.1:8787'
  : 'https://decretos-firma-api.dfuentes-e72.workers.dev';
const SESSION_KEY = 'decrees.session';

const RESULT_LABELS = {
  ok: 'Ingreso correcto',
  wrong_pin: 'PIN incorrecto',
  locked: 'Cuenta bloqueada',
  unknown_rut: 'RUT no registrado',
  inactive_account: 'Cuenta inactiva',
};

const $ = (selector) => document.querySelector(selector);

// ─── helpers ───────────────────────────────────────────────

// Everything coming from the API is rendered through this: RUTs typed into the
// login form and User-Agents are attacker-controlled.
function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

function initials(name) {
  return String(name).split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('es-CL')} · ${d.toLocaleTimeString('es-CL', { hour12: false })}`;
}

const toast = $('#toast');
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('activo');
  setTimeout(() => toast.classList.remove('activo'), 2600);
}

// ─── session ───────────────────────────────────────────────

let session = null; // { token, user: { rut, name, isAdmin, mustChangePin } }

function saveSession() {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage blocked */ }
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function clearSession() {
  session = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
}

// ─── API ───────────────────────────────────────────────────

async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Authorization = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'No se pudo conectar con el servidor.' } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'session_expired') {
    endSession('Tu sesión expiró. Ingresa nuevamente.');
  }
  return { ok: res.ok, status: res.status, data };
}

// ─── views ─────────────────────────────────────────────────

const views = { login: $('#view-login'), main: $('#view-main'), admin: $('#view-admin') };
const sessionBar = $('#session-bar');
const btnAdmin = $('#btn-admin');
let currentView = 'login';

function showView(name) {
  currentView = name;
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  sessionBar.hidden = name === 'login' || !session;
  if (session) {
    $('#session-name').textContent = session.user.name;
    btnAdmin.hidden = !session.user.isAdmin;
    btnAdmin.textContent = name === 'admin' ? 'Volver a decretos' : 'Administración';
  }
}

function openOverlay(el) { el.classList.add('activo'); }
function closeOverlay(el) { el.classList.remove('activo'); }
function closeAllOverlays() {
  document.querySelectorAll('.overlay').forEach((el) => closeOverlay(el));
  $('#temp-pin-value').textContent = '';
}

function endSession(message) {
  clearSession();
  closeAllOverlays();
  $('#login-error').textContent = message || '';
  showView('login');
}

function enterApp() {
  showView('main');
  if (session.user.mustChangePin) openChangePin({ forced: true });
}

// ─── login / logout ────────────────────────────────────────

const loginRut = $('#login-rut');
const loginPin = $('#login-pin');
const loginError = $('#login-error');
const btnLogin = $('#btn-login');

async function handleLogin() {
  const rut = loginRut.value.trim();
  const pin = loginPin.value.trim();
  loginError.textContent = '';
  if (!rut || !/^\d{4}$/.test(pin)) {
    loginError.textContent = 'Ingresa tu RUT y tu PIN de 4 dígitos.';
    return;
  }

  btnLogin.disabled = true;
  const { ok, data } = await api('POST', '/api/login', { rut, pin });
  btnLogin.disabled = false;

  if (!ok) {
    loginError.textContent = data.error || 'No se pudo ingresar.';
    loginPin.value = '';
    return;
  }
  session = { token: data.token, user: data.user };
  saveSession();
  loginRut.value = '';
  loginPin.value = '';
  enterApp();
}

async function handleLogout() {
  await api('POST', '/api/logout');
  endSession('');
}

// ─── decrees ───────────────────────────────────────────────

const inputDecree = $('#input-decreto');
const stateEmpty = $('#estado-vacio');
const stateError = $('#estado-error');
const resultBox = $('#resultado');
let currentDecree = null;

async function loadDecree(id) {
  stateError.style.display = 'none';
  resultBox.style.display = 'none';
  stateEmpty.textContent = 'Buscando…';
  stateEmpty.style.display = 'block';

  const { ok, data } = await api('GET', `/api/decrees/${encodeURIComponent(id)}`);
  if (!ok) {
    if (currentView === 'login') return; // session expired, already redirected
    stateEmpty.style.display = 'none';
    stateError.textContent = data.error || 'No se pudo consultar el decreto.';
    stateError.style.display = 'block';
    return;
  }
  currentDecree = data;
  renderDecree(data);
}

function renderDecree(data) {
  stateEmpty.style.display = 'none';
  resultBox.style.display = 'block';
  $('#r-decreto-id').textContent = data.id;

  $('#r-tenedor').innerHTML = data.currentHolder
    ? `<div class="tenedor">
         <div class="avatar">${escapeHtml(initials(data.currentHolder.name))}</div>
         <div class="info">
           <div class="nombre">${escapeHtml(data.currentHolder.name)}</div>
           <div class="rut">${escapeHtml(data.currentHolder.rut)}</div>
         </div>
       </div>`
    : '<div class="tenedor sin-tenedor">Este decreto aún no ha sido firmado por nadie</div>';

  $('#r-historial').innerHTML = data.history.length
    ? `<div class="ledger">${data.history.map((s) => `
        <div class="firma-item">
          <div class="marca">${escapeHtml(initials(s.signerName))}</div>
          <div class="detalle">
            <div class="nombre">${escapeHtml(s.signerName)}</div>
            <div class="meta">${escapeHtml(s.signerRut)} · ${escapeHtml(formatDate(s.signedAt))}</div>
          </div>
        </div>`).join('')}</div>`
    : '<div class="sin-historial">Sin firmas registradas todavía.</div>';
}

// ─── sign modal ────────────────────────────────────────────

const overlaySign = $('#overlay');
const pinBoxes = [...document.querySelectorAll('.pin-box')];
const signError = $('#modal-error');
const btnConfirmSign = $('#btn-confirmar-firma');

function openSignModal() {
  if (!currentDecree) return;
  $('#modal-decreto-id').textContent = `Decreto ${currentDecree.id}`;
  signError.textContent = '';
  pinBoxes.forEach((b) => (b.value = ''));
  openOverlay(overlaySign);
  pinBoxes[0].focus();
}

pinBoxes.forEach((box, i) => {
  box.addEventListener('input', () => {
    box.value = box.value.replace(/\D/g, '').slice(0, 1);
    if (box.value && i < pinBoxes.length - 1) pinBoxes[i + 1].focus();
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !box.value && i > 0) pinBoxes[i - 1].focus();
    if (e.key === 'Enter') btnConfirmSign.click();
  });
});

async function confirmSign() {
  const pin = pinBoxes.map((b) => b.value).join('');
  if (pin.length !== 4) {
    signError.textContent = 'Ingresa los 4 dígitos del PIN.';
    return;
  }
  btnConfirmSign.disabled = true;
  signError.textContent = '';

  const { ok, data } = await api(
    'POST',
    `/api/decrees/${encodeURIComponent(currentDecree.id)}/sign`,
    { pin }
  );
  btnConfirmSign.disabled = false;

  if (!ok) {
    if (currentView === 'login') return; // session expired
    if (data.code === 'pin_change_required') {
      closeOverlay(overlaySign);
      openChangePin({ forced: true });
      return;
    }
    signError.textContent = data.error || 'No se pudo firmar el decreto.';
    pinBoxes.forEach((b) => (b.value = ''));
    pinBoxes[0].focus();
    return;
  }
  closeOverlay(overlaySign);
  showToast('Decreto firmado correctamente');
  loadDecree(currentDecree.id);
}

// ─── change PIN modal ──────────────────────────────────────

const overlayChangePin = $('#overlay-cambiar-pin');
const cpCurrent = $('#cp-pin-actual');
const cpNew = $('#cp-pin-nuevo');
const cpConfirm = $('#cp-pin-confirmar');
const cpError = $('#cambiar-pin-error');
const btnCpCancel = $('#btn-cambiar-pin-cancelar');
const btnCpSave = $('#btn-cambiar-pin-guardar');
let changePinForced = false;

function openChangePin({ forced = false } = {}) {
  changePinForced = forced;
  cpError.textContent = '';
  cpCurrent.value = '';
  cpNew.value = '';
  cpConfirm.value = '';
  btnCpCancel.hidden = forced;
  const sub = $('#cambiar-pin-sub');
  sub.textContent = forced
    ? 'Estás usando un PIN temporal. Crea un PIN personal que solo tú conozcas para continuar.'
    : 'Actualiza tu PIN de firma. Nadie más podrá verlo.';
  sub.classList.toggle('aviso', forced);
  openOverlay(overlayChangePin);
  cpCurrent.focus();
}

async function confirmChangePin() {
  const currentPin = cpCurrent.value.trim();
  const newPin = cpNew.value.trim();
  if (!/^\d{4}$/.test(currentPin)) { cpError.textContent = 'Ingresa tu PIN actual (4 dígitos).'; return; }
  if (!/^\d{4}$/.test(newPin)) { cpError.textContent = 'El PIN nuevo debe tener 4 dígitos.'; return; }
  if (newPin !== cpConfirm.value.trim()) { cpError.textContent = 'Los PIN nuevos no coinciden.'; return; }

  btnCpSave.disabled = true;
  cpError.textContent = '';
  const { ok, data } = await api('POST', '/api/change-pin', { currentPin, newPin });
  btnCpSave.disabled = false;

  if (!ok) {
    if (currentView === 'login') return; // session expired
    cpError.textContent = data.error || 'No se pudo cambiar el PIN.';
    return;
  }
  session.user.mustChangePin = false;
  saveSession();
  changePinForced = false;
  closeOverlay(overlayChangePin);
  showToast('PIN actualizado.');
}

// ─── admin ─────────────────────────────────────────────────

const usersBody = $('#users-body');
const accessLogBody = $('#access-log-body');
const adminError = $('#admin-error');

async function openAdmin() {
  adminError.textContent = '';
  showView('admin');
  await Promise.all([loadUsers(), loadAccessLog()]);
}

async function loadUsers() {
  const { ok, data } = await api('GET', '/api/admin/users');
  if (!ok) { adminError.textContent = data.error || 'No se pudo cargar los usuarios.'; return; }
  usersBody.innerHTML = data.users.map((u) => {
    const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
    const status = !u.isActive
      ? '<span class="tag bad">Inactivo</span>'
      : locked
        ? '<span class="tag bad">Bloqueado</span>'
        : u.mustChangePin
          ? '<span class="tag">PIN temporal</span>'
          : '<span class="tag good">Activo</span>';
    const isSelf = u.rut === session.user.rut;
    return `<tr>
      <td>${escapeHtml(u.name)}${u.isAdmin ? ' <span class="tag">admin</span>' : ''}</td>
      <td class="mono">${escapeHtml(u.rut)}</td>
      <td>${status}</td>
      <td>
        ${isSelf ? '' : `<button class="btn-small" data-action="toggle" data-rut="${escapeHtml(u.rut)}" data-active="${u.isActive}">${u.isActive ? 'Desactivar' : 'Activar'}</button>`}
        <button class="btn-small" data-action="reset" data-rut="${escapeHtml(u.rut)}" data-name="${escapeHtml(u.name)}">Resetear PIN</button>
      </td>
    </tr>`;
  }).join('');
}

async function loadAccessLog() {
  const { ok, data } = await api('GET', '/api/admin/access-log?limit=50');
  if (!ok) return;
  accessLogBody.innerHTML = data.entries.map((e) => `<tr>
    <td>${escapeHtml(formatDate(e.createdAt))}</td>
    <td class="mono">${escapeHtml(e.rutAttempted)}</td>
    <td>${escapeHtml(RESULT_LABELS[e.result] || e.result)}</td>
    <td class="mono">${escapeHtml(e.ip || '—')}</td>
  </tr>`).join('') || '<tr><td colspan="4">Sin accesos registrados.</td></tr>';
}

async function handleCreateUser() {
  const rut = $('#new-user-rut').value.trim();
  const name = $('#new-user-name').value.trim();
  adminError.textContent = '';
  if (!rut || !name) { adminError.textContent = 'Ingresa RUT y nombre.'; return; }

  const { ok, data } = await api('POST', '/api/admin/users', { rut, name });
  if (!ok) { adminError.textContent = data.error || 'No se pudo crear el usuario.'; return; }

  $('#new-user-rut').value = '';
  $('#new-user-name').value = '';
  showTempPin(data.name, data.tempPin);
  loadUsers();
}

usersBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, rut } = button.dataset;
  adminError.textContent = '';

  if (action === 'toggle') {
    const makeActive = button.dataset.active !== 'true';
    if (!makeActive && !confirm(`¿Desactivar a ${rut}? No podrá ingresar.`)) return;
    const { ok, data } = await api('PATCH', `/api/admin/users/${encodeURIComponent(rut)}`, { isActive: makeActive });
    if (!ok) { adminError.textContent = data.error || 'No se pudo actualizar.'; return; }
    loadUsers();
  }

  if (action === 'reset') {
    if (!confirm(`¿Resetear el PIN de ${button.dataset.name}? Se cerrará su sesión.`)) return;
    const { ok, data } = await api('PATCH', `/api/admin/users/${encodeURIComponent(rut)}`, { resetPin: true });
    if (!ok) { adminError.textContent = data.error || 'No se pudo resetear el PIN.'; return; }
    showTempPin(button.dataset.name, data.tempPin);
    loadUsers();
  }
});

// ─── temporary PIN modal ───────────────────────────────────

const overlayTempPin = $('#overlay-temp-pin');
const tempPinValue = $('#temp-pin-value');

function showTempPin(name, tempPin) {
  $('#temp-pin-sub').textContent = `Entrégaselo a ${name}.`;
  tempPinValue.textContent = tempPin;
  openOverlay(overlayTempPin);
}

function closeTempPin() {
  tempPinValue.textContent = ''; // do not leave the PIN in the DOM
  closeOverlay(overlayTempPin);
}

async function copyTempPin() {
  const pin = tempPinValue.textContent;
  try {
    await navigator.clipboard.writeText(pin);
    showToast('PIN copiado');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(tempPinValue);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    showToast('Selecciona el PIN y copia con Ctrl+C');
  }
}

// ─── wiring ────────────────────────────────────────────────

btnLogin.addEventListener('click', handleLogin);
loginPin.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
loginRut.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginPin.focus(); });
$('#btn-logout').addEventListener('click', handleLogout);

$('#btn-buscar').addEventListener('click', () => {
  const id = inputDecree.value.trim();
  if (id) loadDecree(id);
});
inputDecree.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-buscar').click(); });

$('#btn-firmar').addEventListener('click', openSignModal);
$('#btn-cancelar').addEventListener('click', () => closeOverlay(overlaySign));
btnConfirmSign.addEventListener('click', confirmSign);
overlaySign.addEventListener('click', (e) => { if (e.target === overlaySign) closeOverlay(overlaySign); });

$('#btn-open-change-pin').addEventListener('click', () => openChangePin());
btnCpCancel.addEventListener('click', () => closeOverlay(overlayChangePin));
btnCpSave.addEventListener('click', confirmChangePin);
overlayChangePin.addEventListener('click', (e) => {
  if (e.target === overlayChangePin && !changePinForced) closeOverlay(overlayChangePin);
});

btnAdmin.addEventListener('click', () => (currentView === 'admin' ? showView('main') : openAdmin()));
$('#btn-create-user').addEventListener('click', handleCreateUser);
$('#btn-temp-pin-copy').addEventListener('click', copyTempPin);
$('#btn-temp-pin-close').addEventListener('click', closeTempPin);

async function boot() {
  const stored = loadSession();
  if (!stored || !stored.token) { showView('login'); return; }
  session = stored;
  const { ok, data } = await api('GET', '/api/me');
  if (!ok) { clearSession(); showView('login'); return; }
  session.user = data;
  saveSession();
  enterApp();
}

boot();
```

- [ ] **Step 4: Verificar que el HTML y el JS no tienen errores de sintaxis**

Run: `docker run --rm -v "$PWD/frontend":/app -w /app node:22-slim node --check app.js && echo "app.js OK"`
Expected: `app.js OK`

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "Frontend: login, vista de decretos con sesión y panel de administración

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Entorno local, README y verificación de punta a punta

**Files:**
- Modify: `worker/seed-local.sh` (reescribir), `README.md` (reescribir)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: README actualizado y un flujo local reproducible con `docker compose up -d` + `bash worker/seed-local.sh`.

- [ ] **Step 1: Reescribir `worker/seed-local.sh`**

```bash
#!/bin/bash
# Prepara datos de prueba en el entorno Docker local (docker compose up -d).
# Crea dos usuarios por la API de admin y deja al primero como admin.
# Ejecutar desde la raíz del repo:  bash worker/seed-local.sh
set -u

API="http://127.0.0.1:8787"
ADMIN_SECRET="un-secreto-cualquiera-para-pruebas-locales"

create_user() {
  curl -s -X POST "$API/api/admin/users" \
    -H "Authorization: Bearer $ADMIN_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"rut\": \"$1\", \"name\": \"$2\"}"
  echo
}

create_user "11111111-1" "Ana Prueba (admin)"
create_user "22222222-2" "Bruno Prueba"

docker compose exec -T api npx wrangler d1 execute decretos_firma_db --local \
  --command "UPDATE users SET is_admin = 1 WHERE rut = '11111111-1'" > /dev/null

echo "Listo. Ana (11111111-1) es admin. El PIN temporal de cada usuario nuevo aparece arriba (tempPin)."
echo "Si ya existían, usa 'Resetear PIN' en el panel de administración o el endpoint PATCH."
```

- [ ] **Step 2: Reescribir `README.md`**

````markdown
# Firma de Decretos de Pago

Sistema para consultar quién tiene un decreto de pago y registrar la firma de
recepción. Backend en Cloudflare Workers + D1, frontend estático en Vercel.
Acceso con login (RUT + PIN), rol admin y registro de accesos.

## Cómo funciona

- **Login:** RUT + PIN de 4 dígitos. La sesión dura 8 horas y vive en la base (D1).
- **Firmar:** además de estar logueado, se vuelve a pedir el PIN en cada firma.
- **PIN temporal:** al crear un usuario (o resetear su PIN) el sistema genera un PIN
  aleatorio de 4 dígitos, se muestra **una sola vez** al admin (con botón *Copiar*),
  y la persona debe cambiarlo en su primer ingreso.
- **Admin:** puede crear usuarios, desactivarlos, resetear PINs y ver los últimos
  accesos. Los admins se definen en la base (`users.is_admin`); el primero lo marca la
  migración `0001`.
- **Registro de accesos** (`access_log`): fecha, RUT ingresado, resultado
  (`ok`, `wrong_pin`, `locked`, `unknown_rut`, `inactive_account`), IP y navegador.
  **Nunca se guarda el PIN.**
- Tras 5 PIN incorrectos la cuenta se bloquea 15 minutos.
- `ADMIN_SECRET` queda como llave de emergencia para `/api/admin/*` (por `curl`).

## Desarrollo local (todo en Docker, sin instalar nada)

```bash
docker compose up -d          # API en :8787 y frontend en :8080
bash worker/seed-local.sh     # usuarios de prueba (Ana = admin)
docker compose run --rm test  # pruebas automáticas del Worker
docker compose down -v        # apagar y borrar la base local
```

Abre http://localhost:8080. El PIN temporal de cada usuario lo imprime `seed-local.sh`.

## Despliegue

Las credenciales de Cloudflare van en `.env` (ignorado por git):

```
WORKER_TOKEN=<API token de Cloudflare con Workers Scripts:Edit y D1:Edit>
ADMIN_SECRET_PROD=<clave larga, la misma que `wrangler secret put ADMIN_SECRET`>
```

```bash
set -a && . ./.env && set +a && export CLOUDFLARE_API_TOKEN="$WORKER_TOKEN"
W="docker run --rm -e CLOUDFLARE_API_TOKEN -e CI=true -v $PWD/worker:/app -w /app node:22-slim"

$W npx --yes wrangler@4 d1 migrations apply decretos_firma_db --remote   # migraciones
$W npx --yes wrangler@4 deploy                                           # Worker
```

El frontend se despliega solo en Vercel al hacer push a `main` (Root Directory = `frontend`).
Si cambia el dominio del frontend, actualiza `ALLOWED_ORIGINS` en `worker/src/lib/cors.js`.

## Administración por línea de comandos (emergencia)

```bash
curl -X POST https://decretos-firma-api.dfuentes-e72.workers.dev/api/admin/users \
  -H "Authorization: Bearer $ADMIN_SECRET_PROD" -H "Content-Type: application/json" \
  -d '{"rut": "12345678-5", "name": "Juan Pérez"}'
```

## Seguridad: lo que está y lo que no

- El PIN se guarda con hash + sal; el token de sesión, solo su SHA-256.
- Un PIN de 4 dígitos es débil frente a fuerza bruta distribuida; la defensa es el
  bloqueo por cuenta (que además permite bloquear cuentas ajenas). No hay límite por
  IP ni segundo factor. Si las firmas tienen peso legal, conviene sumarlos.
- Trata `ADMIN_SECRET` y el token de Cloudflare como contraseñas maestras.
````

- [ ] **Step 3: Reiniciar el entorno limpio y sembrar datos**

Run:
```bash
docker compose down -v
docker compose up -d --build
sleep 75
docker compose logs api | grep -i -E "error|Ready on" | head
bash worker/seed-local.sh
```
Expected: `Ready on http://0.0.0.0:8787`, sin errores, y dos líneas JSON con `"ok":true` y un `tempPin` de 4 dígitos para Ana y para Bruno.

- [ ] **Step 4: Verificación de punta a punta por API con `curl`** (reemplazar `PIN_ANA` por el `tempPin` impreso en el paso anterior)

Run:
```bash
A=http://127.0.0.1:8787
O='Origin: http://localhost:8080'
curl -s -X POST $A/api/login -H "$O" -H 'Content-Type: application/json' -d '{"rut":"11111111-1","pin":"PIN_ANA"}'
echo; curl -s $A/api/usuarios -o /dev/null -w "lista pública antigua: %{http_code}\n"
curl -s $A/api/decrees/DP-1 -o /dev/null -w "decreto sin sesión: %{http_code}\n"
```
Expected: el login devuelve `token` y `"mustChangePin":true`; `/api/usuarios` responde `404` (ya no existe) y el decreto sin sesión responde `401`.

- [ ] **Step 5: Prueba manual en el navegador (http://localhost:8080)** — checklist

  1. Se ve **solo** el formulario de login (sin selector de usuarios).
  2. Login con Ana + `tempPin` → aparece el modal **forzado** de cambio de PIN (sin botón Cancelar, no se cierra tocando fuera). Cámbialo.
  3. Aparece "Administración". Crea un usuario con un RUT válido → modal con PIN temporal de 4 dígitos; **Copiar PIN** muestra el aviso; al cerrar el modal el PIN ya no está en pantalla.
  4. La tabla de usuarios y de accesos se llenan; en accesos aparecen los intentos con su resultado y **sin PIN**.
  5. **XSS:** en una ventana de incógnito intenta login con RUT `<img src=x onerror=alert(1)>` y PIN `0000`. Vuelve como admin: en la tabla de accesos el texto se ve literal (cortado a 20 caracteres) y **no salta ninguna alerta**.
  6. Vuelve a decretos, consulta `DP-2026-0001`, firma → pide el PIN otra vez; con PIN malo muestra el error; con el bueno se registra y aparece en el historial.
  7. "Salir" vuelve al login; recargar la página mantiene la sesión mientras la pestaña esté abierta y la pierde al cerrarla.
  8. Resetear el PIN de Bruno desde el panel → muestra un PIN nuevo y su sesión (si estaba abierta) cae.

- [ ] **Step 6: Commit**

```bash
git add worker/seed-local.sh README.md
git commit -m "Actualiza README y seed local para login, admin y Docker

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Despliegue a producción

**Files:** ninguno (operaciones); eventualmente `.env` (solo lectura).

**Interfaces:**
- Consumes: `.env` con `WORKER_TOKEN` y `ADMIN_SECRET_PROD`; migraciones y Worker de las tasks anteriores.
- Produces: Worker nuevo en producción, migración aplicada a la D1 remota, frontend nuevo en Vercel. **Esta task toca producción: pedir confirmación explícita al usuario antes del Step 2.**

- [ ] **Step 1: Verificar que todo está verde antes de tocar producción**

Run: `docker compose run --rm test && git status --short`
Expected: todas las pruebas PASS; árbol de trabajo limpio.

- [ ] **Step 2: Respaldo de la base remota** (el archivo contiene hashes de PIN: dejarlo fuera del repo)

Run:
```bash
cd /home/meraki/dante && set -a && . ./.env && set +a && export CLOUDFLARE_API_TOKEN="$WORKER_TOKEN"
mkdir -p /tmp/claude-1000/-home-meraki-dante/81332ac4-e5c1-4658-b9b8-3a6a785c68e7/scratchpad/backup
docker run --rm -e CLOUDFLARE_API_TOKEN -e CI=true -v "$PWD/worker":/app -v /tmp/claude-1000/-home-meraki-dante/81332ac4-e5c1-4658-b9b8-3a6a785c68e7/scratchpad/backup:/backup -w /app node:22-slim npx --yes wrangler@4 d1 export decretos_firma_db --remote --output /backup/pre-auth.sql
ls -l /tmp/claude-1000/-home-meraki-dante/81332ac4-e5c1-4658-b9b8-3a6a785c68e7/scratchpad/backup/pre-auth.sql
```
Expected: archivo `pre-auth.sql` no vacío.

- [ ] **Step 3: Aplicar las migraciones en la D1 remota** (antes de desplegar el Worker nuevo)

Run:
```bash
docker run --rm -e CLOUDFLARE_API_TOKEN -e CI=true -v "$PWD/worker":/app -w /app node:22-slim npx --yes wrangler@4 d1 migrations apply decretos_firma_db --remote 2>&1 | tail -20
```
Expected: se aplican `0000_initial.sql` y `0001_english_names_auth.sql` sin error.

- [ ] **Step 4: Verificar los datos migrados**

Run:
```bash
docker run --rm -e CLOUDFLARE_API_TOKEN -e CI=true -v "$PWD/worker":/app -w /app node:22-slim npx --yes wrangler@4 d1 execute decretos_firma_db --remote --command "SELECT rut, name, is_active, must_change_pin, is_admin FROM users ORDER BY name" 2>&1 | tail -30
```
Expected: Dante (`19497478-7`, `is_admin = 0`) y Matías (`19572933-6`, `is_admin = 1`), ambos `is_active = 1` y `must_change_pin = 1`.

Si la migración falla a medias: **parar**, no desplegar, y restaurar/diagnosticar con el respaldo del Step 2.

- [ ] **Step 5: Desplegar el Worker**

Run:
```bash
docker run --rm -e CLOUDFLARE_API_TOKEN -e CI=true -v "$PWD/worker":/app -w /app node:22-slim npx --yes wrangler@4 deploy 2>&1 | grep -i -E "deployed|error|version"
```
Expected: `Deployed decretos-firma-api triggers` y una `Current Version ID`.

- [ ] **Step 6: Verificar producción con `curl`**

Run:
```bash
U=https://decretos-firma-api.dfuentes-e72.workers.dev
V='Origin: https://dante-frontend-ashen.vercel.app'
curl -s -m 20 $U/api/usuarios -o /dev/null -w "lista pública antigua: %{http_code} (esperado 404)\n"
curl -s -m 20 $U/api/decrees/DP-1 -o /dev/null -w "decreto sin sesión: %{http_code} (esperado 401)\n"
curl -s -m 20 -i -X OPTIONS $U/api/login -H "$V" -H 'Access-Control-Request-Method: POST' | grep -i -E "^HTTP|allow-origin"
curl -s -m 20 -X POST $U/api/login -H 'Content-Type: application/json' -d '{"rut":"19572933-6","pin":"0000"}'
```
Expected: `404`, `401`, preflight `204` con `access-control-allow-origin` del dominio de Vercel, y login con `{"error":"RUT o PIN incorrecto"}`. (Un intento fallido queda en `access_log`; es esperado.)

- [ ] **Step 7: Merge a `main` y push** (confirmar con el usuario)

Run:
```bash
git switch main && git merge --ff-only feat/auth-admin && git push origin main && git branch -d feat/auth-admin
```
Expected: push exitoso; Vercel inicia un deploy automático del frontend.

- [ ] **Step 8: Verificar el frontend desplegado**

Run: `sleep 60; curl -s -m 20 https://dante-frontend-ashen.vercel.app/app.js | head -3`
Expected: la primera línea es `'use strict';`.

- [ ] **Step 9: Prueba manual en producción con el usuario**

  1. Matías entra a https://dante-frontend-ashen.vercel.app/ con RUT `19572933-6` y su PIN actual (`2933` si no lo había cambiado) → modal forzado de cambio de PIN.
  2. Tras cambiarlo, "Administración" → **Resetear PIN** de Dante → copiar el PIN nuevo y entregárselo.
  3. Dante entra con ese PIN, lo cambia, consulta y firma un decreto de prueba.
  4. En "Últimos accesos" aparecen todos los intentos, sin PIN.

- [ ] **Step 10: Limpieza de seguridad**

Recordar al usuario: **revocar o reducir** el token de Cloudflare del `.env` (hoy tiene KV, R2, Pages, etc.) y borrar de Vercel las 2 variables de entorno que no usa este frontend.
