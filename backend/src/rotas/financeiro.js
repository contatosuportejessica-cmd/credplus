// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Financeiro (Etapa 4 do produto real)
//
// Contrato definido pelo FRONTEND JÁ EXISTENTE (assets/js/app.js):
//   GET  /financeiro/movimentacoes?tipo=&categoria=
//   POST /financeiro/movimentacoes { tipo, descricao, valor, data,
//                                     categoria, observacao,
//                                     clienteId: null, emprestimoId: null }
//     -> hoje a única tela existente ("Nova movimentação") sempre envia
//        clienteId/emprestimoId nulos; aceitamos os dois como OPCIONAIS
//        (o método da loja já previa esses parâmetros) mas nunca criamos
//        aqui uma movimentação de origem "pagamento" ou "emprestimo" — só
//        "manual". As automáticas nascem exclusivamente dentro das rotas
//        de /pagamentos (e, no futuro, /emprestimos) na mesma transação
//        do evento que as origina.
//
// totalEntradas/totalSaidas/saldo são somados no PRÓPRIO frontend a partir
// da lista completa devolvida por este GET — não existe endpoint de
// agregado aqui, e não precisa existir: nada é hardcoded, tudo vem do
// PostgreSQL através desta lista.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function montarMovimentacaoResposta(m) {
  return {
    id: m.id, tipo: m.tipo, origem: m.origem, valor: Number(m.valor_centavos),
    descricao: m.descricao, categoria: m.categoria,
    data: m.data instanceof Date ? m.data.toISOString().slice(0, 10) : m.data,
    observacao: m.observacao,
    clienteId: m.cliente_id, emprestimoId: m.emprestimo_id, pagamentoId: m.pagamento_id,
    cliente: m.cliente_nome != null ? { nome: m.cliente_nome } : null,
    criadoEm: m.criado_em,
  };
}

// GET /api/financeiro/movimentacoes?tipo=&categoria=
router.get('/movimentacoes', async (req, res) => {
  const tipo = String(req.query.tipo || 'todos').trim();
  const categoria = String(req.query.categoria || '').trim();
  if (!['todos', 'entrada', 'saida'].includes(tipo)) return res.status(400).json({ mensagem: 'Filtro de tipo inválido.' });

  try {
    const params = [];
    const condicoes = [];
    if (tipo !== 'todos') { params.push(tipo); condicoes.push(`m.tipo = $${params.length}`); }
    if (categoria) { params.push(categoria); condicoes.push(`m.categoria = $${params.length}`); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(
      `SELECT m.*, cl.nome AS cliente_nome
       FROM movimentacoes_financeiras m
       LEFT JOIN clientes cl ON cl.id = m.cliente_id
       ${where}
       ORDER BY m.data DESC, m.criado_em DESC`,
      params
    ));
    res.json(r.rows.map(montarMovimentacaoResposta));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar movimentações.' });
    console.error('[financeiro] erro ao listar:', err.message);
  }
});

// POST /api/financeiro/movimentacoes — SEMPRE origem 'manual'. Não é
// possível, por esta rota, criar uma movimentação de origem
// 'pagamento'/'emprestimo' (essas nascem só internamente nas rotas que as
// originam, nunca a partir de um campo enviado pelo cliente).
router.post('/movimentacoes', async (req, res) => {
  const corpo = req.body || {};
  const tipo = String(corpo.tipo || '');
  const descricao = String(corpo.descricao || '').trim().slice(0, 300);
  const valor = Math.trunc(Number(corpo.valor));
  const data = String(corpo.data || '');
  const categoria = (String(corpo.categoria || '').trim() || 'Geral').slice(0, 100);
  const observacao = corpo.observacao != null ? String(corpo.observacao).trim().slice(0, 2000) || null : null;
  const clienteIdRaw = corpo.clienteId;
  const emprestimoIdRaw = corpo.emprestimoId;
  const clienteId = clienteIdRaw !== null && clienteIdRaw !== undefined ? parseInt(clienteIdRaw, 10) : null;
  const emprestimoId = emprestimoIdRaw !== null && emprestimoIdRaw !== undefined ? parseInt(emprestimoIdRaw, 10) : null;

  const erros = [];
  if (!['entrada', 'saida'].includes(tipo)) erros.push('Tipo deve ser "entrada" ou "saida".');
  if (!descricao) erros.push('Informe uma descrição.');
  if (!Number.isFinite(valor) || valor <= 0) erros.push('Informe um valor válido maior que zero.');
  if (!dataValida(data)) erros.push('Data inválida.');
  if (clienteIdRaw != null && !Number.isInteger(clienteId)) erros.push('cliente vinculado inválido.');
  if (emprestimoIdRaw != null && !Number.isInteger(emprestimoId)) erros.push('empréstimo vinculado inválido.');
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      // Se um cliente/empréstimo vinculado foi informado, confirma que
      // pertence ao usuário autenticado (RLS decide, nunca o corpo).
      if (clienteId !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteId]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      if (emprestimoId !== null) {
        const r = await c.query('SELECT id FROM emprestimos WHERE id = $1', [emprestimoId]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Empréstimo vinculado não encontrado.' };
      }
      const rMov = await c.query(
        `INSERT INTO movimentacoes_financeiras (usuario_id, tipo, origem, valor_centavos, descricao, categoria, data, observacao, cliente_id, emprestimo_id)
         VALUES ($1,$2,'manual',$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.usuarioId, tipo, valor, descricao, categoria, data, observacao, clienteId, emprestimoId]
      );
      return { movimentacao: rMov.rows[0] };
    });

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.status(201).json(montarMovimentacaoResposta(resultado.movimentacao));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao registrar movimentação.' });
    console.error('[financeiro] erro ao registrar:', err.message);
  }
});

module.exports = router;
