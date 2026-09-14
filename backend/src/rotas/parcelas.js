// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Parcelas (ação isolada: reagendar vencimento)
//
// Único uso real hoje no frontend (loja.ajustarParcela): PUT /parcelas/:id
// com { vencimento }. Pagamentos (valorPago) ainda não existe nesta etapa
// — não aceitamos alterar valor/status por aqui de propósito (evita
// "quitar" parcela sem um pagamento real, violando a regra da Etapa 2).
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

// PUT /api/parcelas/:id  { vencimento }
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Parcela não encontrada.' });
  const vencimento = String((req.body || {}).vencimento || '');
  if (!dataValida(vencimento)) return res.status(400).json({ mensagem: 'Vencimento inválido.' });

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      const rParcela = await c.query(
        `SELECT p.id, p.status AS parcela_status, e.status AS emprestimo_status
         FROM parcelas p JOIN emprestimos e ON e.id = p.emprestimo_id
         WHERE p.id = $1`,
        [id]
      );
      if (!rParcela.rows.length) return { erro: 404, mensagem: 'Parcela não encontrada.' };
      const { emprestimo_status } = rParcela.rows[0];
      if (emprestimo_status === 'cancelado') return { erro: 400, mensagem: 'Não é possível alterar parcela de um empréstimo cancelado.' };

      const r = await c.query(
        `UPDATE parcelas SET vencimento = $2, atualizado_em = now() WHERE id = $1 RETURNING *`,
        [id, vencimento]
      );
      return { parcela: r.rows[0] };
    });

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });
    const p = resultado.parcela;
    res.json({
      id: p.id, numero: p.numero, valor: Number(p.valor_centavos), valorPago: Number(p.valor_pago_centavos),
      vencimento: p.vencimento instanceof Date ? p.vencimento.toISOString().slice(0, 10) : p.vencimento,
      status: p.status,
    });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao atualizar parcela.' });
    console.error('[parcelas] erro ao atualizar:', err.message);
  }
});

module.exports = router;
