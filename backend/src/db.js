// ═══════════════════════════════════════════════════════════════════════
// CredPlus — conexão com o banco (mesmo padrão do db.js do próprio ZHEUS)
//
// Isolamento por usuário é imposto por RLS no Postgres, que lê
// `current_setting('app.usuario_id')`. `SET LOCAL` só vale DENTRO de uma
// transação — por isso toda query que toca dado de um usuário passa por
// `comUsuario()`, nunca por `query()` solto.
// ═══════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (err) => console.error('[db] erro no pool:', err.message));

// Query administrativa/sem inquilino (migração, health check). NUNCA para
// dado de usuário.
function query(text, params) {
  return pool.query(text, params);
}

// Executa `fn(cliente)` dentro de uma transação com o contexto do usuário
// aplicado — é isso que as policies de RLS enxergam.
async function comUsuario(usuarioId, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.usuario_id', $1, true)", [String(usuarioId || '')]);
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    try { await cliente.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    cliente.release();
  }
}

// Transação sem contexto de usuário (registro e login usam funções
// SECURITY DEFINER especificas — ver migrations — não uma sessão "admin").
async function comTransacao(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    try { await cliente.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    cliente.release();
  }
}

async function saude() {
  try {
    const t0 = Date.now();
    await query('SELECT 1');
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, motivo: e.message };
  }
}

module.exports = { query, comUsuario, comTransacao, saude, pool };
