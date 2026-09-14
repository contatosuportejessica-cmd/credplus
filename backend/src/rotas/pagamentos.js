// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Pagamentos (Etapa 3 do produto real)
//
// Contrato definido pelo FRONTEND JÁ EXISTENTE (assets/js/app.js):
//   POST /pagamentos { cliente_id, emprestimo_id, parcela_id,
//                       valor_recebido, data, forma, observacao }
//     -> corpo em snake_case (diferente de /emprestimos, que é camelCase;
//        contrato verificado, não inventado).
//   GET  /pagamentos?cliente_id=&emprestimo_id=
//     -> resposta em camelCase (usada em app.js na aba "Pagamentos" do
//        cliente: p.data, p.forma, p.valorEsperado, p.valorRecebido).
//
// cliente_id e emprestimo_id do corpo NUNCA são usados como fonte de
// verdade — são sempre derivados aqui a partir da parcela (via JOIN,
// dentro da mesma transação com RLS ativo), a mesma regra de "nunca confie
// em id vindo do frontend" já aplicada em usuario_id.
//
// Histórico imutável: esta rota só faz INSERT (a tabela nem tem GRANT
// UPDATE/DELETE para a role da aplicação — ver migration 005). Não existe
// PUT/DELETE /pagamentos/:id.
//
// Concorrência: a parcela é bloqueada com SELECT ... FOR UPDATE dentro da
// transação antes de calcular o saldo e decidir se o pagamento cabe —
// duas requisições simultâneas na mesma parcela são serializadas pelo
// Postgres, então nenhuma pode fazer o total pago ultrapassar o valor da
// parcela mesmo chegando ao mesmo tempo.
//
// Idempotência (migration 006): o frontend gera uma chave única por
// clique em "Registrar pagamento" (chave_idempotencia). A checagem dessa
// chave acontece DEPOIS de já segurar o lock da parcela (FOR UPDATE) — ou
// seja, se duas requisições com a mesma chave mirarem a mesma parcela (o
// caso real de duplo clique/retry), a segunda só executa sua própria
// checagem depois que a primeira já commitou, e portanto sempre a
// encontra. O índice UNICO no banco (usuario_id, chave_idempotencia) é o
// backstop final contra qualquer corrida residual: se o INSERT ainda
// assim colidir, a transação é revertida por inteiro (nenhum saldo fica
// alterado) e o pagamento já existente é devolvido como resultado.
//
// Financeiro (migration 007): todo pagamento confirmado gera EXATAMENTE
// UMA movimentação financeira de entrada, na MESMA transação do pagamento
// e do ajuste de saldo da parcela — se a movimentação falhar por qualquer
// motivo, a transação inteira é revertida (o pagamento não fica "pela
// metade": ou os três efeitos acontecem juntos, ou nenhum acontece). Um
// reenvio idempotente (mesma chave) nunca chega a executar este trecho,
// então também nunca gera uma segunda movimentação — e o índice único em
// movimentacoes_financeiras.pagamento_id é o backstop final contra isso.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

const FORMAS = ['pix', 'dinheiro', 'transferencia', 'outro'];

class PagamentoJaProcessado extends Error {
  constructor(chave) { super('pagamento já processado para esta chave de idempotência'); this.chave = chave; }
}

