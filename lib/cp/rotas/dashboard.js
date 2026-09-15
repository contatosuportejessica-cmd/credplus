// CredPlus serverless — Dashboard.
// Visão 100% derivada (sem tabela própria): capital disponível = saldo
// all-time do Financeiro; recebido/ganho do período vêm de pagamentos;
// atraso/próximas coberturas vêm de parcelas; carteira fecha com o total
// contratado (recebido + aReceberEmDia + emAtraso).
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO, hojeSP, diasEntreDatas } = require('../http');

async function tratar({ method, seg, query, usuarioId, res }) {
  if (!(method === 'GET' && seg.length === 0)) return null;
  const inicio = String(query.inicio || '');
  const fim = String(query.fim || '');
  if (!dataValida(inicio) || !dataValida(fim)) return falhar(res, 400, 'Período inválido.');

  try {
    const hoje = hojeSP();

    const resultado = await db.withUser(usuarioId, async (c) => {
      const rEmp = await c.query(
        `SELECT e.*, cl.nome AS cliente_nome FROM emprestimos e
         LEFT JOIN clientes cl ON cl.id = e.cliente_id
         WHERE e.usuario_id = $1 AND (cl.id IS NULL OR cl.usuario_id = $1)
         ORDER BY e.criado_em DESC`, [usuarioId]);
      const empIds = rEmp.rows.map((e) => e.id);
      const rPar = empIds.length
        ? await c.query(`SELECT * FROM parcelas WHERE emprestimo_id = ANY($1::int[]) AND usuario_id = $2`, [empIds, usuarioId])
        : { rows: [] };

      const parcelasPorEmp = new Map();
      for (const p of rPar.rows) {
        if (!parcelasPorEmp.has(p.emprestimo_id)) parcelasPorEmp.set(p.emprestimo_id, []);
        parcelasPorEmp.get(p.emprestimo_id).push(p);
      }

      const emprestimos = rEmp.rows.map((e) => {
        const parcelas = (parcelasPorEmp.get(e.id) || []).map((p) => ({
          id: p.id, valor: Number(p.valor_centavos), valorPago: Number(p.valor_pago_centavos),
          vencimento: paraDataISO(p.vencimento), statusBruto: p.status,
        }));
        const saldoRestante = parcelas.reduce((acc, p) => acc + (p.valor - p.valorPago), 0);
        const temAtraso = parcelas.some((p) => {
          const restante = p.valor - p.valorPago;
          if (restante <= 0 || p.statusBruto === 'cancelado') return false;
          return diasEntreDatas(hoje, p.vencimento) < 0;
        });
        let statusCalculado = e.status;
        if (e.status !== 'cancelado') statusCalculado = saldoRestante <= 0 ? 'quitado' : (temAtraso ? 'atraso' : 'andamento');
        const proxima = parcelas
          .filter((p) => p.valor - p.valorPago > 0)
          .sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
        const capital = Number(e.capital_centavos);
        const total = Number(e.total_centavos);
        return {
          id: e.id, clienteId: e.cliente_id, clienteNome: e.cliente_nome,
          capital, total, ganhoPrevisto: total - capital,
          status: e.status, statusCalculado, saldoRestante,
          proximaCobranca: proxima ? proxima.vencimento : null, parcelas,
        };
      });

      const naoCancelados = emprestimos.filter((e) => e.status !== 'cancelado');
      const totalEmprestado = naoCancelados.filter((e) => e.saldoRestante > 0).reduce((a, e) => a + e.capital, 0);
      const totalAReceber = naoCancelados.reduce((a, e) => a + e.saldoRestante, 0);
      const ganhoPrevisto = naoCancelados.reduce((a, e) => a + e.ganhoPrevisto, 0);
      const recebidoCarteira = naoCancelados.reduce(
        (a, e) => a + e.parcelas.reduce((acc, p) => acc + p.valorPago, 0), 0);

      let emAtraso = 0;
      const proximasCobrancas = [];
      for (const e of naoCancelados) {
        for (const p of e.parcelas) {
          const restante = p.valor - p.valorPago;
          if (restante <= 0 || p.statusBruto === 'cancelado') continue;
          const delta = diasEntreDatas(hoje, p.vencimento);
          if (delta < 0) emAtraso += restante;
          if (delta >= 0 && delta <= 7) {
            proximasCobrancas.push({
              id: p.id, valor: p.valor, valorPago: p.valorPago, vencimento: p.vencimento,
              cliente: e.clienteNome != null ? { id: e.clienteId, nome: e.clienteNome } : null,
            });
          }
        }
      }
      proximasCobrancas.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

      const emprestimosAndamento = naoCancelados
        .filter((e) => e.statusCalculado !== 'quitado')
        .slice(0, 5)
        .map((e) => ({
          id: e.id, clienteId: e.clienteId, cliente: e.clienteNome != null ? { nome: e.clienteNome } : null,
          statusCalculado: e.statusCalculado, saldoRestante: e.saldoRestante, proximaCobranca: e.proximaCobranca,
        }));

      const rPag = await c.query(
        `SELECT p.valor_recebido_centavos, e.capital_centavos, e.total_centavos
         FROM pagamentos p JOIN emprestimos e ON e.id = p.emprestimo_id
         WHERE p.data BETWEEN $1 AND $2 AND p.usuario_id = $3 AND e.usuario_id = $3`, [inicio, fim, usuarioId]);
      let jaRecebido = 0, ganhoRealizado = 0;
      for (const row of rPag.rows) {
        const vr = Number(row.valor_recebido_centavos);
        const cap = Number(row.capital_centavos);
        const tot = Number(row.total_centavos);
        jaRecebido += vr;
        ganhoRealizado += Math.round(vr * ((tot - cap) / tot));
      }

      const rMovPeriodo = await c.query(
        `SELECT tipo, data, valor_centavos FROM movimentacoes_financeiras WHERE usuario_id = $1 AND data BETWEEN $2 AND $3`, [usuarioId, inicio, fim]);
      let entradas = 0, saidas = 0;
      const porDia = new Map();
      for (const r of rMovPeriodo.rows) {
        const valor = Number(r.valor_centavos);
        const dataMov = paraDataISO(r.data);
        if (r.tipo === 'entrada') entradas += valor; else saidas += valor;
        if (!porDia.has(dataMov)) porDia.set(dataMov, { entradas: 0, saidas: 0 });
        const bucket = porDia.get(dataMov);
        if (r.tipo === 'entrada') bucket.entradas += valor; else bucket.saidas += valor;
      }

      const larguraDias = diasEntreDatas(inicio, fim) + 1;
      const fluxoSerie = [];
      if (larguraDias <= 31) {
        const [iy, im, idd] = inicio.split('-').map(Number);
        const [fy, fm, fd] = fim.split('-').map(Number);
        let atual = Date.UTC(iy, im - 1, idd);
        const fimMs = Date.UTC(fy, fm - 1, fd);
        while (atual <= fimMs) {
          const iso = new Date(atual).toISOString().slice(0, 10);
          const b = porDia.get(iso) || { entradas: 0, saidas: 0 };
          fluxoSerie.push({ data: iso, entradas: b.entradas, saidas: b.saidas });
          atual += 86400000;
        }
      } else {
        const porMes = new Map();
        for (const [dataMov, b] of porDia.entries()) {
          const chaveMes = dataMov.slice(0, 7) + '-01';
          if (!porMes.has(chaveMes)) porMes.set(chaveMes, { entradas: 0, saidas: 0 });
          const acc = porMes.get(chaveMes);
          acc.entradas += b.entradas;
          acc.saidas += b.saidas;
        }
        let [ay, am] = inicio.split('-').map(Number);
        const [fy, fm] = fim.split('-').map(Number);
        while (ay < fy || (ay === fy && am <= fm)) {
          const chave = `${ay}-${String(am).padStart(2, '0')}-01`;
          const b = porMes.get(chave) || { entradas: 0, saidas: 0 };
          fluxoSerie.push({ data: chave, entradas: b.entradas, saidas: b.saidas });
          am += 1;
          if (am > 12) { am = 1; ay += 1; }
        }
      }

      const rMovTotal = await c.query(
        `SELECT tipo, COALESCE(SUM(valor_centavos), 0) AS total FROM movimentacoes_financeiras WHERE usuario_id = $1 GROUP BY tipo`, [usuarioId]);
      let entradasTotais = 0, saidasTotais = 0;
      for (const r of rMovTotal.rows) {
        if (r.tipo === 'entrada') entradasTotais = Number(r.total); else saidasTotais = Number(r.total);
      }

      const totalContratado = naoCancelados.reduce((a, e) => a + e.total, 0);
      const carteira = {
        recebido: recebidoCarteira,
        aReceberEmDia: totalAReceber - emAtraso,
        emAtraso, total: totalContratado,
      };

      return {
        capitalDisponivel: entradasTotais - saidasTotais,
        totalEmprestado, totalAReceber, jaRecebido, ganhoPrevisto, ganhoRealizado,
        emAtraso, qtdProximas: proximasCobrancas.length, entradas, saidas,
        proximasCobrancas: proximasCobrancas.slice(0, 5),
        emprestimosAndamento, fluxoSerie, carteira,
      };
    });

    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao calcular dashboard.');
  }
}

module.exports = { tratar };
