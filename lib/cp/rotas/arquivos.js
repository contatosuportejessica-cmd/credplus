// CredPlus serverless — Arquivos do cliente.
// Atendido dentro do dispatcher d-cad (sem função nova, sem rewrite novo):
// clientes.tratar delega para cá quando seg = [clienteId, 'arquivos', ...].
//
// Bytes no próprio Neon (BYTEA, teto de 3MB aplicado aqui) — o disco local
// da VPS não existe em serverless e não há token Blob/S3 no projeto.
// RLS por usuário; exclusão real (arquivo não é histórico financeiro).
const db = require('../db');
const { ok, falhar, paraDataISO, idRota } = require('../http');

const ARQUIVO_MAX_BYTES = 3 * 1024 * 1024;
const MIMES_PERMITIDOS = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

function montarResposta(a) {
  return {
    id: a.id, clienteId: a.cliente_id, nome: a.nome_original, mime: a.mime,
    tamanho: Number(a.tamanho_bytes), criadoEm: a.criado_em,
  };
}

async function clienteExiste(c, clienteId) {
  const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteId]);
  return r.rows.length > 0;
}

// GET /api/clientes/:id/arquivos — lista metadados (sem bytes)
async function listar({ seg, usuarioId, res }) {
  const clienteId = idRota(seg[0]);
  if (clienteId === null) return falhar(res, 404, 'Cliente não encontrado.');
  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      if (!(await clienteExiste(c, clienteId))) return null;
      const r = await c.query(
        `SELECT id, cliente_id, nome_original, mime, tamanho_bytes, criado_em
         FROM arquivos WHERE cliente_id = $1 ORDER BY criado_em DESC`, [clienteId]);
      return r.rows.map(montarResposta);
    });
    if (resultado === null) return falhar(res, 404, 'Cliente não encontrado.');
    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar arquivos.');
  }
}

// POST /api/clientes/:id/arquivos { nome, mime, dados(base64) }
async function enviar({ seg, body, usuarioId, res }) {
  const clienteId = idRota(seg[0]);
  if (clienteId === null) return falhar(res, 404, 'Cliente não encontrado.');
  const corpo = body || {};
  const nome = String(corpo.nome || '').trim().slice(0, 255);
  const mime = String(corpo.mime || '').trim().slice(0, 120);
  const dadosB64 = String(corpo.dados || '');

  if (!nome) return falhar(res, 400, 'Informe o nome do arquivo.');
  if (!MIMES_PERMITIDOS.includes(mime)) return falhar(res, 400, 'Tipo de arquivo não suportado.');
  if (!dadosB64) return falhar(res, 400, 'Arquivo vazio.');
  let bytes;
  try {
    bytes = Buffer.from(dadosB64, 'base64');
  } catch {
    return falhar(res, 400, 'Arquivo inválido.');
  }
  if (!bytes.length || bytes.length > ARQUIVO_MAX_BYTES) {
    return falhar(res, 400, 'Arquivo deve ter entre 1 byte e 3MB.');
  }

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      if (!(await clienteExiste(c, clienteId))) return { erro: 404, mensagem: 'Cliente não encontrado.' };
      const r = await c.query(
        `INSERT INTO arquivos (usuario_id, cliente_id, nome_original, mime, tamanho_bytes, dados)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, cliente_id, nome_original, mime, tamanho_bytes, criado_em`,
        [usuarioId, clienteId, nome, mime, bytes.length, bytes]);
      return { arquivo: r.rows[0] };
    });
    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarResposta(resultado.arquivo), 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao enviar arquivo.');
  }
}

// GET /api/clientes/:id/arquivos/:aid — download binário
async function baixar({ seg, usuarioId, res }) {
  const clienteId = idRota(seg[0]);
  const arquivoId = idRota(seg[2]);
  if (clienteId === null || arquivoId === null) return falhar(res, 404, 'Arquivo não encontrado.');
  try {
    const resultado = await db.withUser(usuarioId, (c) =>
      c.query(`SELECT nome_original, mime, dados FROM arquivos WHERE id = $1 AND cliente_id = $2`, [arquivoId, clienteId]));
    if (!resultado.rows.length) return falhar(res, 404, 'Arquivo não encontrado.');
    const a = resultado.rows[0];
    res.statusCode = 200;
    res.setHeader('Content-Type', a.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(a.nome_original) + '"');
    res.setHeader('Content-Length', a.dados.length);
    res.end(a.dados);
    return res;
  } catch (e) {
    return falhar(res, 500, 'Falha ao baixar arquivo.');
  }
}

// DELETE /api/clientes/:id/arquivos/:aid
async function excluir({ seg, usuarioId, res }) {
  const clienteId = idRota(seg[0]);
  const arquivoId = idRota(seg[2]);
  if (clienteId === null || arquivoId === null) return falhar(res, 404, 'Arquivo não encontrado.');
  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query(`DELETE FROM arquivos WHERE id = $1 AND cliente_id = $2 RETURNING id`, [arquivoId, clienteId]));
    if (!r.rows.length) return falhar(res, 404, 'Arquivo não encontrado.');
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao excluir arquivo.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (seg.length >= 2 && seg[1] === 'arquivos') {
    if (method === 'GET' && seg.length === 2) return listar(ctx);
    if (method === 'POST' && seg.length === 2) return enviar(ctx);
    if (method === 'GET' && seg.length === 3) return baixar(ctx);
    if (method === 'DELETE' && seg.length === 3) return excluir(ctx);
    return null;
  }
  return null;
}

module.exports = { tratar, ARQUIVO_MAX_BYTES };
