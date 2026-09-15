// CredPlus serverless — Pagamentos (multi-parcelas).
//
// Um recebimento pode quitar UMA parcela (contrato legado), VÁRIAS de uma
// vez, ser parcial ou antecipado — sempre UM registro em pagamentos +
// N linhas em pagamento_itens (migration 017), nunca registros duplicados.
// cliente_id/emprestimo_id continuam derivados das parcelas (nunca do
// corpo). Lock FOR UPDATE em todas as parcelas (ordem de id, anti-deadlock),
// idempotência por chave e entrada financeira única na mesma transação.
// Histórico imutável: só INSERT (sem UPDATE/DELETE em nenhuma das tabelas).
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO } = require('../http');

const FORMAS = ['pix', 'dinheiro', 'transferencia', 'cartao', 'outro'];

class PagamentoJaProcessado extends Error {
  constructor(chave) { super('pagamento já processado para esta chave de idempotência'); this.chave = chave; }
}

function montarPagamentoResposta(p, itens) {
  const lista = (itens || []).map((i) => ({
    parcelaId: i.parcela_id, numero: i.numero != null ? Number(i.numero) : null,
    valor: Number(i.valor_centavos),
  }));
  return {
    id: p.id, clienteId: p.cliente_id, emprestimoId: p.emprestimo_id, parcelaId: p.parcela_id,
    parcelaIds: lista.map((i) => i.parcelaId),
    itens: lista,
    valorEsperado: Number(p.valor_esperado_centavos), valorRecebido: Number(p.valor_recebido_centavos),
    data: paraDataISO(p.data), forma: p.forma, observacao: p.observacao,
    criadoEm: p.criado_em,
  };
}

async function anexarItens(c, pagamentos) {
  if (!pagamentos.length) return new Map();
  const ids = pagamentos.map((p) => p.id);
  const r = await c.query(
    `SELECT i.pagamento_id, i.parcela_id, i.valor_centavos, p.numero
     FROM pagamento_itens i LEFT JOIN parcelas p ON p.id = i.parcela_id
     WHERE i.pagamento_id = ANY($1::int[]) ORDER BY p.numero ASC`, [ids]);
  const mapa = new Map();
  for (const row of r.rows) {
    if (!mapa.has(row.pagamento_id)) mapa.set(row.pagamento_id, []);
    mapa.get(row.pagamento_id).push(row);
  }
  return mapa;
}

// GET /api/pagamentos?cliente_id=&emprestimo_id=
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
    const resultado = await db.withUser(usuarioId, async (c) => {
      const r = await c.query(`SELECT * FROM pagamentos ${where} ORDER BY criado_em DESC`, params);
      const mapa = await anexarItens(c, r.rows);
      return r.rows.map((p) => montarPagamentoResposta(p, mapa.get(p.id) || []));
    });
    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar pagamentos.');
  }
}

