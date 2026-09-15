// CredPlus serverless — Parcelas (reagendar vencimento).
// Regra do backend antigo: só o vencimento pode mudar por aqui — nunca
// valor/status sem um pagamento real.
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO, idRota } = require('../http');

async function tratar({ method, seg, body, usuarioId, res }) {
  if (!(method === 'PUT' && seg.length === 1)) return null;
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Parcela não encontrada.');
  const vencimento = String((body || {}).vencimento || '');
  if (!dataValida(vencimento)) return falhar(res, 400, 'Vencimento inválido.');

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const rParcela = await c.query(
        `SELECT p.id, e.status AS emprestimo_status
         FROM parcelas p JOIN emprestimos e ON e.id = p.emprestimo_id
         WHERE p.id = $1`, [id]);
      if (!rParcela.rows.length) return { erro: 404, mensagem: 'Parcela não encontrada.' };
      if (rParcela.rows[0].emprestimo_status === 'cancelado') {
        return { erro: 400, mensagem: 'Não é possível alterar parcela de um empréstimo cancelado.' };
      }
      const r = await c.query(
        `UPDATE parcelas SET vencimento = $2, atualizado_em = now() WHERE id = $1 RETURNING *`, [id, vencimento]);
      return { parcela: r.rows[0] };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    const p = resultado.parcela;
    return ok(res, {
      id: p.id, numero: p.numero, valor: Number(p.valor_centavos), valorPago: Number(p.valor_pago_centavos),
      vencimento: paraDataISO(p.vencimento), status: p.status,
    });
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar parcela.');
  }
}

module.exports = { tratar };
