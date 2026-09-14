// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Metas (Etapa 7 do produto real)
//
// Contrato definido pelo FRONTEND JÁ EXISTENTE (assets/js/app.js):
//   GET    /metas                    (lista as metas, sem progresso)
//   POST   /metas   { titulo, tipo, periodo, valorAlvo, dataInicio, dataFim }
//   DELETE /metas/:id
//   GET    /metas/:id/progresso      -> { realizado }
//
// Não existe PUT /metas/:id no frontend real — não foi criado aqui.
//
// PROGRESSO É SEMPRE DERIVADO, NUNCA ARMAZENADO (loja.calcularProgressoMeta,
// modo real, chama exatamente GET /metas/:id/progresso). Isso evita a
// duplicidade "Financeiro diz X, Meta diz Y" citada no pedido — não há
// nenhuma cópia do valor realizado guardada nesta tabela.
//
// Cada "tipo" de meta deriva de uma fonte diferente (replicando
// FIELMENTE a fórmula do modo demo, loja.calcularProgressoMeta):
//   recebimentos         -> soma de pagamentos.valor_recebido no período
//   capital_emprestado   -> soma de emprestimos.capital no período
//                           (inclui empréstimos CANCELADOS — o próprio
//                           modo demo não filtra por status aqui; é uma
//                           escolha do produto, não um bug, replicada
//                           fielmente e sinalizada no relatório final)
//   quantidade_operacoes -> contagem de emprestimos no período
//   ganho                -> soma, por pagamento no período, de
//                           valor_recebido * (ganhoPrevisto/total) do
//                           empréstimo daquele pagamento
//
// O "período" de uma meta é sempre [dataInicio, dataFim] — uma comparação
// de datas de calendário armazenadas (DATE), sem envolver "hoje" nem
// fuso horário: não há lógica temporal nova a introduzir aqui.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

const TIPOS = ['capital_emprestado', 'recebimentos', 'ganho', 'quantidade_operacoes'];
const PERIODOS = ['mensal', 'trimestral', 'anual', 'personalizado'];

function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function montarResposta(m) {
  return {
    id: m.id, titulo: m.titulo, tipo: m.tipo, periodo: m.periodo,
    valorAlvo: Number(m.valor_alvo),
    dataInicio: m.data_inicio instanceof Date ? m.data_inicio.toISOString().slice(0, 10) : m.data_inicio,
    dataFim: m.data_fim instanceof Date ? m.data_fim.toISOString().slice(0, 10) : m.data_fim,
    criadoEm: m.criado_em,
  };
}

// GET /api/metas
router.get('/', async (req, res) => {
  try {
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(`SELECT * FROM metas ORDER BY criado_em DESC`));
    res.json(r.rows.map(montarResposta));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar metas.' });
    console.error('[metas] erro ao listar:', err.message);
  }
});

// POST /api/metas
router.post('/', async (req, res) => {
  const corpo = req.body || {};
  const titulo = String(corpo.titulo || '').trim().slice(0, 200);
  const tipo = String(corpo.tipo || '');
  const periodo = String(corpo.periodo || '');
  const valorAlvo = Math.trunc(Number(corpo.valorAlvo));
  const dataInicio = String(corpo.dataInicio || '');
  const dataFim = String(corpo.dataFim || '');

  const erros = [];
  if (!titulo) erros.push('Informe um título para a meta.');
  if (!TIPOS.includes(tipo)) erros.push('Tipo de meta inválido.');
  if (!PERIODOS.includes(periodo)) erros.push('Período inválido.');
  if (!Number.isFinite(valorAlvo) || valorAlvo <= 0) erros.push('Informe um valor alvo válido.');
  if (!dataValida(dataInicio)) erros.push('Data de início inválida.');
  if (!dataValida(dataFim)) erros.push('Data de fim inválida.');
  if (dataValida(dataInicio) && dataValida(dataFim) && dataFim < dataInicio) erros.push('A data de fim não pode ser anterior à data de início.');
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(
      `INSERT INTO metas (usuario_id, titulo, tipo, periodo, valor_alvo, data_inicio, data_fim)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.usuarioId, titulo, tipo, periodo, valorAlvo, dataInicio, dataFim]
    ));
    res.status(201).json(montarResposta(r.rows[0]));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao criar meta.' });
    console.error('[metas] erro ao criar:', err.message);
  }
});

// GET /api/metas/:id/progresso -> { realizado }
router.get('/:id/progresso', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Meta não encontrada.' });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      const rMeta = await c.query('SELECT * FROM metas WHERE id = $1', [id]);
      if (!rMeta.rows.length) return { erro: 404, mensagem: 'Meta não encontrada.' };
      const meta = rMeta.rows[0];

      let realizado = 0;
      if (meta.tipo === 'recebimentos') {
        const r = await c.query(
          `SELECT COALESCE(SUM(valor_recebido_centavos), 0) AS realizado FROM pagamentos WHERE data BETWEEN $1 AND $2`,
          [meta.data_inicio, meta.data_fim]
        );
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'capital_emprestado') {
        const r = await c.query(
          `SELECT COALESCE(SUM(capital_centavos), 0) AS realizado FROM emprestimos WHERE data_operacao BETWEEN $1 AND $2`,
          [meta.data_inicio, meta.data_fim]
        );
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'quantidade_operacoes') {
        const r = await c.query(
          `SELECT COUNT(*) AS realizado FROM emprestimos WHERE data_operacao BETWEEN $1 AND $2`,
          [meta.data_inicio, meta.data_fim]
        );
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'ganho') {
        const r = await c.query(
          `SELECT COALESCE(SUM(ROUND(p.valor_recebido_centavos::numeric * (e.total_centavos - e.capital_centavos) / e.total_centavos)), 0) AS realizado
           FROM pagamentos p
           JOIN emprestimos e ON e.id = p.emprestimo_id
           WHERE p.data BETWEEN $1 AND $2`,
          [meta.data_inicio, meta.data_fim]
        );
        realizado = r.rows[0].realizado;
      }
      return { realizado };
    });

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.json({ realizado: Number(resultado.realizado) });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao calcular progresso da meta.' });
    console.error('[metas] erro ao calcular progresso:', err.message);
  }
});

// DELETE /api/metas/:id — exclusão real (meta não é histórico financeiro;
// sem qualquer FK apontando para clientes/emprestimos/pagamentos/
// movimentacoes, excluir uma meta jamais afeta esses dados).
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Meta não encontrada.' });
  try {
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(`DELETE FROM metas WHERE id = $1 RETURNING id`, [id]));
    if (!r.rows.length) return res.status(404).json({ mensagem: 'Meta não encontrada.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao excluir meta.' });
    console.error('[metas] erro ao excluir:', err.message);
  }
});

module.exports = router;