function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function formatarData(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

function montarPagamentoResposta(p) {
  return {
    id: p.id, clienteId: p.cliente_id, emprestimoId: p.emprestimo_id, parcelaId: p.parcela_id,
    valorEsperado: Number(p.valor_esperado_centavos), valorRecebido: Number(p.valor_recebido_centavos),
    data: formatarData(p.data), forma: p.forma, observacao: p.observacao,
    criadoEm: p.criado_em,
  };
}

// GET /api/pagamentos?cliente_id=&emprestimo_id=
router.get('/', async (req, res) => {
  const clienteIdRaw = req.query.cliente_id;
  const emprestimoIdRaw = req.query.emprestimo_id;
  const clienteId = clienteIdRaw !== undefined ? parseInt(clienteIdRaw, 10) : null;
  const emprestimoId = emprestimoIdRaw !== undefined ? parseInt(emprestimoIdRaw, 10) : null;
  if (clienteIdRaw !== undefined && !Number.isInteger(clienteId)) return res.status(400).json({ mensagem: 'cliente_id inválido.' });
  if (emprestimoIdRaw !== undefined && !Number.isInteger(emprestimoId)) return res.status(400).json({ mensagem: 'emprestimo_id inválido.' });

  try {
    const params = [];
    const condicoes = [];
    if (clienteId !== null) { params.push(clienteId); condicoes.push(`cliente_id = $${params.length}`); }
    if (emprestimoId !== null) { params.push(emprestimoId); condicoes.push(`emprestimo_id = $${params.length}`); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query(`SELECT * FROM pagamentos ${where} ORDER BY criado_em DESC`, params));
    res.json(r.rows.map(montarPagamentoResposta));
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar pagamentos.' });
    console.error('[pagamentos] erro ao listar:', err.message);
  }
});

// POST /api/pagamentos
router.post('/', async (req, res) => {
  const corpo = req.body || {};
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
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      // Lock da parcela dentro da transação: serializa pagamentos
      // concorrentes na mesma parcela (protege contra ultrapassar saldo E
      // é o que também serializa duas tentativas com a MESMA chave).
      const rParcela = await c.query(
        `SELECT p.id, p.numero, p.status AS parcela_status, p.valor_centavos, p.valor_pago_centavos,
                e.id AS emprestimo_id, e.qtd_parcelas, e.status AS emprestimo_status, e.cliente_id
         FROM parcelas p
         JOIN emprestimos e ON e.id = p.emprestimo_id
         WHERE p.id = $1
         FOR UPDATE OF p`,
        [parcelaId]
      );
      if (!rParcela.rows.length) return { erro: 404, mensagem: 'Parcela não encontrada.' };
      const parcela = rParcela.rows[0];

      // Se esta chave já gerou um pagamento (para este usuário), é a MESMA
      // tentativa sendo reenviada — não cria outro, devolve o já existente.
      const rRepetido = await c.query(
        `SELECT * FROM pagamentos WHERE usuario_id = $1 AND chave_idempotencia = $2`,
        [req.usuarioId, chave]
      );
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

      const novoValorPago = jaPago + valorRecebido;
      await c.query(`UPDATE parcelas SET valor_pago_centavos = $2, atualizado_em = now() WHERE id = $1`, [parcelaId, novoValorPago]);

      let rPag;
      try {
        rPag = await c.query(
          `INSERT INTO pagamentos (usuario_id, parcela_id, emprestimo_id, cliente_id, valor_esperado_centavos, valor_recebido_centavos, data, forma, observacao, chave_idempotencia)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [req.usuarioId, parcelaId, parcela.emprestimo_id, parcela.cliente_id, valorParcela, valorRecebido, data, forma, observacao, chave]
        );
      } catch (errIns) {
        // Backstop: corrida residual (ex.: mesma chave usada em parcelas
        // diferentes por algum bug de cliente) pegou o índice único no
        // INSERT em vez da checagem acima. Força ROLLBACK completo desta
        // transação (inclusive o UPDATE de saldo que acabamos de fazer) e
        // sinaliza para o handler externo devolver o pagamento já existente.
        if (errIns.code === '23505') throw new PagamentoJaProcessado(chave);
        throw errIns;
      }
      const pagamento = rPag.rows[0];

      // Entrada financeira automática — mesma transação: se isto falhar,
      // TUDO acima (pagamento + saldo da parcela) é revertido junto.
      await c.query(
        `INSERT INTO movimentacoes_financeiras (usuario_id, tipo, origem, valor_centavos, descricao, categoria, data, cliente_id, emprestimo_id, pagamento_id)
         VALUES ($1,'entrada','pagamento',$2,$3,'Recebimento de parcela',$4,$5,$6,$7)`,
        [req.usuarioId, valorRecebido, `Pagamento da parcela ${parcela.numero}/${parcela.qtd_parcelas}`, data, parcela.cliente_id, parcela.emprestimo_id, pagamento.id]
      );

      return { pagamento };
    });

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    res.status(201).json(montarPagamentoResposta(resultado.pagamento));
  } catch (err) {
    if (err instanceof PagamentoJaProcessado) {
      try {
        const rExistente = await db.comUsuario(req.usuarioId, (c) =>
          c.query(`SELECT * FROM pagamentos WHERE usuario_id = $1 AND chave_idempotencia = $2`, [req.usuarioId, err.chave]));
        if (rExistente.rows.length) return res.status(200).json(montarPagamentoResposta(rExistente.rows[0]));
      } catch (err2) {
        console.error('[pagamentos] erro ao recuperar pagamento idempotente:', err2.message);
      }
    }
    res.status(500).json({ mensagem: 'Falha ao registrar pagamento.' });
    console.error('[pagamentos] erro ao registrar:', err.message);
  }
});

module.exports = router;
