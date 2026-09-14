// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Lembretes (Etapa 6 do produto real)
//
// Contrato definido pelo FRONTEND JÁ EXISTENTE (assets/js/app.js):
//   GET    /lembretes                (sem filtros — frontend ordena e
//                                      agrupa pendentes/concluídos sozinho)
//   POST   /lembretes   { descricao, tipo, prioridade, data, hora, alerta,
//                          clienteId: null }
//   PUT    /lembretes/:id            (hoje só usado com { concluido: true },
//                                      mas aceito como atualização parcial
//                                      genérica — não existe risco de
//                                      integridade financeira aqui, ao
//                                      contrário de parcelas)
//   DELETE /lembretes/:id            (exclusão real — não é histórico
//                                      financeiro, ver migration 010)
//
// Sem cálculo de "hoje"/atraso aqui: o contrato real não envia nem espera
// nenhum filtro de data — o frontend só ordena a lista já recebida no seu
// próprio fuso local. Nada a corrigir/replicar da convenção
// America/Sao_Paulo usada em Empréstimos/Cobranças, porque esta rota não
// faz nenhuma comparação de data.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

const TIPOS = ['cobranca', 'cliente', 'operacao', 'reuniao', 'pessoal'];
const PRIORIDADES = ['alta', 'media', 'baixa'];
const ALERTAS = ['no-dia', '1-dia', '3-dias', 'personalizado'];

function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function horaValida(s) {
  return typeof s === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}

function montarResposta(l) {
  return {
    id: l.id, descricao: l.descricao, tipo: l.tipo, prioridade: l.prioridade,
    data: l.data instanceof Date ? l.data.toISOString().slice(0, 10) : l.data,
    hora: l.hora != null ? String(l.hora).slice(0, 5) : null,
    alerta: l.alerta, concluido: l.concluido,
    clienteId: l.cliente_id, cliente: l.cliente_nome != null ? { nome: l.cliente_nome } : null,
    criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
  };
}

// GET /api/lembretes
router.get('/', async (req, res) => {
  try {
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(
      `SELECT l.*, cl.nome AS cliente_nome
       FROM lembretes l
       LEFT JOIN clientes cl ON cl.id = l.cliente_id
       ORDER BY l.criado_em DESC`
    ));
    res.json(r.rows.map(montarResposta));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar lembretes.' });
    console.error('[lembretes] erro ao listar:', err.message);
  }
});

// POST /api/lembretes
router.post('/', async (req, res) => {
  const corpo = req.body || {};
  const descricao = String(corpo.descricao || '').trim().slice(0, 300);
  const tipo = String(corpo.tipo || 'pessoal');
  const prioridade = String(corpo.prioridade || 'media');
  const data = String(corpo.data || '');
  const hora = corpo.hora != null && corpo.hora !== '' ? String(corpo.hora) : null;
  const alerta = corpo.alerta != null && corpo.alerta !== '' ? String(corpo.alerta) : null;
  const clienteIdRaw = corpo.clienteId;
  const clienteId = clienteIdRaw !== null && clienteIdRaw !== undefined ? parseInt(clienteIdRaw, 10) : null;

  const erros = [];
  if (!descricao) erros.push('Informe a descrição do lembrete.');
  if (!TIPOS.includes(tipo)) erros.push('Tipo inválido.');
  if (!PRIORIDADES.includes(prioridade)) erros.push('Prioridade inválida.');
  if (!dataValida(data)) erros.push('Data inválida.');
  if (hora !== null && !horaValida(hora)) erros.push('Horário inválido.');
  if (alerta !== null && !ALERTAS.includes(alerta)) erros.push('Alerta inválido.');
  if (clienteIdRaw != null && !Number.isInteger(clienteId)) erros.push('Cliente vinculado inválido.');
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      if (clienteId !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteId]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      const rIns = await c.query(
        `INSERT INTO lembretes (usuario_id, cliente_id, descricao, tipo, prioridade, data, hora, alerta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.usuarioId, clienteId, descricao, tipo, prioridade, data, hora, alerta]
      );
      let clienteNome = null;
      if (clienteId !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1', [clienteId]);
        clienteNome = rc.rows[0]?.nome || null;
      }
      return { lembrete: rIns.rows[0], clienteNome };
    });

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.status(201).json(montarResposta({ ...resultado.lembrete, cliente_nome: resultado.clienteNome }));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao criar lembrete.' });
    console.error('[lembretes] erro ao criar:', err.message);
  }
});

// PUT /api/lembretes/:id — atualização parcial (hoje usado só para concluir)
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Lembrete não encontrado.' });
  const corpo = req.body || {};

  const campos = [];
  const valores = [];
  const erros = [];

  function add(coluna, valor) { campos.push(coluna); valores.push(valor); }

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
  if (Object.prototype.hasOwnProperty.call(corpo, 'concluido')) {
    add('concluido', !!corpo.concluido);
  }
  let clienteIdNovo, temClienteId = false;
  if (Object.prototype.hasOwnProperty.call(corpo, 'clienteId')) {
    temClienteId = true;
    clienteIdNovo = corpo.clienteId !== null && corpo.clienteId !== undefined ? parseInt(corpo.clienteId, 10) : null;
    if (corpo.clienteId != null && !Number.isInteger(clienteIdNovo)) erros.push('Cliente vinculado inválido.');
  }

  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });
  if (!campos.length && !temClienteId) return res.status(400).json({ mensagem: 'Nenhum campo para atualizar.' });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      if (temClienteId && clienteIdNovo !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteIdNovo]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      if (temClienteId) { campos.push('cliente_id'); valores.push(clienteIdNovo); }

      const setClause = campos.map((col, i) => `${col} = $${i + 2}`).join(', ');
      const rUpd = await c.query(
        `UPDATE lembretes SET ${setClause}, atualizado_em = now() WHERE id = $1 RETURNING *`,
        [id, ...valores]
      );
      if (!rUpd.rows.length) return { erro: 404, mensagem: 'Lembrete não encontrado.' };

      let clienteNome = null;
      if (rUpd.rows[0].cliente_id !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1', [rUpd.rows[0].cliente_id]);
        clienteNome = rc.rows[0]?.nome || null;
      }
      return { lembrete: rUpd.rows[0], clienteNome };
    });

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.json(montarResposta({ ...resultado.lembrete, cliente_nome: resultado.clienteNome }));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao atualizar lembrete.' });
    console.error('[lembretes] erro ao atualizar:', err.message);
  }
});

// DELETE /api/lembretes/:id — exclusão real (lembrete não é histórico financeiro)
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Lembrete não encontrado.' });
  try {
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(`DELETE FROM lembretes WHERE id = $1 RETURNING id`, [id]));
    if (!r.rows.length) return res.status(404).json({ mensagem: 'Lembrete não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao excluir lembrete.' });
    console.error('[lembretes] erro ao excluir:', err.message);
  }
});

module.exports = router;
