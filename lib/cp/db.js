// CredPlus — acesso ao Postgres na Vercel Serverless.
//
// Uma conexão NOVA por invocação (pg.Client, aberta e fechada dentro do
// próprio handler). Sem Pool compartilhado: Pool com limite fixo foi
// desenhado para um processo VPS de vida longa; numa função serverless
// cada invocação criaria seu próprio pool e o Neon esgotaria conexões.
//
// O isolamento por usuário continua via RLS: `withUser()` abre transação,
// aplica `set_config('app.usuario_id', ...)` e só então executa `fn` —
// exatamente a mesma regra do backend antigo (backend/src/db.js), sem
// importar nada de lá.
const { Client } = require('pg');

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada.');
  return url;
}

// Operação pública/sem usuário (health check, registro, login usam funções
// SECURITY DEFINER — nunca dado de usuário direto).
async function queryPublica(text, params) {
  const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end().catch(() => {});
  }
}

// Transação com contexto do usuário para a RLS enxergar.
async function withUser(usuarioId, fn) {
  const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.usuario_id', $1, true)", [String(usuarioId || '')]);
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { queryPublica, withUser };
