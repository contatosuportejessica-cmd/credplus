// CredPlus serverless — Notas (CRUD + ordenação fixadas primeiro,
// mais recentes depois — o modo real do frontend não reordena).
const db = require('../db');
const { ok, falhar, idRota } = require('../http');

const CATEGORIAS = ['geral', 'cliente', 'lembrete', 'reuniao', 'oportunidade', 'ideia'];

function montarResposta(n) {
  return {
    id: n.id, titulo: n.titulo, conteudo: n.conteudo, categoria: n.categoria, fixado: n.fixado,
    clienteId: n.cliente_id, cliente: n.cliente_nome != null ? { nome: n.cliente_nome } : null,
    criadoEm: n.criado_em, atualizadoEm: n.atualizado_em,
  };
}

async function listar({ usuarioId, res }) {
  try {
    const r = await db.withUser(usuarioId, (c) => c.query(
      `SELECT n.*, cl.nome AS cliente_nome FROM notas n
       LEFT JOIN clientes cl ON cl.id = n.cliente_id AND cl.usuario_id = $1
       WHERE n.usuario_id = $1
       ORDER BY n.fixado DESC, n.criado_em DESC`, [usuarioId]));
    return ok(res, r.rows.map(montarResposta));
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar notas.');
  }
}

async function criar({ body, usuarioId, res }) {
  const corpo = body || {};
  const titulo = String(corpo.titulo || '').trim().slice(0, 200);
  const conteudo = corpo.conteudo != null ? String(corpo.conteudo).trim().slice(0, 10000) || null : null;
  const categoria = String(corpo.categoria || 'geral');
  const fixado = !!corpo.fixado;
  const clienteId = corpo.clienteId !== null && corpo.clienteId !== undefined ? parseInt(corpo.clienteId, 10) : null;

  const erros = [];
  if (!titulo) erros.push('Informe um título.');
  if (!CATEGORIAS.includes(categoria)) erros.push('Categoria inválida.');
  if (corpo.clienteId != null && !Number.isInteger(clienteId)) erros.push('Cliente vinculado inválido.');
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      if (clienteId !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1 AND usuario_id = $2', [clienteId, usuarioId]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      const rIns = await c.query(
        `INSERT INTO notas (usuario_id, cliente_id, titulo, conteudo, categoria, fixado)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [usuarioId, clienteId, titulo, conteudo, categoria, fixado]);
      let clienteNome = null;
      if (clienteId !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1 AND usuario_id = $2', [clienteId, usuarioId]);
        clienteNome = (rc.rows[0] || {}).nome || null;
      }
      return { nota: rIns.rows[0], clienteNome };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarResposta({ ...resultado.nota, cliente_nome: resultado.clienteNome }), 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao criar nota.');
  }
}

async function atualizar({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Nota não encontrada.');
  const corpo = body || {};

  const campos = [];
  const valores = [];
  const erros = [];
  const add = (coluna, valor) => { campos.push(coluna); valores.push(valor); };

  if (Object.prototype.hasOwnProperty.call(corpo, 'titulo')) {
    const v = String(corpo.titulo || '').trim().slice(0, 200);
    if (!v) erros.push('Título não pode ficar vazio.'); else add('titulo', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'conteudo')) {
    add('conteudo', corpo.conteudo != null ? String(corpo.conteudo).trim().slice(0, 10000) || null : null);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'categoria')) {
    const v = String(corpo.categoria || '');
    if (!CATEGORIAS.includes(v)) erros.push('Categoria inválida.'); else add('categoria', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'fixado')) add('fixado', !!corpo.fixado);
  let clienteIdNovo; let temClienteId = false;
  if (Object.prototype.hasOwnProperty.call(corpo, 'clienteId')) {
    temClienteId = true;
    clienteIdNovo = corpo.clienteId !== null && corpo.clienteId !== undefined ? parseInt(corpo.clienteId, 10) : null;
    if (corpo.clienteId != null && !Number.isInteger(clienteIdNovo)) erros.push('Cliente vinculado inválido.');
  }

  if (erros.length) return falhar(res, 400, erros[0], { erros });
  if (!campos.length && !temClienteId) return falhar(res, 400, 'Nenhum campo para atualizar.');

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      if (temClienteId && clienteIdNovo !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1 AND usuario_id = $2', [clienteIdNovo, usuarioId]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      if (temClienteId) { campos.push('cliente_id'); valores.push(clienteIdNovo); }
      const setClause = campos.map((col, i) => `${col} = $${i + 2}`).join(', ');
      const rUpd = await c.query(
        `UPDATE notas SET ${setClause}, atualizado_em = now() WHERE id = $1 AND usuario_id = $${valores.length + 2} RETURNING *`, [id, ...valores, usuarioId]);
      if (!rUpd.rows.length) return { erro: 404, mensagem: 'Nota não encontrada.' };
      let clienteNome = null;
      if (rUpd.rows[0].cliente_id !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1 AND usuario_id = $2', [rUpd.rows[0].cliente_id, usuarioId]);
        clienteNome = (rc.rows[0] || {}).nome || null;
      }
      return { nota: rUpd.rows[0], clienteNome };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarResposta({ ...resultado.nota, cliente_nome: resultado.clienteNome }));
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar nota.');
  }
}

async function excluir({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Nota não encontrada.');
  try {
    const r = await db.withUser(usuarioId, (c) => c.query(`DELETE FROM notas WHERE id = $1 AND usuario_id = $2 RETURNING id`, [id, usuarioId]));
    if (!r.rows.length) return falhar(res, 404, 'Nota não encontrada.');
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao excluir nota.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (method === 'GET' && seg.length === 0) return listar(ctx);
  if (method === 'POST' && seg.length === 0) return criar(ctx);
  if (method === 'PUT' && seg.length === 1) return atualizar(ctx);
  if (method === 'DELETE' && seg.length === 1) return excluir(ctx);
  return null;
}

module.exports = { tratar };
