// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Notas (Etapa 8 do produto real)
//
// Contrato definido pelo FRONTEND JÁ EXISTENTE (assets/js/app.js):
//   GET    /notas                (sem filtros — busca é 100% local no
//                                  navegador; ordenação é responsabilidade
//                                  do backend, ver abaixo)
//   POST   /notas   { titulo, conteudo, categoria, clienteId, fixado }
//     -> usado em dois lugares: tela geral de Notas (clienteId sempre
//        null) e aba "Anotações" do detalhe do cliente (categoria fixa
//        'cliente', clienteId real do cliente aberto).
//   PUT    /notas/:id            (usado hoje só para { fixado: bool },
//                                  mas implementado como atualização
//                                  parcial genérica — mesmo padrão já
//                                  usado em Lembretes, sem risco de
//                                  integridade financeira aqui)
//   DELETE /notas/:id            (exclusão real — nota não é histórico
//                                  financeiro)
//
// Ordenação: loja.listarNotas() no modo demo ordena
// (fixado primeiro, depois mais recente primeiro) e retorna isso; no modo
// real ela devolve a resposta da API AS-IS, sem reordenar — então é este
// backend quem precisa entregar já na ordem certa (replicado abaixo com
// ORDER BY fixado DESC, criado_em DESC).
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

const CATEGORIAS = ['geral', 'cliente', 'lembrete', 'reuniao', 'oportunidade', 'ideia'];

function montarResposta(n) {
  return {
    id: n.id, titulo: n.titulo, conteudo: n.conteudo, categoria: n.categoria, fixado: n.fixado,
    clienteId: n.cliente_id, cliente: n.cliente_nome != null ? { nome: n.cliente_nome } : null,
    criadoEm: n.criado_em, atualizadoEm: n.atualizado_em,
  };
}

// GET /api/notas
router.get('/', async (req, res) => {
  try {
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(
      `SELECT n.*, cl.nome AS cliente_nome
       FROM notas n
       LEFT JOIN clientes cl ON cl.id = n.cliente_id
       ORDER BY n.fixado DESC, n.criado_em DESC`
    ));
    res.json(r.rows.map(montarResposta));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar notas.' });
    console.error('[notas] erro ao listar:', err.message);
  }
});

// POST /api/notas
router.post('/', async (req, res) => {
  const corpo = req.body || {};
  const titulo = String(corpo.titulo || '').trim().slice(0, 200);
  const conteudo = corpo.conteudo != null ? String(corpo.conteudo).trim().slice(0, 10000) || null : null;
  const categoria = String(corpo.categoria || 'geral');
  const fixado = !!corpo.fixado;
  const clienteIdRaw = corpo.clienteId;
  const clienteId = clienteIdRaw !== null && clienteIdRaw !== undefined ? parseInt(clienteIdRaw, 10) : null;

  const erros = [];
  if (!titulo) erros.push('Informe um título.');
  if (!CATEGORIAS.includes(categoria)) erros.push('Categoria inválida.');
  if (clienteIdRaw != null && !Number.isInteger(clienteId)) erros.push('Cliente vinculado inválido.');
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      if (clienteId !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteId]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      const rIns = await c.query(
        `INSERT INTO notas (usuario_id, cliente_id, titulo, conteudo, categoria, fixado)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.usuarioId, clienteId, titulo, conteudo, categoria, fixado]
      );
      let clienteNome = null;
      if (clienteId !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1', [clienteId]);
        clienteNome = rc.rows[0]?.nome || null;
      }
      return { nota: rIns.rows[0], clienteNome };
    });

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.status(201).json(montarResposta({ ...resultado.nota, cliente_nome: resultado.clienteNome }));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao criar nota.' });
    console.error('[notas] erro ao criar:', err.message);
  }
});

// PUT /api/notas/:id — atualização parcial (hoje usado sobretudo para fixar/desafixar)
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Nota não encontrada.' });
  const corpo = req.body || {};

  const campos = [];
  const valores = [];
  const erros = [];
  function add(coluna, valor) { campos.push(coluna); valores.push(valor); }

  if (Object.prototype.hasOwnProperty.call(corpo, 'titulo')) {
    const v = String(corpo.titulo || '').trim().slice(0, 200);
    if (!v) erros.push('Título não pode ficar vazio.'); else add('titulo', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'conteudo')) {
    const v = corpo.conteudo != null ? String(corpo.conteudo).trim().slice(0, 10000) || null : null;
    add('conteudo', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'categoria')) {
    const v = String(corpo.categoria || '');
    if (!CATEGORIAS.includes(v)) erros.push('Categoria inválida.'); else add('categoria', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'fixado')) {
    add('fixado', !!corpo.fixado);
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
        `UPDATE notas SET ${setClause}, atualizado_em = now() WHERE id = $1 RETURNING *`,
        [id, ...valores]
      );
      if (!rUpd.rows.length) return { erro: 404, mensagem: 'Nota não encontrada.' };

      let clienteNome = null;
      if (rUpd.rows[0].cliente_id !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1', [rUpd.rows[0].cliente_id]);
        clienteNome = rc.rows[0]?.nome || null;
      }
      return { nota: rUpd.rows[0], clienteNome };
    });

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.json(montarResposta({ ...resultado.nota, cliente_nome: resultado.clienteNome }));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao atualizar nota.' });
    console.error('[notas] erro ao atualizar:', err.message);
  }
});

// DELETE /api/notas/:id — exclusão real (nota não é histórico financeiro)
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Nota não encontrada.' });
  try {
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(`DELETE FROM notas WHERE id = $1 RETURNING id`, [id]));
    if (!r.rows.length) return res.status(404).json({ mensagem: 'Nota não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao excluir nota.' });
    console.error('[notas] erro ao excluir:', err.message);
  }
});

module.exports = router;
