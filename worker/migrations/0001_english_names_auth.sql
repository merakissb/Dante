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
