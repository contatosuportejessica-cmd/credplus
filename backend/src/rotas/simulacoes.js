// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Simulações de operação (proposta salva → pode virar empréstimo)
//
// Uma simulação é um SNAPSHOT de uma proposta apresentada a um cliente
// (ou ainda sem cliente definido). Diferente de Cobranças (view derivada
// de parcelas reais), aqui existe persistência própria porque a proposta
// precisa sobreviver EXATAMENTE como foi apresentada, mesmo que regras do
// sistema mudem no futuro — não é recalculada em leitura.
//
// Ciclo de vida: em_aberto (editável) -> convertida (imutável, gerou um
// empréstimo real) ou arquivada (imutável, só some da listagem principal).
// Nunca exclusão física.
//
// EDIÇÃO (PUT /:id): só permitida com status='em_aberto'. Substitui os
// campos financeiros E regenera simulacao_parcelas por inteiro (DELETE +
// INSERT), tudo dentro de UMA transação (db.comUsuario) — ou a nova
// versão inteira entra, ou nada muda. O guard "WHERE status='em_aberto'"
// no UPDATE garante que uma simulação convertida entre a leitura do
// frontend e o clique em salvar não seja corrompida silenciosamente.
//
// VÍNCULO DE CLIENTE (PUT /:id/cliente): rota separada e permitida em
// QUALQUER status, porque vincular um cliente não é um dado financeiro
// (não está na lista de campos imutáveis de uma simulação convertida).
//
// CONVERSÃO (POST /:id/converter): reaproveita `criarEmprestimoTransacional`
// de rotas/emprestimos.js — mesma regra financeira, mesma saída
// automática, mesma idempotência por chave — dentro da MESMA transação
// que também vincula emprestimo_id e marca status='convertida'. A
// simulação é travada com `SELECT ... FOR UPDATE` logo no início: uma
// segunda tentativa concorrente de converter a MESMA simulação fica
// bloqueada pelo Postgres até a primeira terminar, e ao continuar já
// encontra status='convertida' — nenhum segundo empréstimo é criado. O
// guard "WHERE status='em_aberto'" no UPDATE final é uma segunda camada
// de proteção (defesa em profundidade), não a única.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');
const { criarEmprestimoTransacional, EmprestimoJaProcessado, hojeISO, dataValida, FREQUENCIAS } = require('./emprestimos');

const router = express.Router();
router.use(exigirAuth);

const STATUS_VALIDOS = ['em_aberto', 'convertida', 'arquivada'];
const MODOS_VALIDOS = ['valor-final', 'percentual'];

class SimulacaoJaConvertida extends Error {
  constructor(emprestimoId) { super('simulação já convertida em empréstimo'); this.emprestimoId = emprestimoId; }
}

function montarSimulacaoResumo(s) {
  const capital = Number(s.capital_centavos);
  const total = Number(s.total_centavos);
  return {
    id: s.id, nome: s.nome,
    clienteId: s.cliente_id, cliente: s.cliente_nome != null ? { id: s.cliente_id, nome: s.cliente_nome } : null,
    capital, total, ganhoPrevisto: total - capital,
    modo: s.modo, percentual: s.percentual != null ? Number(s.percentual) : null,
    qtdParcelas: s.qtd_parcelas, frequencia: s.frequencia, diasPersonalizado: s.dias_personalizado,
    dataPrimeiraCobranca: s.data_primeira_cobranca instanceof Date ? s.data_primeira_cobranca.toISOString().slice(0, 10) : s.data_primeira_cobranca,
    status: s.status, emprestimoId: s.emprestimo_id,
    criadoEm: s.criado_em, atualizadoEm: s.atualizado_em,
  };
}

function montarParcelaSimulacaoResposta(p) {
  return {
    numero: p.numero, valor: Number(p.valor_centavos),
    vencimento: p.vencimento instanceof Date ? p.vencimento.toISOString().slice(0, 10) : p.vencimento,
  };
}

