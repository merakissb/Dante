// API para el sistema de firma de decretos de pago
// Endpoints públicos:
//   GET  /api/usuarios                    -> lista de firmantes activos (rut, nombre)
//   GET  /api/decreto/:id                 -> tenedor actual + historial de firmas
//   POST /api/decreto/:id/firmar          -> { rut, pin } firma el decreto
//   POST /api/usuarios/:rut/cambiar-pin   -> { pin_actual, pin_nuevo } el propio usuario cambia su PIN
// Endpoints de administración (requieren header Authorization: Bearer <ADMIN_SECRET>):
//   POST  /api/admin/usuarios             -> { rut, nombre, pin? } crea un usuario
//                                             (si no se manda pin, se usa por defecto los
//                                             últimos 4 dígitos del RUT y se marca para cambio obligatorio)
//   PATCH /api/admin/usuarios/:rut        -> { activo?, pin? } habilita/deshabilita o resetea pin
//
// Todo usuario nuevo (o con el PIN reseteado por un admin) queda con requiere_cambio_pin = 1.
// Esto significa que su PIN vigente son los últimos 4 dígitos de su RUT, y se espera que lo
// cambie por uno personal vía /cambiar-pin — así ni el admin ni nadie más conoce su PIN final.

const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 15;

function normalizarRut(rut) {
  return String(rut || '').replace(/\./g, '').replace(/\s/g, '').toUpperCase();
}

