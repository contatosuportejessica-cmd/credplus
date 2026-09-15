// CredPlus serverless — Busca global.
// Pesquisa somente clientes (por nome), com agregados calculados ao vivo.
// Termo com coringas do LIKE escapado + parâmetro ligado (sem injection).
const db = require('../db');
const { ok, falhar, paraDataISO } = require('../http');

const LIMITE_RESULTADOS = 20;

function escaparCoringasLike(s) {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

async function tratar({ method, seg, query, usuarioId, res }) {
  if (!(method === 'GET' && seg.length === 0)) return null;
  const termo = String(query.q || '').trim();
  if (!termo) return ok(res, []);
  if (termo.length > 200) return falhar(res, 400, 'Termo de busca muito longo.');

  const padrao = `%${escaparCoringasLike(termo)}%`;

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const rClientes = await c.query(
        `SELECT id, nome FROM clientes
         WHERE usuario_id = $1 AND status <> 'arquivado' AND nome ILIKE $2 ESCAPE '\\'
         ORDER BY nome ASC LIMIT $3`, [usuarioId, padrao, LIMITE_RESULTADOS]);
      if (!rClientes.rows.length) return [];

      const idsClientes = rClientes.rows.map((x) => x.id);
      const rEmp = await c.query(
        `SELECT id, cliente_id, status FROM emprestimos WHERE usuario_id = $1 AND cliente_id = ANY($2::int[])`,
        [usuarioId, idsClientes]);
      const empIds = rEmp.rows.map((e) => e.id);
      const rPar = empIds.length
        ? await c.query(
            `SELECT emprestimo_id, valor_centavos, valor_pago_centavos, vencimento FROM parcelas WHERE usuario_id = $1 AND emprestimo_id = ANY($2::int[])`,
            [usuarioId, empIds])
        : { rows: [] };
      const parcelasPorEmp = new Map();
      for (const p of rPar.rows) {
        if (!parcelasPorEmp.has(p.emprestimo_id)) parcelasPorEmp.set(p.emprestimo_id, []);
        parcelasPorEmp.get(p.emprestimo_id).push(p);
      }

      const resumoPorCliente = new Map();
      for (const e of rEmp.rows) {
        if (e.status === 'cancelado') continue;
        const parcelas = parcelasPorEmp.get(e.id) || [];
        const saldo = parcelas.reduce((a, p) => a + (Number(p.valor_centavos) - Number(p.valor_pago_centavos)), 0);
        const proxima = parcelas
          .filter((p) => Number(p.valor_centavos) - Number(p.valor_pago_centavos) > 0)
          .map((p) => paraDataISO(p.vencimento))
          .sort()[0] || null;

        if (!resumoPorCliente.has(e.cliente_id)) {
          resumoPorCliente.set(e.cliente_id, { operacoes: 0, saldoPendente: 0, proximaCobranca: null });
        }
        const r2 = resumoPorCliente.get(e.cliente_id);
        r2.operacoes += 1;
        r2.saldoPendente += saldo;
        if (proxima && (!r2.proximaCobranca || proxima < r2.proximaCobranca)) r2.proximaCobranca = proxima;
      }

      return rClientes.rows.map((cl) => {
        const r2 = resumoPorCliente.get(cl.id) || { operacoes: 0, saldoPendente: 0, proximaCobranca: null };
        return { id: cl.id, nome: cl.nome, operacoes: r2.operacoes, saldoPendente: r2.saldoPendente, proximaCobranca: r2.proximaCobranca };
      });
    });

    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao buscar.');
  }
}

module.exports = { tratar };
