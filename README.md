# Recepción de Decretos de Pago

Sistema para consultar quién tiene un decreto de pago y registrar quién lo recibió
lo último («yo lo tengo»). Backend en Cloudflare Workers + D1, frontend estático en Vercel.
Acceso con login (RUT + PIN), rol admin y registro de accesos.

## Cómo funciona

- **Login:** RUT + PIN de 4 dígitos. La sesión dura 8 horas y vive en la base (D1).
- **Confirmar recepción:** además de estar logueado, se vuelve a pedir el PIN cada vez que
  alguien confirma que tiene un decreto. El último en confirmar queda como quien lo tiene.
- **PIN temporal:** al crear un usuario (o resetear su PIN) el sistema genera un PIN
  aleatorio de 4 dígitos, se muestra **una sola vez** al admin (con botón *Copiar*),
  y la persona debe cambiarlo en su primer ingreso.
- **Admin:** puede crear usuarios, desactivarlos, resetear PINs y ver los últimos
  accesos. Los admins se definen en la base (`users.is_admin`); el primero lo marca la
  migración `0001`.
- **Registro de accesos** (`access_log`): fecha, RUT ingresado, resultado
  (`ok`, `wrong_pin`, `locked`, `unknown_rut`, `inactive_account`), IP y navegador.
  **Nunca se guarda el PIN.**
- Tras 5 PIN incorrectos la cuenta se bloquea 15 minutos (el intento se reserva de forma
  atómica, así que ráfagas en paralelo no esquivan el límite). Además, 30 intentos fallidos
  desde una misma IP en 15 minutos bloquean esa IP (`429`).
- **Cambiar el PIN cierra todas las sesiones**, incluida la actual. Se rechazan PIN débiles
  (`0000`, `1234`, `4321`…) y los últimos 4 dígitos del RUT. Desactivar a un usuario o
  resetear su PIN también cierra sus sesiones.
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
PIN_PEPPER_PROD=<cadena aleatoria larga, la misma que `wrangler secret put PIN_PEPPER`>
```

`PIN_PEPPER` es una "pimienta" secreta que se mezcla (HMAC) con cada PIN antes de guardarlo.
Vive solo como secreto del Worker, nunca en la base: una copia filtrada de la base no basta
para adivinar los 10.000 PIN posibles. **Si se pierde o cambia, nadie puede ingresar** hasta
que el admin resetee los PIN. Sin ella configurada, el Worker rechaza los logins.

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

- El PIN se guarda como HMAC-SHA256 con sal por usuario y pimienta secreta; el token de
  sesión, solo su SHA-256. Las comparaciones son en tiempo constante.
- Las respuestas de la API llevan `Cache-Control: no-store`, `nosniff` y
  `Referrer-Policy: no-referrer`; el frontend se sirve con CSP estricta, `frame-ancestors 'none'`,
  HSTS y demás cabeceras (`frontend/vercel.json`).
- Si cambias de proveedor o dominio del Worker, actualiza `connect-src` en `frontend/vercel.json`.
- Un PIN de 4 dígitos sigue siendo débil por naturaleza. Las defensas son el bloqueo por
  cuenta, el límite por IP y la pimienta; no hay segundo factor. Si las firmas tienen peso
  legal, conviene sumar uno (código por correo o Cloudflare Access).
- Trata `ADMIN_SECRET` y el token de Cloudflare como contraseñas maestras.