function validarRut(rutCompleto) {
  if (!/^\d{7,8}-[\dK]$/.test(rutCompleto)) return false;
  const [num, dv] = rutCompleto.split('-');
  let suma = 0;
  let multiplo = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    suma += parseInt(num[i], 10) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === dvEsperado;
}

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(salt + pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generarSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Solo estos orígenes pueden llamar a la API desde un navegador.
// Los localhost son para el entorno Docker de desarrollo.
const ORIGENES_PERMITIDOS = [
  'https://dante-frontend-ashen.vercel.app',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function conCors(response, request) {
  const origen = request.headers.get('Origin');
  if (ORIGENES_PERMITIDOS.includes(origen)) {
    response.headers.set('Access-Control-Allow-Origin', origen);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

const api = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      // --- GET /api/usuarios ---
      if (pathname === '/api/usuarios' && method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT rut, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre'
        ).all();
        return json(results);
      }

      // --- GET /api/decreto/:id ---
      const verMatch = pathname.match(/^\/api\/decreto\/([^/]+)$/);
      if (verMatch && method === 'GET') {
        const decretoId = decodeURIComponent(verMatch[1]);

        const decreto = await env.DB.prepare(
          `SELECT d.id, d.tenedor_actual, u.nombre AS tenedor_nombre
           FROM decretos d LEFT JOIN usuarios u ON u.rut = d.tenedor_actual
           WHERE d.id = ?`
        ).bind(decretoId).first();

        if (!decreto) {
          return json({ id: decretoId, tenedor_actual: null, historial: [] });
        }

        const { results: historial } = await env.DB.prepare(
          `SELECT rut_firmante, nombre_firmante, fecha_hora
           FROM firmas WHERE decreto_id = ? ORDER BY fecha_hora DESC`
        ).bind(decretoId).all();

        return json({
          id: decreto.id,
          tenedor_actual: decreto.tenedor_actual
            ? { rut: decreto.tenedor_actual, nombre: decreto.tenedor_nombre }
            : null,
          historial,
        });
      }

      // --- POST /api/decreto/:id/firmar ---
      const firmarMatch = pathname.match(/^\/api\/decreto\/([^/]+)\/firmar$/);
      if (firmarMatch && method === 'POST') {
        const decretoId = decodeURIComponent(firmarMatch[1]);
        const body = await request.json().catch(() => ({}));
        const rut = normalizarRut(body.rut);
        const pin = String(body.pin || '');

        if (!/^\d{4}$/.test(pin)) {
          return json({ error: 'El PIN debe tener 4 dígitos' }, 400);
        }

        const usuario = await env.DB.prepare(
          'SELECT * FROM usuarios WHERE rut = ? AND activo = 1'
        ).bind(rut).first();

        if (!usuario) {
          return json({ error: 'Usuario no autorizado' }, 403);
        }

        if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
          return json(
            { error: `Cuenta bloqueada temporalmente hasta ${usuario.bloqueado_hasta}` },
            423
          );
        }

        const hashIngresado = await hashPin(pin, usuario.salt);
        if (hashIngresado !== usuario.pin_hash) {
          const intentos = usuario.intentos_fallidos + 1;
          const bloqueadoHasta =
            intentos >= MAX_INTENTOS
              ? new Date(Date.now() + BLOQUEO_MINUTOS * 60000).toISOString()
              : null;

          await env.DB.prepare(
            'UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE rut = ?'
          ).bind(intentos, bloqueadoHasta, rut).run();

          return json({ error: 'PIN incorrecto' }, 401);
        }

        await env.DB.prepare(
          'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE rut = ?'
        ).bind(rut).run();

        await env.DB.prepare(
          `INSERT INTO decretos (id, tenedor_actual) VALUES (?, ?)
           ON CONFLICT(id) DO UPDATE SET tenedor_actual = excluded.tenedor_actual`
        ).bind(decretoId, rut).run();

        const fechaHora = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO firmas (decreto_id, rut_firmante, nombre_firmante, fecha_hora)
           VALUES (?, ?, ?, ?)`
        ).bind(decretoId, rut, usuario.nombre, fechaHora).run();

        return json({
          ok: true,
          decreto_id: decretoId,
          tenedor_actual: { rut, nombre: usuario.nombre },
          fecha_hora: fechaHora,
          // si sigue en true, esta firma se hizo con el PIN por defecto (últimos 4 del RUT)
          requiere_cambio_pin: usuario.requiere_cambio_pin === 1,
        });
      }

      // --- POST /api/usuarios/:rut/cambiar-pin (autoservicio, sin admin) ---
      const cambiarPinMatch = pathname.match(/^\/api\/usuarios\/([^/]+)\/cambiar-pin$/);
      if (cambiarPinMatch && method === 'POST') {
        const rut = normalizarRut(decodeURIComponent(cambiarPinMatch[1]));
        const body = await request.json().catch(() => ({}));
        const pinActual = String(body.pin_actual || '');
        const pinNuevo = String(body.pin_nuevo || '');

        if (!/^\d{4}$/.test(pinNuevo)) {
          return json({ error: 'El PIN nuevo debe tener 4 dígitos' }, 400);
        }

        const usuario = await env.DB.prepare(
          'SELECT * FROM usuarios WHERE rut = ? AND activo = 1'
        ).bind(rut).first();

        if (!usuario) return json({ error: 'Usuario no autorizado' }, 403);

        if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
          return json(
            { error: `Cuenta bloqueada temporalmente hasta ${usuario.bloqueado_hasta}` },
            423
          );
        }

        const hashActual = await hashPin(pinActual, usuario.salt);
        if (hashActual !== usuario.pin_hash) {
          const intentos = usuario.intentos_fallidos + 1;
          const bloqueadoHasta =
            intentos >= MAX_INTENTOS
              ? new Date(Date.now() + BLOQUEO_MINUTOS * 60000).toISOString()
              : null;
          await env.DB.prepare(
            'UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE rut = ?'
          ).bind(intentos, bloqueadoHasta, rut).run();
          return json({ error: 'PIN actual incorrecto' }, 401);
        }

        if (pinNuevo === pinActual) {
          return json({ error: 'El PIN nuevo debe ser distinto al actual' }, 400);
        }

        const salt = generarSalt();
        const pinHash = await hashPin(pinNuevo, salt);
        await env.DB.prepare(
          `UPDATE usuarios
           SET pin_hash = ?, salt = ?, requiere_cambio_pin = 0, intentos_fallidos = 0, bloqueado_hasta = NULL
           WHERE rut = ?`
        ).bind(pinHash, salt, rut).run();

        return json({ ok: true });
      }

      // --- Endpoints de administración ---
      const auth = request.headers.get('Authorization') || '';
      const esAdmin = env.ADMIN_SECRET && auth === `Bearer ${env.ADMIN_SECRET}`;

      if (pathname === '/api/admin/usuarios' && method === 'POST') {
        if (!esAdmin) return json({ error: 'No autorizado' }, 401);
        const body = await request.json().catch(() => ({}));
        const rut = normalizarRut(body.rut);
        const nombre = String(body.nombre || '').trim();

        if (!validarRut(rut)) return json({ error: 'RUT inválido' }, 400);
        if (!nombre) return json({ error: 'Nombre requerido' }, 400);

        // Si no se especifica un PIN, se usa por defecto los últimos 4 dígitos
        // del RUT (sin el dígito verificador). El usuario deberá cambiarlo.
        const numeroRut = rut.split('-')[0];
        const pin = body.pin ? String(body.pin) : numeroRut.slice(-4);

        if (!/^\d{4}$/.test(pin)) return json({ error: 'El PIN debe tener 4 dígitos' }, 400);

        const salt = generarSalt();
        const pinHash = await hashPin(pin, salt);

        await env.DB.prepare(
          `INSERT INTO usuarios (rut, nombre, pin_hash, salt, activo, requiere_cambio_pin)
           VALUES (?, ?, ?, ?, 1, 1)`
        ).bind(rut, nombre, pinHash, salt).run();

        return json({ ok: true, rut, nombre, pin_inicial: pin });
      }

      const adminUserMatch = pathname.match(/^\/api\/admin\/usuarios\/([^/]+)$/);
      if (adminUserMatch && method === 'PATCH') {
        if (!esAdmin) return json({ error: 'No autorizado' }, 401);
        const rut = normalizarRut(decodeURIComponent(adminUserMatch[1]));
        const body = await request.json().catch(() => ({}));

        if (typeof body.activo === 'boolean') {
          await env.DB.prepare('UPDATE usuarios SET activo = ? WHERE rut = ?')
            .bind(body.activo ? 1 : 0, rut).run();
        }
        if (body.pin) {
          if (!/^\d{4}$/.test(String(body.pin))) {
            return json({ error: 'El PIN debe tener 4 dígitos' }, 400);
          }
          const salt = generarSalt();
          const pinHash = await hashPin(String(body.pin), salt);
          await env.DB.prepare(
            `UPDATE usuarios
             SET pin_hash = ?, salt = ?, requiere_cambio_pin = 1, intentos_fallidos = 0, bloqueado_hasta = NULL
             WHERE rut = ?`
          ).bind(pinHash, salt, rut).run();
        }

        return json({ ok: true });
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: 'Error interno', detalle: String(err) }, 500);
    }
  },
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return conCors(new Response(null, { status: 204 }), request);
    }
    return conCors(await api.fetch(request, env), request);
  },
};