function validarCamposFinanceiros(corpo) {
  const clienteIdRaw = corpo.clienteId;
  const clienteId = clienteIdRaw != null && clienteIdRaw !== '' ? parseInt(clienteIdRaw, 10) : null;
  const nome = String(corpo.nome || '').trim();
  const capital = Math.trunc(Number(corpo.capital));
  const total = Math.trunc(Number(corpo.total));
  const modo = String(corpo.modo || '');
  const percentual = corpo.percentual != null && corpo.percentual !== '' ? Number(corpo.percentual) : null;
  const qtdParcelas = parseInt(corpo.qtdParcelas, 10);
  const frequencia = String(corpo.frequencia || '');
  const diasPersonalizado = frequencia === 'personalizado' ? parseInt(corpo.diasPersonalizado, 10) : null;
  const dataPrimeiraCobranca = String(corpo.dataPrimeiraCobranca || '');
  const parcelasEntrada = Array.isArray(corpo.parcelas) ? corpo.parcelas : null;

  const erros = [];
  if (clienteIdRaw != null && clienteIdRaw !== '' && (!Number.isInteger(clienteId) || clienteId <= 0)) erros.push('Cliente inválido.');
  if (!nome || nome.length < 2) erros.push('Nome da simulação é obrigatório (mínimo 2 caracteres).');
  if (nome.length > 200) erros.push('Nome da simulação excede o tamanho máximo (200).');
  if (!Number.isFinite(capital) || capital <= 0) erros.push('Valor a emprestar deve ser maior que zero.');
  if (!Number.isFinite(total) || total <= capital) erros.push('Valor total a receber deve ser maior que o valor a emprestar.');
  if (!MODOS_VALIDOS.includes(modo)) erros.push('Modo de cálculo inválido.');
  if (!Number.isInteger(qtdParcelas) || qtdParcelas <= 0) erros.push('Quantidade de parcelas inválida.');
  if (!FREQUENCIAS.includes(frequencia)) erros.push('Frequência inválida.');
  if (frequencia === 'personalizado' && (!Number.isInteger(diasPersonalizado) || diasPersonalizado <= 0)) erros.push('Intervalo personalizado inválido.');
  if (!dataValida(dataPrimeiraCobranca)) erros.push('Data da primeira cobrança inválida.');
  if (!parcelasEntrada || !parcelasEntrada.length) erros.push('É necessário ao menos uma parcela.');

  let parcelasValidadas = [];
  if (parcelasEntrada && parcelasEntrada.length) {
    let soma = 0;
    for (const [i, p] of parcelasEntrada.entries()) {
      const numero = parseInt(p.numero, 10);
      const valor = Math.trunc(Number(p.valor));
      const vencimento = String(p.vencimento || '');
      if (!Number.isInteger(numero) || numero <= 0) { erros.push(`Parcela ${i + 1}: número inválido.`); continue; }
      if (!Number.isFinite(valor) || valor < 0) { erros.push(`Parcela ${i + 1}: valor inválido.`); continue; }
      if (!dataValida(vencimento)) { erros.push(`Parcela ${i + 1}: vencimento inválido.`); continue; }
      soma += valor;
      parcelasValidadas.push({ numero, valor, vencimento });
    }
    if (Number.isFinite(total) && parcelasValidadas.length === parcelasEntrada.length && soma !== total) {
      erros.push(`A soma das parcelas (${(soma / 100).toFixed(2)}) não é igual ao valor total a receber (${(total / 100).toFixed(2)}).`);
    }
  }

  return {
    erros, dados: { clienteId, nome, capital, total, modo, percentual, qtdParcelas, frequencia, diasPersonalizado, dataPrimeiraCobranca, parcelasValidadas },
  };
}

async function validarClienteOpcional(c, clienteId) {
  if (clienteId == null) return null;
  const r = await c.query('SELECT id, status FROM clientes WHERE id = $1', [clienteId]);
  if (!r.rows.length) return { erro: 404, mensagem: 'Cliente não encontrado.' };
  if (r.rows[0].status === 'arquivado') return { erro: 400, mensagem: 'Este cliente está arquivado e não pode ser vinculado a uma simulação.' };
  return null;
}

