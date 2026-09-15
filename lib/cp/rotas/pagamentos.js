// CredPlus serverless — Pagamentos.
// Mesmas regras do backend antigo: cliente/empréstimo derivados da parcela
// (nunca confiados do corpo), lock FOR UPDATE na parcela, idempotência por
// chave com backstop no índice único, entrada financeira automática na
// mesma transação, histórico imutável (só INSERT).
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO } = require('../http');

const FORMAS = ['pix', 'dinheiro', 'transferencia', 'outro'];

class PagamentoJaProcessado extends Error {
  constructor(chave) { super('pagamento já processado para esta chave de idempotência'); this.chave = chave; }
}

function montarPagamentoResposta(p) {
  return {
    id: p.id, clienteId: p.cliente_id, emprestimoId: p.emprestimo_id, parcelaId: p.parcela_id,
    valorEsperado: Number(p.valor_esperado_centavos), valorRecebido: Number(p.valor_recebido_centavos),
    data: paraDataISO(p.data), forma: p.forma, observacao: p.observacao,
    criadoEm: p.criado_em,
  };
}

async function listar({ query, usuarioId, res }) {
  const clienteId = query.cliente_id !== undefined ? parseInt(query.cliente_id, 10) : null;
  const emprestimoId = query.emprestimo_id !== undefined ? parseInt(query.emprestimo_id, 10) : null;
  if (query.cliente_id !== undefined && !Number.isInteger(clienteId)) return falhar(res, 400, 'cliente_id inválido.');
  if (query.emprestimo_id !== undefined && !Number.isInteger(emprestimoId)) return falhar(res, 400, 'emprestimo_id inválido.');

  try {
    const params = [];
    const condicoes = [];
    if (clienteId !== null) { params.push(clienteId); condicoes.push(`cliente_id = $${params.length}`); }
    if (emprestimoId !== null) { params.push(emprestimoId); condicoes.push(`emprestimo_id = $${params.length}`); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const r = await db.withUser(usuarioId, (c) =>
      c.query(`SELECT * FROM pagamentos ${where} ORDER BY criado_em DESC`, params));
    return ok(res, r.rows.map(montarPagamentoResposta));
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar pagamentos.');
  }
}

async function registrar({ body, usuarioId, res }) {
  const corpo = body || {};
  const parcelaId = parseInt(corpo.parcela_id, 10);
  const valorRecebido = Math.trunc(Number(corpo.valor_recebido));
  const data = String(corpo.data || '');
  const forma = String(corpo.forma || '');
  const observacao = corpo.observacao != null ? String(corpo.observacao).trim().slice(0, 2000) || null : null;
  const chave = String(corpo.chave_idempotencia || '').trim();

  const erros = [];
  if (!Number.isInteger(parcelaId) || parcelaId <= 0) erros.push('Parcela inválida.');
  if (!Number.isFinite(valorRecebido) || valorRecebido <= 0) erros.push('Valor recebido deve ser maior que zero.');
  if (!dataValida(data)) erros.push('Data inválida.');
  if (!FORMAS.includes(forma)) erros.push('Forma de pagamento inválida.');
  if (!chave || chave.length < 8 || chave.length > 200) erros.push('Chave de idempotência ausente ou inválida.');
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const rParcela = await c.query(
        `SELECT p.id, p.numero, p.status AS parcela_status, p.valor_centavos, p.valor_pago_centavos,
                e.id AS emprestimo_id, e.qtd_parcelas, e.status AS emprestimo_status, e.cliente_id
         FROM parcelas p JOIN emprestimos e ON e.id = p.emprestimo_id
         WHERE p.id = $1 FOR UPDATE OF p`, [parcelaId]);
      if (!rParcela.rows.length) return { erro: 404, mensagem: 'Parcela não encontrada.' };
      const parcela = rParcela.rows[0];

      const rRepetido = await c.query(
        `SELECT * FROM pagamentos WHERE usuario_id = $1 AND chave_idempotencia = $2`, [usuarioId, chave]);
      if (rRepetido.rows.length) throw new PagamentoJaProcessado(chave);

      if (parcela.parcela_status === 'cancelado') return { erro: 400, mensagem: 'Não é possível registrar pagamento em uma parcela cancelada.' };
      if (parcela.emprestimo_status === 'cancelado') return { erro: 400, mensagem: 'Não é possível registrar pagamento em um empréstimo cancelado.' };

      const valorParcela = Number(parcela.valor_centavos);
      const jaPago = Number(parcela.valor_pago_centavos);
      const saldoAtual = valorParcela - jaPago;

      if (saldoAtual <= 0) return { erro: 400, mensagem: 'Esta parcela já está totalmente paga.' };
      if (valorRecebido > saldoAtual) {
        return { erro: 400, mensagem: `O valor informado (${(valorRecebido / 100).toFixed(2)}) excede o saldo restante da parcela (${(saldoAtual / 100).toFixed(2)}).` };
      }

      await c.query(`UPDATE parcelas SET valor_pago_centavos = $2, atualizado_em = now() WHERE id = $1`, [parcelaId, jaPago + valorRecebido]);

      let rPag;
      try {
        rPag = await c.query(
          `INSERT INTO pagamentos (usuario_id, parcela_id, emprestimo_id, cliente_id, valor_esperado_centavos, valor_recebido_centavos, data, forma, observacao, chave_idempotencia)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [usuarioId, parcelaId, parcela.emprestimo_id, parcela.cliente_id, valorParcela, valorRecebido, data, forma, observacao, chave]);
      } catch (errIns) {
        if (errIns.code === '23505') throw new PagamentoJaProcessado(chave);
        throw errIns;
      }
      const pagamento = rPag.rows[0];

      await c.query(
        `INSERT INTO movimentacoes_financeiras (usuario_id, tipo, origem, valor_centavos, descricao, categoria, data, cliente_id, emprestimo_id, pagamento_id)
         VALUES ($1,'entrada','pagamento',$2,$3,'Recebimento de parcela',$4,$5,$6,$7)`,
        [usuarioId, valorRecebido, `Pagamento da parcela ${parcela.numero}/${parcela.qtd_parcelas}`, data, parcela.cliente_id, parcela.emprestimo_id, pagamento.id]);

      return { pagamento };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarPagamentoResposta(resultado.pagamento), 201);
  } catch (e) {
    if (e instanceof PagamentoJaProcessado) {
      try {
        const rExistente = await db.withUser(usuarioId, (c) =>
          c.query(`SELECT * FROM pagamentos WHERE usuario_id = $1 AND chave_idempotencia = $2`, [usuarioId, e.chave]));
        if (rExistente.rows.length) return ok(res, montarPagamentoResposta(rExistente.rows[0]));
      } catch {}
    }
    return falhar(res, 500, 'Falha ao registrar pagamento.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (method === 'GET' && seg.length === 0) return listar(ctx);
  if (method === 'POST' && seg.length === 0) return registrar(ctx);
  return null;
}

module.exports = { tratar };
