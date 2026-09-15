// CredPlus serverless — Simulações.
// Ciclo em_aberto -> convertida/arquivada, sem exclusão física. Edição
// regenera o cronograma na mesma transação. Conversão reaproveita a
// transação de criação de empréstimos (mesma regra, mesma saída
// automática, mesma idempotência) com a simulação travada por FOR UPDATE.
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO, idRota } = require('../http');
const { criarEmprestimoTransacional, EmprestimoJaProcessado, FREQUENCIAS } = require('./emprestimos');

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
    dataPrimeiraCobranca: paraDataISO(s.data_primeira_cobranca),
    status: s.status, emprestimoId: s.emprestimo_id,
    criadoEm: s.criado_em, atualizadoEm: s.atualizado_em,
  };
}

function montarParcelaSimulacaoResposta(p) {
  return { numero: p.numero, valor: Number(p.valor_centavos), vencimento: paraDataISO(p.vencimento) };
}

function validarCamposFinanceiros(corpo) {
  const clienteId = corpo.clienteId != null && corpo.clienteId !== '' ? parseInt(corpo.clienteId, 10) : null;
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
  if (corpo.clienteId != null && corpo.clienteId !== '' && (!Number.isInteger(clienteId) || clienteId <= 0)) erros.push('Cliente inválido.');
  if (!nome || nome.length < 2) erros.push('Nome da simulação é obrigatório (mínimo 2 caracteres).');
  if (nome.length > 200) erros.push('Nome da simulação excede o tamanho máximo (200).');
  if (!Number.isFinite(capital) || capital <= 0) erros.push('Valor a emprestar deve ser maior que zero.');
  if (!Number.isFinite(total) || total <= capital) erros.push('Valor total a receber deve ser maior que o valor a emprestar.');
  if (!MODOS_VALIDOS.includes(modo)) erros.push('Modo de cálculo inválido.');
  if (!Number.isInteger(qtdParcelas) || qtdParcelas <= 0) erros.push('Quantidade de parcelas inválida.');
  if (!FREQUENCIAS.includes(frequencia)) erros.push('Frequência inválida.');
  if (frequencia === 'personalizado' && (!Number.isInteger(diasPersonalizado) || diasPersonalizado <= 0)) {
    erros.push('Intervalo personalizado inválido.');
  }
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
    erros,
    dados: { clienteId, nome, capital, total, modo, percentual, qtdParcelas, frequencia, diasPersonalizado, dataPrimeiraCobranca, parcelasValidadas },
  };
}

async function validarClienteOpcional(c, clienteId, usuarioId) {
  if (clienteId == null) return null;
  const r = await c.query('SELECT id, status FROM clientes WHERE id = $1 AND usuario_id = $2', [clienteId, usuarioId]);
  if (!r.rows.length) return { erro: 404, mensagem: 'Cliente não encontrado.' };
  if (r.rows[0].status === 'arquivado') {
    return { erro: 400, mensagem: 'Este cliente está arquivado e não pode ser vinculado a uma simulação.' };
  }
  return null;
}

async function nomeCliente(c, clienteId, usuarioId) {
  if (!clienteId) return null;
  const rc = await c.query('SELECT nome FROM clientes WHERE id = $1 AND usuario_id = $2', [clienteId, usuarioId]);
  return (rc.rows[0] || {}).nome || null;
}

async function listar({ query, usuarioId, res }) {
  const status = String(query.status || 'todas').trim();
  const busca = String(query.busca || '').trim();
  if (status !== 'todas' && !STATUS_VALIDOS.includes(status)) {
    return falhar(res, 400, 'Filtro de status inválido.');
  }
  try {
    const condicoes = [];
    const condParams = [];
    if (status !== 'todas') { condParams.push(status); condicoes.push(`s.status = $${condParams.length + 1}`); }
    if (busca) {
      condParams.push(`%${busca}%`);
      const idx = condParams.length + 1;
      condicoes.push(`(s.nome ILIKE $${idx} OR cl.nome ILIKE $${idx})`);
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const params = [usuarioId, ...condParams];
    const r = await db.withUser(usuarioId, (c) => c.query(
      `SELECT s.*, cl.nome AS cliente_nome FROM simulacoes s
       LEFT JOIN clientes cl ON cl.id = s.cliente_id AND cl.usuario_id = $1
       WHERE s.usuario_id = $1${where ? ` AND (${where})` : ''} ORDER BY s.criado_em DESC`, params));
    return ok(res, r.rows.map(montarSimulacaoResumo));
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar simulações.');
  }
}

async function obter({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Simulação não encontrada.');
  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const rSim = await c.query(
        `SELECT s.*, cl.nome AS cliente_nome FROM simulacoes s
         LEFT JOIN clientes cl ON cl.id = s.cliente_id AND cl.usuario_id = $2
         WHERE s.id = $1 AND s.usuario_id = $2`, [id, usuarioId]);
      if (!rSim.rows.length) return null;
      const rPar = await c.query('SELECT * FROM simulacao_parcelas WHERE simulacao_id = $1 AND usuario_id = $2 ORDER BY numero ASC', [id, usuarioId]);
      return { ...montarSimulacaoResumo(rSim.rows[0]), parcelas: rPar.rows.map(montarParcelaSimulacaoResposta) };
    });
    if (!resultado) return falhar(res, 404, 'Simulação não encontrada.');
    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao buscar simulação.');
  }
}

