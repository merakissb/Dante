# Firma de Decretos de Pago

Sistema simple para consultar quién tiene un decreto de pago y registrar su firma
de recepción. Backend en Cloudflare Workers + D1, frontend estático para Vercel.

## Opción A — Probar sin nada instalado (modo demo)

`frontend/index.html` trae un **modo demo** activado por defecto (`MODO_DEMO = true`
al inicio del `<script>`): usa datos de prueba en memoria, no llama a ningún
backend. No necesitas wrangler, no necesitas cuenta de Cloudflare, no necesitas
loguearte en nada.

Simplemente abre `frontend/index.html` en el navegador (doble clic, o
arrastrándolo a una pestaña) y prueba con el decreto `DP-2026-0001` y los
usuarios de ejemplo que aparecen en pantalla (verás un aviso "DATOS DE PRUEBA"
en el título). Los cambios se pierden al recargar la página — es solo para
probar la interfaz y el flujo, no para guardar nada real.

Cuando quieras conectarlo al backend de verdad, cambia esa constante a
`MODO_DEMO = false`.

## Opción B — Probar contra el Worker local real (sin login tampoco)

Esto sí simula el backend de verdad (D1 + lógica de PIN/hash), pero **sigue sin
requerir loguearte en Cloudflare**: `wrangler dev` corre 100% en tu máquina por
defecto y no toca nada remoto. El `database_id` de `wrangler.toml` ya viene con
un UUID de relleno que funciona para esto — Wrangler solo lo usa como nombre de
archivo local, no lo valida contra tu cuenta.

```bash
cd worker
npm install -g wrangler   # si no lo tienes

cp .dev.vars.example .dev.vars
# (opcional: cambia el ADMIN_SECRET de ese archivo)

# Crea las tablas en una base de datos LOCAL (un archivo .sqlite en tu disco)
wrangler d1 execute decretos_firma_db --local --file=./schema.sql

# Levanta la API en http://127.0.0.1:8787 — sin login
wrangler dev
```

Si en algún momento Wrangler igual te pide iniciar sesión (puede pasar la
primerísima vez que ejecutas cualquier comando de Wrangler, por temas de
telemetría, no por D1), es un login normal — no crea ni toca ningún recurso en
Cloudflare mientras uses `--local` / `wrangler dev` sin `--remote`.

En otra terminal, crea un par de usuarios de prueba (usa el mismo ADMIN_SECRET
que dejaste en `.dev.vars`):

```bash
bash seed-local.sh
```

Y sirve el frontend local (con `MODO_DEMO = false` en `index.html`):

```bash
cd ../frontend
npx serve .
# o: python3 -m http.server 5500
```

Abre esa URL (ej. `http://localhost:3000`) en el navegador — el frontend
detecta que estás en `localhost` y apunta solo a `http://127.0.0.1:8787` sin
que tengas que tocar nada. El PIN inicial de los usuarios de prueba son los
últimos 4 dígitos de su RUT (`1111` y `2222`).

## Recién ahí: desplegar de verdad

Solo para esto (publicar en Cloudflare/Vercel) sí necesitas login. El
`database_id` real y el login de Cloudflare recién entran en juego acá abajo.

## Desplegar el backend (Cloudflare Worker + D1)

```bash
cd worker
wrangler login   # acá sí es necesario, para publicar de verdad
wrangler d1 create decretos_firma_db
```

Copia el `database_id` que te entrega ese comando y pégalo en `wrangler.toml`
(reemplaza `REEMPLAZA_CON_TU_DATABASE_ID`).

```bash
# Crear las tablas en la base de datos remota (producción)
wrangler d1 execute decretos_firma_db --remote --file=./schema.sql

# Definir el secreto de administración de producción
wrangler secret put ADMIN_SECRET
# te pedirá que escribas una clave larga y secreta — guárdala bien,
# es distinta a la que usas en .dev.vars para local

wrangler deploy
```

Al terminar, wrangler te entrega una URL como:
`https://decretos-firma-api.tu-subdominio.workers.dev`

## Agregar usuarios a la whitelist (producción)

Cada usuario necesita RUT y nombre. **No hace falta que definas el PIN**: si no
lo mandas, el sistema usa automáticamente los últimos 4 dígitos del RUT como
PIN inicial, y queda marcado para que esa persona lo cambie por uno propio.

```bash
curl -X POST https://decretos-firma-api.tu-subdominio.workers.dev/api/admin/usuarios \
  -H "Authorization: Bearer TU_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"rut": "12345678-9", "nombre": "Juan Pérez"}'
```

Para deshabilitar a alguien (sin borrar su historial de firmas):

```bash
curl -X PATCH https://decretos-firma-api.tu-subdominio.workers.dev/api/admin/usuarios/12345678-9 \
  -H "Authorization: Bearer TU_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"activo": false}'
```

Si alguien se bloqueó o perdió su PIN personal, el admin puede resetearlo a uno
temporal (queda marcado para cambio obligatorio otra vez):

```bash
curl -X PATCH https://decretos-firma-api.tu-subdominio.workers.dev/api/admin/usuarios/12345678-9 \
  -H "Authorization: Bearer TU_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"pin": "9034"}'
```

## Desplegar el frontend (Vercel)

1. Abre `frontend/index.html` y reemplaza la URL de producción dentro de la
   constante `API_BASE` por la de tu Worker desplegado (el bloque local ya
   queda resuelto solo).
2. Sube la carpeta `frontend/` a Vercel:
   ```bash
   cd frontend
   npx vercel deploy --prod
   ```
   O arrastra la carpeta a vercel.com/new — es un sitio estático, sin build.

## Cómo funciona

- **Consultar decreto**: se busca por ID y muestra quién lo tiene actualmente
  más el historial completo de firmas (fecha y hora de cada una).
- **Firmar decreto**: al presionar "Firmar este decreto" se elige quién firma
  (de la whitelist) y recién ahí se pide el PIN — nunca antes.
- **Primer ingreso / PIN por defecto**: todo usuario nuevo parte con su PIN
  igual a los últimos 4 dígitos de su RUT. Apenas firma con ese PIN por
  defecto, se le pide automáticamente que lo cambie por uno personal (puede
  posponerlo con "Ahora no"). También puede cambiarlo en cualquier momento
  desde el link "Cambiar mi PIN". El nuevo PIN solo lo conoce esa persona —
  ni el admin puede verlo, solo resetearlo a uno temporal.
- Si el decreto no existía, la primera firma lo crea automáticamente.

## Notas de seguridad

- El PIN nunca se guarda en texto plano: se almacena como hash con sal
  (SHA-256 + salt aleatoria por usuario).
- Tras 5 intentos fallidos (ya sea firmando o cambiando el PIN), la cuenta se
  bloquea 15 minutos — un PIN de 4 dígitos por sí solo (10.000 combinaciones)
  es débil ante fuerza bruta, así que este bloqueo es la defensa principal. El
  PIN por defecto (últimos 4 del RUT) es aún más predecible mientras no se
  cambia, así que si esto firma algo con peso legal/financiero real, vale la
  pena presionar para que todos lo cambien pronto y evaluar un PIN más largo
  o un segundo factor.
- El `ADMIN_SECRET` da control total sobre la whitelist — trátalo como una
  contraseña maestra, y usa uno distinto en local (`.dev.vars`) y en
  producción (`wrangler secret put`).
