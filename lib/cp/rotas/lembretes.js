// CredPlus serverless — Lembretes (CRUD, sem filtros server-side;
// o frontend ordena/agrupa sozinho).
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO, idRota } = require('../http');

const TIPOS = ['cobranca', 'cliente', 'operacao', 'reuniao', 'pessoal'];
const PRIORIDADES = ['alta', 'media', 'baixa'];
const ALERTAS = ['no-dia', '1-dia', '3-dias', 'personalizado'];

function horaValida(s) {
  return typeof s === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}

function montarResposta(l) {
  return {
    id: l.id, descricao: l.descricao, tipo: l.tipo, prioridade: l.prioridade,
    data: paraDataISO(l.data),
    hora: l.hora != null ? String(l.hora).slice(0, 5) : null,
    alerta: l.alerta, concluido: l.concluido,
    clienteId: l.cliente_id, cliente: l.cliente_nome != null ? { nome: l.cliente_nome } : null,
    criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
  };
}

async function listar({ usuarioId, res }) {
  try {
    const r = await db.withUser(usuarioId, (c) => c.query(
      `SELECT l.*, cl.nome AS cliente_nome FROM lembretes l
       LEFT JOIN clientes cl ON cl.id = l.cliente_id ORDER BY l.criado_em DESC`));
    return ok(res, r.rows.map(montarResposta));
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar lembretes.');
  }
}

async function criar({ body, usuarioId, res }) {
  const corpo = body || {};
  const descricao = String(corpo.descricao || '').trim().slice(0, 300);
  const tipo = String(corpo.tipo || 'pessoal');
  const prioridade = String(corpo.prioridade || 'media');
  const data = String(corpo.data || '');
  const hora = corpo.hora != null && corpo.hora !== '' ? String(corpo.hora) : null;
  const alerta = corpo.alerta != null && corpo.alerta !== '' ? String(corpo.alerta) : null;
  const clienteId = corpo.clienteId !== null && corpo.clienteId !== undefined ? parseInt(corpo.clienteId, 10) : null;

  const erros = [];
  if (!descricao) erros.push('Informe a descrição do lembrete.');
  if (!TIPOS.includes(tipo)) erros.push('Tipo inválido.');
  if (!PRIORIDADES.includes(prioridade)) erros.push('Prioridade inválida.');
  if (!dataValida(data)) erros.push('Data inválida.');
  if (hora !== null && !horaValida(hora)) erros.push('Horário inválido.');
  if (alerta !== null && !ALERTAS.includes(alerta)) erros.push('Alerta inválido.');
  if (corpo.clienteId != null && !Number.isInteger(clienteId)) erros.push('Cliente vinculado inválido.');
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      if (clienteId !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteId]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      const rIns = await c.query(
        `INSERT INTO lembretes (usuario_id, cliente_id, descricao, tipo, prioridade, data, hora, alerta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [usuarioId, clienteId, descricao, tipo, prioridade, data, hora, alerta]);
      let clienteNome = null;
      if (clienteId !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1', [clienteId]);
        clienteNome = (rc.rows[0] || {}).nome || null;
      }
      return { lembrete: rIns.rows[0], clienteNome };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarResposta({ ...resultado.lembrete, cliente_nome: resultado.clienteNome }), 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao criar lembrete.');
  }
}

async function atualizar({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Lembrete não encontrado.');
  const corpo = body || {};

  const campos = [];
  const valores = [];
  const erros = [];
  const add = (coluna, valor) => { campos.push(coluna); valores.push(valor); };

  if (Object.prototype.hasOwnProperty.call(corpo, 'descricao')) {
    const v = String(corpo.descricao || '').trim().slice(0, 300);
    if (!v) erros.push('Descrição não pode ficar vazia.'); else add('descricao', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'tipo')) {
    const v = String(corpo.tipo || '');
    if (!TIPOS.includes(v)) erros.push('Tipo inválido.'); else add('tipo', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'prioridade')) {
    const v = String(corpo.prioridade || '');
    if (!PRIORIDADES.includes(v)) erros.push('Prioridade inválida.'); else add('prioridade', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'data')) {
    const v = String(corpo.data || '');
    if (!dataValida(v)) erros.push('Data inválida.'); else add('data', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'hora')) {
    const v = corpo.hora != null && corpo.hora !== '' ? String(corpo.hora) : null;
    if (v !== null && !horaValida(v)) erros.push('Horário inválido.'); else add('hora', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'alerta')) {
    const v = corpo.alerta != null && corpo.alerta !== '' ? String(corpo.alerta) : null;
    if (v !== null && !ALERTAS.includes(v)) erros.push('Alerta inválido.'); else add('alerta', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'concluido')) add('concluido', !!corpo.concluido);
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
        const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteIdNovo]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      if (temClienteId) { campos.push('cliente_id'); valores.push(clienteIdNovo); }
      const setClause = campos.map((col, i) => `${col} = $${i + 2}`).join(', ');
      const rUpd = await c.query(
        `UPDATE lembretes SET ${setClause}, atualizado_em = now() WHERE id = $1 RETURNING *`, [id, ...valores]);
      if (!rUpd.rows.length) return { erro: 404, mensagem: 'Lembrete não encontrado.' };
      let clienteNome = null;
      if (rUpd.rows[0].cliente_id !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1', [rUpd.rows[0].cliente_id]);
        clienteNome = (rc.rows[0] || {}).nome || null;
      }
      return { lembrete: rUpd.rows[0], clienteNome };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarResposta({ ...resultado.lembrete, cliente_nome: resultado.clienteNome }));
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar lembrete.');
  }
}

async function excluir({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Lembrete não encontrado.');
  try {
    const r = await db.withUser(usuarioId, (c) => c.query(`DELETE FROM lembretes WHERE id = $1 RETURNING id`, [id]));
    if (!r.rows.length) return falhar(res, 404, 'Lembrete não encontrado.');
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao excluir lembrete.');
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
