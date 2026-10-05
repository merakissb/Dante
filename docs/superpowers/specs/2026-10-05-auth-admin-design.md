# Login, rol admin y auditoría de accesos — Diseño

Fecha: 2026-10-05 · Estado: pendiente de revisión

## Objetivo

Que solo personas autorizadas entren al sistema de firma de decretos, que quede
registro de quién intentó ingresar, y que un admin (la persona administradora inicial, RUT
`33333333-3`) pueda administrar usuarios desde la app, sin `curl`.

## Alcance

Incluye:
- Login previo con RUT + PIN y sesión en servidor (D1).
- Rol admin y panel para crear/desactivar/resetear usuarios y ver accesos.
- PIN inicial aleatorio, mostrado una sola vez con botón "Copiar".
- Eliminar el selector de usuarios y el endpoint público que lista RUTs.
- Renombrar modelos de datos, columnas, rutas, funciones y variables a inglés.
- Volver a pedir el PIN al firmar (la sesión sola no basta).

Fuera de alcance (decidido): límite por IP, segundo factor, Turnstile,
rotación/purga del log de accesos.

## Convenciones

Todo lo técnico en inglés: tablas en plural y columnas en `snake_case`; JS en
`camelCase`; rutas en inglés. **Solo los textos visibles al usuario siguen en
español.**

## Modelo de datos

Migración `worker/migrations/0001_english_names_auth.sql`, aplicada primero en
local y luego en remoto. Conserva los usuarios existentes.

### Renombres

| Antes | Después |
|---|---|
| `usuarios` | `users` |
| `nombre` | `name` |
| `activo` | `is_active` |
| `requiere_cambio_pin` | `must_change_pin` |
| `intentos_fallidos` | `failed_attempts` |
| `bloqueado_hasta` | `locked_until` |
| `decretos` | `decrees` |
| `tenedor_actual` | `current_holder` |
| `firmas` | `signatures` |
| `decreto_id` | `decree_id` |
| `rut_firmante` | `signer_rut` |
| `nombre_firmante` | `signer_name` |
| `fecha_hora` | `signed_at` |
| `idx_firmas_decreto` | `idx_signatures_decree` |

`rut`, `pin_hash`, `salt`, `id` no cambian.

### Columnas y tablas nuevas

- `users.is_admin INTEGER NOT NULL DEFAULT 0`. La migración marca a
  `33333333-3` con `is_admin = 1`.
- `sessions`: `token_hash TEXT PRIMARY KEY` (SHA-256 del token aleatorio de 32
  bytes), `rut TEXT NOT NULL` (FK a `users`), `created_at TEXT NOT NULL`,
  `expires_at TEXT NOT NULL`. Duración: 8 horas.
- `access_log`: `id INTEGER PK AUTOINCREMENT`, `rut_attempted TEXT NOT NULL`,
  `result TEXT NOT NULL`, `ip TEXT`, `user_agent TEXT`, `created_at TEXT NOT
  NULL`. Índice por `created_at`.
  - `result` ∈ `ok`, `wrong_pin`, `locked`, `unknown_rut`, `inactive_account`.
  - **Nunca se guarda el PIN**, ni correcto ni incorrecto.

`schema.sql` pasa a reflejar el esquema final (instalaciones nuevas).

## API

Sesión: header `Authorization: Bearer <token>`. El token se entrega en
`POST /api/login`.

| Endpoint | Requiere | Descripción |
|---|---|---|
| `POST /api/login` | público | RUT + PIN. Crea sesión y escribe en `access_log`. Reutiliza el bloqueo de 5 intentos / 15 min. |
| `POST /api/logout` | sesión | Borra la sesión. |
| `GET /api/me` | sesión | `{ rut, name, isAdmin, mustChangePin }`. |
| `POST /api/change-pin` | sesión + PIN actual | Cambia solo el PIN propio. |
| `GET /api/decrees/:id` | sesión | Consulta de decreto e historial. |
| `POST /api/decrees/:id/sign` | sesión + PIN | Firma como el usuario de la sesión. Si el decreto no existe, la primera firma lo crea. |
| `GET /api/admin/users` | admin | Lista de usuarios (sin hashes). |
| `POST /api/admin/users` | admin | Crea usuario; responde con el PIN temporal, una sola vez. |
| `PATCH /api/admin/users/:rut` | admin | `{ isActive }` y/o `{ resetPin: true }` (devuelve PIN temporal nuevo). |
| `GET /api/admin/access-log` | admin | Últimos accesos (paginado, más recientes primero). |