async function criar({ body, usuarioId, res }) {
  const { erros, dados } = validarCamposFinanceiros(body || {});
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const erroCliente = await validarClienteOpcional(c, dados.clienteId, usuarioId);
      if (erroCliente) return erroCliente;
      const rSim = await c.query(
        `INSERT INTO simulacoes (usuario_id, cliente_id, nome, capital_centavos, total_centavos, modo, percentual, qtd_parcelas, frequencia, dias_personalizado, data_primeira_cobranca)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [usuarioId, dados.clienteId, dados.nome, dados.capital, dados.total, dados.modo, dados.percentual,
         dados.qtdParcelas, dados.frequencia, dados.diasPersonalizado, dados.dataPrimeiraCobranca]);
      const sim = rSim.rows[0];
      for (const p of dados.parcelasValidadas) {
        await c.query(
          `INSERT INTO simulacao_parcelas (simulacao_id, usuario_id, numero, valor_centavos, vencimento) VALUES ($1,$2,$3,$4,$5)`,
          [sim.id, usuarioId, p.numero, p.valor, p.vencimento]);
      }
      return { sim, clienteNome: await nomeCliente(c, dados.clienteId, usuarioId) };
    });
    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, {
      ...montarSimulacaoResumo({ ...resultado.sim, cliente_nome: resultado.clienteNome }),
      parcelas: dados.parcelasValidadas.map((p) => ({ numero: p.numero, valor: p.valor, vencimento: p.vencimento })),
    }, 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao salvar simulação.');
  }
}

async function atualizar({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Simulação não encontrada.');
  const { erros, dados } = validarCamposFinanceiros(body || {});
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const erroCliente = await validarClienteOpcional(c, dados.clienteId, usuarioId);
      if (erroCliente) return erroCliente;
      const rAtual = await c.query('SELECT id, status FROM simulacoes WHERE id = $1 AND usuario_id = $2', [id, usuarioId]);
      if (!rAtual.rows.length) return { erro: 404, mensagem: 'Simulação não encontrada.' };
      if (rAtual.rows[0].status !== 'em_aberto') {
        return { erro: 409, mensagem: 'Esta simulação não está mais em aberto e não pode ser editada.' };
      }
      const rUpd = await c.query(
        `UPDATE simulacoes SET cliente_id=$1, nome=$2, capital_centavos=$3, total_centavos=$4, modo=$5, percentual=$6,
                                qtd_parcelas=$7, frequencia=$8, dias_personalizado=$9, data_primeira_cobranca=$10, atualizado_em=now()
         WHERE id = $11 AND status = 'em_aberto' AND usuario_id = $12 RETURNING *`,
        [dados.clienteId, dados.nome, dados.capital, dados.total, dados.modo, dados.percentual,
         dados.qtdParcelas, dados.frequencia, dados.diasPersonalizado, dados.dataPrimeiraCobranca, id, usuarioId]);
      if (!rUpd.rows.length) return { erro: 409, mensagem: 'Esta simulação não está mais em aberto e não pode ser editada.' };
      await c.query('DELETE FROM simulacao_parcelas WHERE simulacao_id = $1 AND usuario_id = $2', [id, usuarioId]);
      for (const p of dados.parcelasValidadas) {
        await c.query(
          `INSERT INTO simulacao_parcelas (simulacao_id, usuario_id, numero, valor_centavos, vencimento) VALUES ($1,$2,$3,$4,$5)`,
          [id, usuarioId, p.numero, p.valor, p.vencimento]);
      }
      return { sim: rUpd.rows[0], clienteNome: await nomeCliente(c, dados.clienteId, usuarioId) };
    });
    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, {
      ...montarSimulacaoResumo({ ...resultado.sim, cliente_nome: resultado.clienteNome }),
      parcelas: dados.parcelasValidadas,
    });
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar simulação.');
  }
}

async function vincularCliente({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Simulação não encontrada.');
  const raw = (body || {}).clienteId;
  const clienteId = raw != null && raw !== '' ? parseInt(raw, 10) : null;
  if (raw != null && raw !== '' && (!Number.isInteger(clienteId) || clienteId <= 0)) {
    return falhar(res, 400, 'Cliente inválido.');
  }
  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const erroCliente = await validarClienteOpcional(c, clienteId, usuarioId);
      if (erroCliente) return erroCliente;
      const r = await c.query(
        `UPDATE simulacoes SET cliente_id = $1, atualizado_em = now() WHERE id = $2 AND usuario_id = $3 RETURNING *`, [clienteId, id, usuarioId]);
      if (!r.rows.length) return { erro: 404, mensagem: 'Simulação não encontrada.' };
      return { sim: r.rows[0], clienteNome: await nomeCliente(c, clienteId, usuarioId) };
    });
    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarSimulacaoResumo({ ...resultado.sim, cliente_nome: resultado.clienteNome }));
  } catch (e) {
    return falhar(res, 500, 'Falha ao vincular cliente.');
  }
}

async function arquivar({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Simulação não encontrada.');
  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query(`UPDATE simulacoes SET status = 'arquivada', atualizado_em = now() WHERE id = $1 AND status = 'em_aberto' AND usuario_id = $2 RETURNING id`, [id, usuarioId]));
    if (!r.rows.length) {
      const existe = await db.withUser(usuarioId, (c) => c.query('SELECT id FROM simulacoes WHERE id = $1 AND usuario_id = $2', [id, usuarioId]));
      if (!existe.rows.length) return falhar(res, 404, 'Simulação não encontrada.');
      return falhar(res, 409, 'Só é possível arquivar uma simulação em aberto.');
    }
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao arquivar simulação.');
  }
}

async function converter({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Simulação não encontrada.');
  const dataOperacao = String((body || {}).dataOperacao || '');
  const observacoes = (body || {}).observacoes != null ? String(body.observacoes).trim().slice(0, 4000) : null;
  const chave = String((body || {}).chaveIdempotencia || '').trim();

  const erros = [];
  if (!dataValida(dataOperacao)) erros.push('Data da operação inválida.');
  if (!chave || chave.length < 8 || chave.length > 200) erros.push('Chave de idempotência ausente ou inválida.');
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const rSim = await c.query('SELECT * FROM simulacoes WHERE id = $1 AND usuario_id = $2 FOR UPDATE', [id, usuarioId]);
      if (!rSim.rows.length) return { erro: 404, mensagem: 'Simulação não encontrada.' };
      const sim = rSim.rows[0];

      if (sim.status === 'convertida') throw new SimulacaoJaConvertida(sim.emprestimo_id);
      if (sim.status === 'arquivada') return { erro: 400, mensagem: 'Não é possível converter uma simulação arquivada.' };
      if (!sim.cliente_id) return { erro: 400, mensagem: 'Selecione um cliente antes de transformar a simulação em empréstimo.' };

      const rPar = await c.query(
        'SELECT numero, valor_centavos, vencimento FROM simulacao_parcelas WHERE simulacao_id = $1 AND usuario_id = $2 ORDER BY numero ASC', [id, usuarioId]);
      const parcelasValidadas = rPar.rows.map((p) => ({
        numero: p.numero, valor: Number(p.valor_centavos), vencimento: paraDataISO(p.vencimento),
      }));

      const criado = await criarEmprestimoTransacional(c, {
        usuarioId, clienteId: sim.cliente_id,
        capital: Number(sim.capital_centavos), total: Number(sim.total_centavos),
        qtdParcelas: sim.qtd_parcelas, frequencia: sim.frequencia,
        dataOperacao, observacoes, chave, parcelasValidadas,
      });
      if (criado.erro) return criado;

      const rVinculo = await c.query(
        `UPDATE simulacoes SET status = 'convertida', emprestimo_id = $1, atualizado_em = now()
         WHERE id = $2 AND status = 'em_aberto' AND usuario_id = $3 RETURNING id`, [criado.emp.id, id, usuarioId]);
      if (!rVinculo.rows.length) throw new SimulacaoJaConvertida(null);

      return { emprestimoId: criado.emp.id };
    });
    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, { ok: true, emprestimoId: resultado.emprestimoId }, 201);
  } catch (e) {
    if (e instanceof EmprestimoJaProcessado || e instanceof SimulacaoJaConvertida) {
      try {
        const r = await db.withUser(usuarioId, (c) => c.query('SELECT emprestimo_id FROM simulacoes WHERE id = $1 AND usuario_id = $2', [id, usuarioId]));
        return ok(res, { ok: true, emprestimoId: (r.rows[0] || {}).emprestimo_id ?? e.emprestimoId, jaConvertida: true });
      } catch {}
    }
    return falhar(res, 500, 'Falha ao converter simulação em empréstimo.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (method === 'GET' && seg.length === 0) return listar(ctx);
  if (method === 'GET' && seg.length === 1) return obter(ctx);
  if (method === 'POST' && seg.length === 0) return criar(ctx);
  if (method === 'PUT' && seg.length === 1) return atualizar(ctx);
  if (method === 'PUT' && seg.length === 2 && seg[1] === 'cliente') return vincularCliente(ctx);
  if (method === 'DELETE' && seg.length === 1) return arquivar(ctx);
  if (method === 'POST' && seg.length === 2 && seg[1] === 'converter') return converter(ctx);
  return null;
}

module.exports = { tratar };