// GET /api/simulacoes?status=&busca=
router.get('/', async (req, res) => {
  const status = String(req.query.status || 'todas').trim();
  const busca = String(req.query.busca || '').trim();
  if (status !== 'todas' && !STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ mensagem: 'Filtro de status inválido.' });
  }
  try {
    const condicoes = [];
    const params = [];
    if (status !== 'todas') { params.push(status); condicoes.push(`s.status = $${params.length}`); }
    if (busca) {
      params.push(`%${busca}%`);
      const idx = params.length;
      condicoes.push(`(s.nome ILIKE $${idx} OR cl.nome ILIKE $${idx})`);
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const sql = `
      SELECT s.*, cl.nome AS cliente_nome
      FROM simulacoes s
      LEFT JOIN clientes cl ON cl.id = s.cliente_id
      ${where}
      ORDER BY s.criado_em DESC`;
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(sql, params));
    res.json(r.rows.map(montarSimulacaoResumo));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar simulações.' });
    console.error('[simulacoes] erro ao listar:', err.message);
  }
});

// GET /api/simulacoes/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Simulação não encontrada.' });
  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      const rSim = await c.query(
        `SELECT s.*, cl.nome AS cliente_nome FROM simulacoes s LEFT JOIN clientes cl ON cl.id = s.cliente_id WHERE s.id = $1`,
        [id]
      );
      if (!rSim.rows.length) return null;
      const rPar = await c.query('SELECT * FROM simulacao_parcelas WHERE simulacao_id = $1 ORDER BY numero ASC', [id]);
      return { ...montarSimulacaoResumo(rSim.rows[0]), parcelas: rPar.rows.map(montarParcelaSimulacaoResposta) };
    });
    if (!resultado) return res.status(404).json({ mensagem: 'Simulação não encontrada.' });
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao buscar simulação.' });
    console.error('[simulacoes] erro ao buscar:', err.message);
  }
});

