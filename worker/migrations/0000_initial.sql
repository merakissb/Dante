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
