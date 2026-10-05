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
