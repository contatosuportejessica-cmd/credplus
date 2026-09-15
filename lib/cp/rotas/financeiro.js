// CredPlus serverless — Financeiro.
// Regra do backend antigo: por esta rota só nascem movimentações de origem
// 'manual'; as automáticas nascem dentro de /pagamentos e /emprestimos.
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO } = require('../http');

function montarMovimentacaoResposta(m) {
  return {
    id: m.id, tipo: m.tipo, origem: m.origem, valor: Number(m.valor_centavos),
    descricao: m.descricao, categoria: m.categoria,
    data: paraDataISO(m.data), observacao: m.observacao,
    clienteId: m.cliente_id, emprestimoId: m.emprestimo_id, pagamentoId: m.pagamento_id,
    cliente: m.cliente_nome != null ? { nome: m.cliente_nome } : null,
    criadoEm: m.criado_em,
  };
}

async function listar({ query, usuarioId, res }) {
  const tipo = String(query.tipo || 'todos').trim();
  const categoria = String(query.categoria || '').trim();
  if (!['todos', 'entrada', 'saida'].includes(tipo)) return falhar(res, 400, 'Filtro de tipo inválido.');

  try {
    const params = [];
    const condicoes = [];
    if (tipo !== 'todos') { params.push(tipo); condicoes.push(`m.tipo = $${params.length}`); }
    if (categoria) { params.push(categoria); condicoes.push(`m.categoria = $${params.length}`); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const r = await db.withUser(usuarioId, (c) => c.query(
      `SELECT m.*, cl.nome AS cliente_nome
       FROM movimentacoes_financeiras m
       LEFT JOIN clientes cl ON cl.id = m.cliente_id
       ${where} ORDER BY m.data DESC, m.criado_em DESC`, params));
    return ok(res, r.rows.map(montarMovimentacaoResposta));
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar movimentações.');
  }
}

async function criar({ body, usuarioId, res }) {
  const corpo = body || {};
  const tipo = String(corpo.tipo || '');
  const descricao = String(corpo.descricao || '').trim().slice(0, 300);
  const valor = Math.trunc(Number(corpo.valor));
  const data = String(corpo.data || '');
  const categoria = (String(corpo.categoria || '').trim() || 'Geral').slice(0, 100);
  const observacao = corpo.observacao != null ? String(corpo.observacao).trim().slice(0, 2000) || null : null;
  const clienteId = corpo.clienteId !== null && corpo.clienteId !== undefined ? parseInt(corpo.clienteId, 10) : null;
  const emprestimoId = corpo.emprestimoId !== null && corpo.emprestimoId !== undefined ? parseInt(corpo.emprestimoId, 10) : null;

  const erros = [];
  if (!['entrada', 'saida'].includes(tipo)) erros.push('Tipo deve ser "entrada" ou "saida".');
  if (!descricao) erros.push('Informe uma descrição.');
  if (!Number.isFinite(valor) || valor <= 0) erros.push('Informe um valor válido maior que zero.');
  if (!dataValida(data)) erros.push('Data inválida.');
  if (corpo.clienteId != null && !Number.isInteger(clienteId)) erros.push('cliente vinculado inválido.');
  if (corpo.emprestimoId != null && !Number.isInteger(emprestimoId)) erros.push('empréstimo vinculado inválido.');
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
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
        [usuarioId, tipo, valor, descricao, categoria, data, observacao, clienteId, emprestimoId]);
      return { movimentacao: rMov.rows[0] };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarMovimentacaoResposta(resultado.movimentacao), 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao registrar movimentação.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (seg.length === 1 && seg[0] === 'movimentacoes') {
    if (method === 'GET') return listar(ctx);
    if (method === 'POST') return criar(ctx);
  }
  return null;
}

module.exports = { tratar };
