// CredPlus — acesso ao Postgres na Vercel Serverless.
//
// Pool pequeno (max 2), criado UMA VEZ no escopo do módulo e reaproveitado
// entre invocações "warm" da Vercel Fluid — não mais uma conexão nova por
// requisição. O medo documentado aqui antes ("Pool esgotaria conexões no
// Neon") valia para um pool recriado a CADA invocação; o padrão oficial da
// Neon para Fluid é justamente o oposto: um pool pequeno e ÚNICO por
// instância de função, reaproveitando a conexão TCP já aberta em vez de
// pagar o handshake (TLS + auth) de novo em toda chamada. `DATABASE_URL`
// continua sendo a mesma string pooled (PgBouncer) de sempre — nada mudou
// nela. `attachDatabasePool` (@vercel/functions) drena as conexões ociosas
// com segurança antes da instância suspender, então elas nunca ficam presas
// nem estouram o limite do Neon.
// Fontes: neon.com/docs/guides/vercel-connection-methods,
// neon.com/docs/connect/choose-connection (pooled por padrão; conexão
// direta só é exigida para migrations, CREATE INDEX CONCURRENTLY,
// LISTEN/NOTIFY ou prepared statement reaproveitado entre queries — nenhum
// desses casos existe nas rotas do CredPlus).
//
// O isolamento por usuário continua via RLS: `withUser()` abre transação,
// aplica `set_config('app.usuario_id', ..., true)` — o `true` final é
// SET LOCAL, escopo da transação, desfeito sozinho no COMMIT/ROLLBACK — e
// só então executa `fn`. É por causa desse `true` que o código já era
// seguro para conexão pooled mesmo antes desta troca: nunca dependeu de
// estado de sessão sobrevivendo entre chamadas.
const { Pool } = require('pg');
const { attachDatabasePool } = require('@vercel/functions');

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não configurada.');
  return url;
}

// Singleton por instância de função (cold start cria, invocações warm
// seguintes reaproveitam) — nunca criar um Pool novo dentro de um handler.
let pool = null;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      connectionTimeoutMillis: 8000,
      max: 2,
      // Tempo que uma conexão ociosa (sem query em andamento) fica aberta
      // antes do próprio Pool fechá-la sozinho — valor do exemplo oficial
      // da Neon/Vercel para Fluid (curto de propósito: a instância pode
      // suspender a qualquer momento, então não vale segurar conexão ociosa
      // por muito tempo).
      idleTimeoutMillis: 5000,
    });
    // Drena as conexões ociosas do pool ANTES da instância suspender —
    // mecanismo oficial da Vercel Fluid para este exato cenário.
    attachDatabasePool(pool);
  }
  return pool;
}

// Operação pública/sem usuário (health check, registro, login usam funções
// SECURITY DEFINER — nunca dado de usuário direto).
async function queryPublica(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// Transação com contexto do usuário para a RLS enxergar.
async function withUser(usuarioId, fn) {
  const client = await getPool().connect();
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
    client.release();
  }
}

module.exports = { queryPublica, withUser };