// POST /api/pagamentos — corpo legado (parcela_id único) OU multi:
//   { itens: [{ parcela_id, valor }], valor_recebido, data, forma, ... }
// A soma dos itens deve fechar exatamente com valor_recebido.
async function registrar({ body, usuarioId, res }) {
  const corpo = body || {};
  const data = String(corpo.data || '');
  const forma = String(corpo.forma || '');
  const observacao = corpo.observacao != null ? String(corpo.observacao).trim().slice(0, 2000) || null : null;
  const chave = String(corpo.chave_idempotencia || '').trim();
  const valorRecebido = Math.trunc(Number(corpo.valor_recebido));

  let itensEntrada;
  if (Array.isArray(corpo.itens) && corpo.itens.length) {
    itensEntrada = corpo.itens.map((i) => ({
      parcelaId: parseInt(i && i.parcela_id, 10),
      valor: Math.trunc(Number(i && i.valor)),
    }));
  } else {
    itensEntrada = [{
      parcelaId: parseInt(corpo.parcela_id, 10),
      valor: valorRecebido,
    }];
  }

  const erros = [];
  if (!Number.isFinite(valorRecebido) || valorRecebido <= 0) erros.push('Valor recebido deve ser maior que zero.');
  if (!dataValida(data)) erros.push('Data inválida.');
  if (!FORMAS.includes(forma)) erros.push('Forma de pagamento inválida.');
  if (!chave || chave.length < 8 || chave.length > 200) erros.push('Chave de idempotência ausente ou inválida.');
  if (!itensEntrada.length) erros.push('Informe ao menos uma parcela.');
  const vistos = new Set();
  let somaItens = 0;
  for (const [i, it] of itensEntrada.entries()) {
    if (!Number.isInteger(it.parcelaId) || it.parcelaId <= 0) { erros.push(`Item ${i + 1}: parcela inválida.`); continue; }
    if (!Number.isFinite(it.valor) || it.valor <= 0) { erros.push(`Item ${i + 1}: valor inválido.`); continue; }
    if (vistos.has(it.parcelaId)) { erros.push(`Item ${i + 1}: parcela repetida.`); continue; }
    vistos.add(it.parcelaId);
    somaItens += it.valor;
  }
  if (!erros.length && somaItens !== valorRecebido) {
    erros.push(`A soma dos valores por parcela (${(somaItens / 100).toFixed(2)}) não é igual ao valor recebido (${(valorRecebido / 100).toFixed(2)}).`);
  }
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const ids = [...vistos].sort((a, b) => a - b);
      const rPar = await c.query(
        `SELECT p.id, p.numero, p.status AS parcela_status, p.valor_centavos, p.valor_pago_centavos,
                e.id AS emprestimo_id, e.qtd_parcelas, e.status AS emprestimo_status, e.cliente_id
         FROM parcelas p JOIN emprestimos e ON e.id = p.emprestimo_id
         WHERE p.id = ANY($1::int[]) FOR UPDATE OF p`, [ids]);
      if (rPar.rows.length !== ids.length) return { erro: 404, mensagem: 'Uma ou mais parcelas não foram encontradas.' };
      const porId = new Map(rPar.rows.map((p) => [p.id, p]));
      const primeira = porId.get(ids[0]);
      for (const p of rPar.rows) {
        if (p.emprestimo_id !== primeira.emprestimo_id) {
          return { erro: 400, mensagem: 'Todas as parcelas devem pertencer ao mesmo empréstimo.' };
        }
      }

      const rRepetido = await c.query(
        `SELECT * FROM pagamentos WHERE usuario_id = $1 AND chave_idempotencia = $2`, [usuarioId, chave]);
      if (rRepetido.rows.length) throw new PagamentoJaProcessado(chave);

      let valorEsperado = 0;
      for (const it of itensEntrada) {
        const parc = porId.get(it.parcelaId);
        if (parc.parcela_status === 'cancelado') return { erro: 400, mensagem: `Não é possível registrar pagamento na parcela ${parc.numero} (cancelada).` };
        if (parc.emprestimo_status === 'cancelado') return { erro: 400, mensagem: 'Não é possível registrar pagamento em um empréstimo cancelado.' };
        const saldo = Number(parc.valor_centavos) - Number(parc.valor_pago_centavos);
        if (saldo <= 0) return { erro: 400, mensagem: `A parcela ${parc.numero} já está totalmente paga.` };
        if (it.valor > saldo) {
          return { erro: 400, mensagem: `O valor da parcela ${parc.numero} (${(it.valor / 100).toFixed(2)}) excede seu saldo restante (${(saldo / 100).toFixed(2)}).` };
        }
        valorEsperado += saldo;
      }

      for (const it of itensEntrada) {
        const parc = porId.get(it.parcelaId);
        const novo = Number(parc.valor_pago_centavos) + it.valor;
        await c.query(`UPDATE parcelas SET valor_pago_centavos = $2, atualizado_em = now() WHERE id = $1`, [it.parcelaId, novo]);
      }

      const unico = itensEntrada.length === 1;
      let rPag;
      try {
        rPag = await c.query(
          `INSERT INTO pagamentos (usuario_id, parcela_id, emprestimo_id, cliente_id, valor_esperado_centavos, valor_recebido_centavos, data, forma, observacao, chave_idempotencia)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [usuarioId, unico ? itensEntrada[0].parcelaId : null, primeira.emprestimo_id, primeira.cliente_id,
           valorEsperado, valorRecebido, data, forma, observacao, chave]);
      } catch (errIns) {
        if (errIns.code === '23505') throw new PagamentoJaProcessado(chave);
        throw errIns;
      }
      const pagamento = rPag.rows[0];

      for (const it of itensEntrada) {
        await c.query(
          `INSERT INTO pagamento_itens (usuario_id, pagamento_id, parcela_id, valor_centavos) VALUES ($1,$2,$3,$4)`,
          [usuarioId, pagamento.id, it.parcelaId, it.valor]);
      }

      const numeros = itensEntrada
        .map((it) => porId.get(it.parcelaId).numero)
        .sort((a, b) => a - b)
        .join(',');
      await c.query(
        `INSERT INTO movimentacoes_financeiras (usuario_id, tipo, origem, valor_centavos, descricao, categoria, data, cliente_id, emprestimo_id, pagamento_id)
         VALUES ($1,'entrada','pagamento',$2,$3,'Recebimento de parcela',$4,$5,$6,$7)`,
        [usuarioId, valorRecebido, `Pagamento da${unico ? '' : 's'} parcela${unico ? '' : 's'} ${numeros}/${primeira.qtd_parcelas}`,
         data, primeira.cliente_id, primeira.emprestimo_id, pagamento.id]);

      return { pagamento };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    const mapa = await db.withUser(usuarioId, (c) => anexarItens(c, [resultado.pagamento]));
    return ok(res, montarPagamentoResposta(resultado.pagamento, mapa.get(resultado.pagamento.id) || []), 201);
  } catch (e) {
    if (e instanceof PagamentoJaProcessado) {
      try {
        const rExistente = await db.withUser(usuarioId, async (c) => {
          const r = await c.query(`SELECT * FROM pagamentos WHERE usuario_id = $1 AND chave_idempotencia = $2`, [usuarioId, e.chave]);
          if (!r.rows.length) return null;
          const mapa = await anexarItens(c, r.rows);
          return montarPagamentoResposta(r.rows[0], mapa.get(r.rows[0].id) || []);
        });
        if (rExistente) return ok(res, rExistente);
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
