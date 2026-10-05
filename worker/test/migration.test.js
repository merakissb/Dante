import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

const run = (sql, ...binds) => env.DB.prepare(sql).bind(...binds).run();

describe('migration 0001 on a populated old-schema database', () => {
  it('keeps rows, rewrites foreign keys and promotes the first admin', async () => {
    const initial = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0000'));
    const english = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0001'));

    // Rewind to the old (Spanish) schema, like production before this feature.
    for (const table of ['signatures', 'decrees', 'sessions', 'access_log', 'users']) {
      await run(`DROP TABLE IF EXISTS ${table}`);
    }
    await applyD1Migrations(env.DB, [initial], 'rewind_old_migrations');

    await run(
      'INSERT INTO usuarios (rut, nombre, pin_hash, salt) VALUES (?, ?, ?, ?)',
      '19572933-6', 'Admin', 'hash-m', 'salt-m'
    );
    await run(
      'INSERT INTO usuarios (rut, nombre, pin_hash, salt, activo, requiere_cambio_pin) VALUES (?, ?, ?, ?, 0, 0)',
      '44444444-4', 'Persona B', 'hash-d', 'salt-d'
    );
    await run('INSERT INTO decretos (id, tenedor_actual) VALUES (?, ?)', 'DP-1', '19572933-6');
    await run(
      'INSERT INTO firmas (decreto_id, rut_firmante, nombre_firmante, fecha_hora) VALUES (?, ?, ?, ?)',
      'DP-1', '19572933-6', 'Admin', '2026-08-18T09:12:03.000Z'
    );

    await applyD1Migrations(env.DB, [english], 'rewind_new_migrations');

    const { results: users } = await env.DB.prepare(
      'SELECT rut, name, pin_hash, salt, is_active, must_change_pin, failed_attempts, is_admin FROM users ORDER BY rut'
    ).all();
    expect(users).toEqual([
      { rut: '19572933-6', name: 'Admin', pin_hash: 'hash-m', salt: 'salt-m', is_active: 1, must_change_pin: 1, failed_attempts: 0, is_admin: 1 },
      { rut: '44444444-4', name: 'Persona B', pin_hash: 'hash-d', salt: 'salt-d', is_active: 0, must_change_pin: 0, failed_attempts: 0, is_admin: 0 },
    ]);

    const decree = await env.DB.prepare('SELECT id, current_holder FROM decrees').first();
    expect(decree).toEqual({ id: 'DP-1', current_holder: '19572933-6' });

    const signature = await env.DB.prepare(
      'SELECT decree_id, signer_rut, signer_name, signed_at FROM signatures'
    ).first();
    expect(signature).toEqual({
      decree_id: 'DP-1', signer_rut: '19572933-6', signer_name: 'Admin', signed_at: '2026-08-18T09:12:03.000Z',
    });

    // Foreign keys must point at the renamed tables and still be consistent.
    const decreeFk = (await env.DB.prepare('PRAGMA foreign_key_list(decrees)').all()).results;
    expect(decreeFk.map((fk) => fk.table)).toEqual(['users']);
    const signatureFk = (await env.DB.prepare('PRAGMA foreign_key_list(signatures)').all()).results;
    expect(signatureFk.map((fk) => fk.table)).toEqual(['decrees']);
    expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});

describe('migration 0002 normalizes decree ids', () => {
  it('lowercases ids and removes the legacy "1234" test decree, leaving DP-1234 intact', async () => {
    const byPrefix = (prefix) => env.TEST_MIGRATIONS.find((m) => m.name.startsWith(prefix));

    for (const table of ['signatures', 'decrees', 'sessions', 'access_log', 'users']) {
      await run(`DROP TABLE IF EXISTS ${table}`);
    }
    await applyD1Migrations(env.DB, [byPrefix('0000')], 'rewind2_a');
    await applyD1Migrations(env.DB, [byPrefix('0001')], 'rewind2_b');

    const matias = '19572933-6';
    const dante = '44444444-4';
    for (const [rut, name] of [[matias, 'Admin'], [dante, 'Persona B']]) {
      await run('INSERT INTO users (rut, name, pin_hash, salt) VALUES (?, ?, ?, ?)', rut, name, 'h', 's');
    }
    // Production before this migration: the admin used "DP-1234"; another user typed "1234" (no prefix) twice.
    await run('INSERT INTO decrees (id, current_holder) VALUES (?, ?)', 'DP-1234', matias);
    await run('INSERT INTO decrees (id, current_holder) VALUES (?, ?)', '1234', dante);
    await run('INSERT INTO decrees (id, current_holder) VALUES (?, ?)', 'DP-77', dante);
    const sig = (decree, rut, name, at) =>
      run('INSERT INTO signatures (decree_id, signer_rut, signer_name, signed_at) VALUES (?, ?, ?, ?)', decree, rut, name, at);
    await sig('DP-1234', matias, 'Admin', '2026-10-05T17:02:27.564Z');
    await sig('1234', dante, 'Persona B', '2026-10-05T17:04:45.534Z');
    await sig('1234', dante, 'Persona B', '2026-10-05T17:05:02.452Z');
    await sig('DP-77', matias, 'Admin', '2026-10-05T17:10:00.000Z');
    await sig('DP-77', dante, 'Persona B', '2026-10-05T17:20:00.000Z');

    await applyD1Migrations(env.DB, [byPrefix('0002')], 'rewind2_c');

    const { results: decrees } = await env.DB.prepare('SELECT id, current_holder FROM decrees ORDER BY id').all();
    expect(decrees).toEqual([
      { id: 'dp-1234', current_holder: matias },
      { id: 'dp-77', current_holder: dante },
    ]);
    const { results: signatures } = await env.DB.prepare(
      'SELECT decree_id, signer_rut FROM signatures ORDER BY id'
    ).all();
    expect(signatures).toEqual([
      { decree_id: 'dp-1234', signer_rut: matias },
      { decree_id: 'dp-77', signer_rut: matias },
      { decree_id: 'dp-77', signer_rut: dante },
    ]);
    expect((await env.DB.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
  });
});
