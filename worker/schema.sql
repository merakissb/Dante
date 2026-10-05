-- Esquema para el sistema de firma de decretos de pago
-- Ejecutar con: wrangler d1 execute decretos_firma_db --remote --file=./schema.sql

-- Usuarios autorizados (whitelist)
CREATE TABLE IF NOT EXISTS usuarios (
  rut TEXT PRIMARY KEY,               -- RUT normalizado, ej: "12345678-9"
  nombre TEXT NOT NULL,
  pin_hash TEXT NOT NULL,             -- SHA-256(salt + pin), nunca el pin en texto plano
  salt TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,  -- 1 = puede firmar, 0 = deshabilitado
  requiere_cambio_pin INTEGER NOT NULL DEFAULT 1, -- 1 = todavía usa el PIN por defecto (últimos 4 del RUT)
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT                -- ISO datetime; NULL si no está bloqueado
);

-- Decretos de pago
CREATE TABLE IF NOT EXISTS decretos (
  id TEXT PRIMARY KEY,                -- ID del decreto, ej: "DP-2026-0453"
  tenedor_actual TEXT,                -- RUT de quien tiene el decreto ahora
  FOREIGN KEY (tenedor_actual) REFERENCES usuarios(rut)
);

-- Historial de firmas (cadena de custodia)
CREATE TABLE IF NOT EXISTS firmas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decreto_id TEXT NOT NULL,
  rut_firmante TEXT NOT NULL,
  nombre_firmante TEXT NOT NULL,      -- copia histórica del nombre al momento de firmar
  fecha_hora TEXT NOT NULL,           -- ISO 8601 completo (fecha + hora)
  FOREIGN KEY (decreto_id) REFERENCES decretos(id)
);

CREATE INDEX IF NOT EXISTS idx_firmas_decreto ON firmas(decreto_id);