// POST /api/simulacoes — cria uma simulação nova, sempre em_aberto.
router.post('/', async (req, res) => {
  const { erros, dados } = validarCamposFinanceiros(req.body || {});
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      const erroCliente = await validarClienteOpcional(c, dados.clienteId);
      if (erroCliente) return erroCliente;

      const rSim = await c.query(
        `INSERT INTO simulacoes (usuario_id, cliente_id, nome, capital_centavos, total_centavos, modo, percentual, qtd_parcelas, frequencia, dias_personalizado, data_primeira_cobranca)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.usuarioId, dados.clienteId, dados.nome, dados.capital, dados.total, dados.modo, dados.percentual, dados.qtdParcelas, dados.frequencia, dados.diasPersonalizado, dados.dataPrimeiraCobranca]
      );
      const sim = rSim.rows[0];
      for (const p of dados.parcelasValidadas) {
        await c.query(
          `INSERT INTO simulacao_parcelas (simulacao_id, usuario_id, numero, valor_centavos, vencimento) VALUES ($1,$2,$3,$4,$5)`,
          [sim.id, req.usuarioId, p.numero, p.valor, p.vencimento]
        );
      }
      const clienteNome = dados.clienteId ? (await c.query('SELECT nome FROM clientes WHERE id = $1', [dados.clienteId])).rows[0]?.nome : null;
      return { sim, clienteNome };
    });
    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.status(201).json({ ...montarSimulacaoResumo({ ...resultado.sim, cliente_nome: resultado.clienteNome }), parcelas: dados.parcelasValidadas.map((p) => ({ numero: p.numero, valor: p.valor, vencimento: p.vencimento })) });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao salvar simulação.' });
    console.error('[simulacoes] erro ao criar:', err.message);
  }
});

// PUT /api/simulacoes/:id — edição completa, só em_aberto. Regenera o
// cronograma por inteiro na mesma transação (tudo ou nada).
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Simulação não encontrada.' });
  const { erros, dados } = validarCamposFinanceiros(req.body || {});
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      const erroCliente = await validarClienteOpcional(c, dados.clienteId);
      if (erroCliente) return erroCliente;

      const rAtual = await c.query('SELECT id, status FROM simulacoes WHERE id = $1', [id]);
      if (!rAtual.rows.length) return { erro: 404, mensagem: 'Simulação não encontrada.' };
      if (rAtual.rows[0].status !== 'em_aberto') {
        return { erro: 409, mensagem: 'Esta simulação não está mais em aberto e não pode ser editada.' };
      }

      const rUpd = await c.query(
        `UPDATE simulacoes SET cliente_id=$1, nome=$2, capital_centavos=$3, total_centavos=$4, modo=$5, percentual=$6,
                                qtd_parcelas=$7, frequencia=$8, dias_personalizado=$9, data_primeira_cobranca=$10, atualizado_em=now()
         WHERE id = $11 AND status = 'em_aberto' RETURNING *`,
        [dados.clienteId, dados.nome, dados.capital, dados.total, dados.modo, dados.percentual, dados.qtdParcelas, dados.frequencia, dados.diasPersonalizado, dados.dataPrimeiraCobranca, id]
      );
      if (!rUpd.rows.length) return { erro: 409, mensagem: 'Esta simulação não está mais em aberto e não pode ser editada.' };

      await c.query('DELETE FROM simulacao_parcelas WHERE simulacao_id = $1', [id]);
      for (const p of dados.parcelasValidadas) {
        await c.query(
          `INSERT INTO simulacao_parcelas (simulacao_id, usuario_id, numero, valor_centavos, vencimento) VALUES ($1,$2,$3,$4,$5)`,
          [id, req.usuarioId, p.numero, p.valor, p.vencimento]
        );
      }
      const clienteNome = dados.clienteId ? (await c.query('SELECT nome FROM clientes WHERE id = $1', [dados.clienteId])).rows[0]?.nome : null;
      return { sim: rUpd.rows[0], clienteNome };
    });
    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.json({ ...montarSimulacaoResumo({ ...resultado.sim, cliente_nome: resultado.clienteNome }), parcelas: dados.parcelasValidadas });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao atualizar simulação.' });
    console.error('[simulacoes] erro ao atualizar:', err.message);
  }
});

// PUT /api/simulacoes/:id/cliente — vincula/troca o cliente. Permitido em
// qualquer status (não é dado financeiro, não quebra o snapshot de uma
// simulação convertida).
router.put('/:id/cliente', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Simulação não encontrada.' });
  const clienteIdRaw = req.body?.clienteId;
  const clienteId = clienteIdRaw != null && clienteIdRaw !== '' ? parseInt(clienteIdRaw, 10) : null;
  if (clienteIdRaw != null && clienteIdRaw !== '' && (!Number.isInteger(clienteId) || clienteId <= 0)) {
    return res.status(400).json({ mensagem: 'Cliente inválido.' });
  }
  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      const erroCliente = await validarClienteOpcional(c, clienteId);
      if (erroCliente) return erroCliente;
      const r = await c.query(
        `UPDATE simulacoes SET cliente_id = $1, atualizado_em = now() WHERE id = $2 RETURNING *`,
        [clienteId, id]
      );
      if (!r.rows.length) return { erro: 404, mensagem: 'Simulação não encontrada.' };
      const clienteNome = clienteId ? (await c.query('SELECT nome FROM clientes WHERE id = $1', [clienteId])).rows[0]?.nome : null;
      return { sim: r.rows[0], clienteNome };
    });
    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.json(montarSimulacaoResumo({ ...resultado.sim, cliente_nome: resultado.clienteNome }));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao vincular cliente.' });
    console.error('[simulacoes] erro ao vincular cliente:', err.message);
  }
});

// DELETE /api/simulacoes/:id — arquivamento lógico. Só a partir de
// em_aberto (uma simulação convertida nunca deve deixar de aparecer como
// convertida; arquivar não se aplica a ela).
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Simulação não encontrada.' });
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query(`UPDATE simulacoes SET status = 'arquivada', atualizado_em = now() WHERE id = $1 AND status = 'em_aberto' RETURNING id`, [id]));
    if (!r.rows.length) {
      const existe = await db.comUsuario(req.usuarioId, (c) => c.query('SELECT id FROM simulacoes WHERE id = $1', [id]));
      if (!existe.rows.length) return res.status(404).json({ mensagem: 'Simulação não encontrada.' });
      return res.status(409).json({ mensagem: 'Só é possível arquivar uma simulação em aberto.' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao arquivar simulação.' });
    console.error('[simulacoes] erro ao arquivar:', err.message);
  }
});

// POST /api/simulacoes/:id/converter — transforma a simulação em
// empréstimo real. Transacional e idempotente (ver comentário de topo).
router.post('/:id/converter', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Simulação não encontrada.' });
  const dataOperacao = String(req.body?.dataOperacao || '');
  const observacoes = req.body?.observacoes != null ? String(req.body.observacoes).trim().slice(0, 4000) : null;
  const chave = String(req.body?.chaveIdempotencia || '').trim();

  const erros = [];
  if (!dataValida(dataOperacao)) erros.push('Data da operação inválida.');
  if (!chave || chave.length < 8 || chave.length > 200) erros.push('Chave de idempotência ausente ou inválida.');
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      // Trava a linha: uma segunda tentativa concorrente de converter a
      // MESMA simulação espera aqui até esta transação terminar.
      const rSim = await c.query('SELECT * FROM simulacoes WHERE id = $1 FOR UPDATE', [id]);
      if (!rSim.rows.length) return { erro: 404, mensagem: 'Simulação não encontrada.' };
      const sim = rSim.rows[0];

      if (sim.status === 'convertida') throw new SimulacaoJaConvertida(sim.emprestimo_id);
      if (sim.status === 'arquivada') return { erro: 400, mensagem: 'Não é possível converter uma simulação arquivada.' };
      if (!sim.cliente_id) return { erro: 400, mensagem: 'Selecione um cliente antes de transformar a simulação em empréstimo.' };

      const rPar = await c.query('SELECT numero, valor_centavos, vencimento FROM simulacao_parcelas WHERE simulacao_id = $1 ORDER BY numero ASC', [id]);
      const parcelasValidadas = rPar.rows.map((p) => ({
        numero: p.numero, valor: Number(p.valor_centavos),
        vencimento: p.vencimento instanceof Date ? p.vencimento.toISOString().slice(0, 10) : p.vencimento,
      }));

      const criado = await criarEmprestimoTransacional(c, {
        usuarioId: req.usuarioId, clienteId: sim.cliente_id,
        capital: Number(sim.capital_centavos), total: Number(sim.total_centavos),
        qtdParcelas: sim.qtd_parcelas, frequencia: sim.frequencia,
        dataOperacao, observacoes, chave, parcelasValidadas,
      });
      if (criado.erro) return criado;

      const rVinculo = await c.query(
        `UPDATE simulacoes SET status = 'convertida', emprestimo_id = $1, atualizado_em = now() WHERE id = $2 AND status = 'em_aberto' RETURNING id`,
        [criado.emp.id, id]
      );
      if (!rVinculo.rows.length) {
        // Não deveria acontecer (a linha está travada por FOR UPDATE desde
        // o início desta mesma transação), mas se acontecer não deixamos
        // um empréstimo "órfão": tudo é revertido e tratamos como conversão
        // já concluída por outra rota.
        throw new SimulacaoJaConvertida(null);
      }

      return { emprestimoId: criado.emp.id };
    });
    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.status(201).json({ ok: true, emprestimoId: resultado.emprestimoId });
  } catch (err) {
    if (err instanceof EmprestimoJaProcessado) {
      try {
        const r = await db.comUsuario(req.usuarioId, (c) => c.query('SELECT emprestimo_id FROM simulacoes WHERE id = $1', [id]));
        if (r.rows[0]?.emprestimo_id) return res.status(200).json({ ok: true, emprestimoId: r.rows[0].emprestimo_id, jaConvertida: true });
      } catch (err2) {
        console.error('[simulacoes] erro ao recuperar conversão idempotente:', err2.message);
      }
    }
    if (err instanceof SimulacaoJaConvertida) {
      try {
        const r = await db.comUsuario(req.usuarioId, (c) => c.query('SELECT emprestimo_id FROM simulacoes WHERE id = $1', [id]));
        return res.status(200).json({ ok: true, emprestimoId: r.rows[0]?.emprestimo_id ?? err.emprestimoId, jaConvertida: true });
      } catch (err2) {
        console.error('[simulacoes] erro ao recuperar simulação já convertida:', err2.message);
      }
    }
    res.status(500).json({ mensagem: 'Falha ao converter simulação em empréstimo.' });
    console.error('[simulacoes] erro ao converter:', err.message);
  }
});

module.exports = router;