Eliminado: `GET /api/usuarios` (lista pública de RUTs).

### Reglas

- **Admin:** sesión con `is_admin = 1`, **o** header con `ADMIN_SECRET`
  (llave de emergencia, solo en `/api/admin/*`).
- **Cambio de PIN obligatorio:** con `must_change_pin = 1`, solo funcionan
  `GET /api/me`, `POST /api/change-pin` y `POST /api/logout`. El resto responde
  `403 { code: "pin_change_required" }`.
- **PIN temporal:** 4 dígitos con `crypto.getRandomValues` (sin sesgo de
  módulo), `must_change_pin = 1`. Aplica a usuario nuevo y a `resetPin`.
- Un admin no puede desactivarse a sí mismo.
- **Login genérico:** el error siempre es `401 { error: "RUT o PIN incorrecto" }`
  salvo bloqueo (`423`, con minutos restantes). El detalle real solo va a
  `access_log`.
- Sesión vencida o inexistente: `401 { code: "session_expired" }`.
  Sin permiso de admin: `403`.
- Se eliminan sesiones vencidas de forma oportunista al hacer login.
- `ip` desde `CF-Connecting-IP`; `user_agent` truncado a 200 caracteres.
- CORS: se mantiene la lista de orígenes permitidos actual.

## Frontend

Una sola página (`frontend/index.html`), sin librerías, textos en español.

1. **Login** (RUT + PIN): única pantalla visible sin sesión.
2. **Cambio de PIN obligatorio:** si `mustChangePin`, bloquea todo lo demás.
   Se elimina "Ahora no".
3. **Principal:** consultar y firmar decretos. Al firmar pide el PIN otra vez.
   Muestra nombre y "Salir".
4. **Panel admin** (solo `isAdmin`): crear usuario (RUT + nombre), tabla de
   usuarios con Desactivar / Resetear PIN, tabla de accesos (fecha, RUT,
   resultado, IP).
   - El PIN temporal se muestra una vez, con botón **Copiar** y aviso de que
     no se vuelve a ver.

El token vive en memoria y en `sessionStorage` (no `localStorage`). Un 401 con
`session_expired` devuelve al login con el aviso "Tu sesión expiró".

Se elimina `MODO_DEMO` y el código de datos de prueba del frontend.

## Pruebas

- Worker: Vitest con `@cloudflare/vitest-pool-workers`, ejecutado en Docker
  (nada instalado en la máquina). Casos: login ok/incorrecto/bloqueado/RUT
  inexistente/cuenta inactiva; que `access_log` nunca contenga el PIN; sesión
  vencida; permisos de admin y llave de emergencia; PIN temporal de 4 dígitos
  distinto del RUT; cambio de PIN obligatorio; firma exige PIN; admin no puede
  desactivarse; la migración conserva datos.
- Frontend: prueba manual en el navegador contra el entorno Docker, luego en
  producción.

## Despliegue

1. Probar migración en local (Docker).
2. Aplicar migración en D1 remota, antes de desplegar el Worker nuevo.
3. Desplegar Worker; verificar con `curl`.
4. Push a `main`; Vercel despliega el frontend.

Hay una breve ventana donde frontend y Worker no coinciden; con 2 usuarios y
sin firmas reales se acepta.

## Riesgos conocidos

- PIN de 4 dígitos sigue siendo débil frente a fuerza bruta distribuida; sin
  límite por IP, la defensa es solo el bloqueo por cuenta (que además permite
  bloquear cuentas ajenas). Aceptado por ahora.
- `ALTER TABLE ... RENAME` debe verificarse en D1 (claves foráneas); se prueba
  en local antes de remoto.
