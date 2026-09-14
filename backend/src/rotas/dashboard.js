// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Dashboard (Etapa 9 do produto real)
//
// VISÃO 100% DERIVADA — sem tabela própria, sem coluna de totais
// armazenada. Tudo calculado ao vivo a partir de clientes, emprestimos,
// parcelas, pagamentos e movimentacoes_financeiras (RLS já isola por
// usuario_id em todas elas).
//
// Contrato real (app.js, loja.obterDashboard):
//   GET /dashboard?inicio=&fim=
//   -> { capitalDisponivel, totalEmprestado, totalAReceber, jaRecebido,
//        ganhoPrevisto, ganhoRealizado, emAtraso, qtdProximas,
//        entradas, saidas, proximasCobrancas, emprestimosAndamento,
//        fluxoSerie, carteira }
//   (fluxoSerie e carteira são ADITIVOS — melhoria visual/analítica sobre
//   o Dashboard já aprovado; nenhum campo existente foi removido ou
//   teve sua fórmula alterada.)
//
// fluxoSerie: série temporal de entradas/saídas dentro do período
// selecionado, para o gráfico de Fluxo financeiro. Granularidade decidida
// pela LARGURA REAL do intervalo (não pelo id do período, que o backend
// nem recebe): até 31 dias -> um ponto por dia (preenchendo dias sem
// movimento com zero, para uma curva contínua e honesta); mais que 31
// dias (o período "Este ano") -> um ponto por mês. Mesma fonte
// (movimentacoes_financeiras) e mesmo filtro de data que já alimentam
// `entradas`/`saidas` — a soma de fluxoSerie bate exatamente com esses
// dois campos (verificado nos testes).
//
// carteira: composição do valor TOTAL CONTRATADO (soma de total_centavos
// dos empréstimos não cancelados) em três fatias MUTUAMENTE EXCLUSIVAS
// que fecham exatamente com o total:
//   recebido        = soma de valor_pago_centavos dessas mesmas parcelas
//                      (todo o histórico, não só o período selecionado)
//   aReceberEmDia   = saldo de parcelas com saldo>0 e vencimento >= hoje
//   emAtraso        = saldo de parcelas com saldo>0 e vencimento < hoje
//                      (== exatamente o campo `emAtraso` já aprovado)
// recebido + aReceberEmDia + emAtraso == total (validado nos testes).
// Importante: "recebido" aqui é all-time e só considera empréstimos NÃO
// cancelados — por isso é DIFERENTE do card "JÁ RECEBIDO" (que é do
// período selecionado e inclui pagamentos de empréstimos já cancelados
// depois). Os dois números respondem perguntas diferentes; nenhum dos
// dois foi alterado.
//
// Fórmulas confirmadas (mapeamento linha a linha do modo demo,
// auditado e reportado ao usuário antes desta implementação):
//
//  capitalDisponivel = saldo ALL-TIME do Financeiro (entradas - saídas em
//    movimentacoes_financeiras, sem limite de período) — reaproveitado
//    diretamente, sem recalcular um "saldo paralelo" (mesma fonte que
//    /api/financeiro/movimentacoes). Sem o "+R$20.000" fictício do modo
//    demo (era só uma semente de dados de demonstração, não existe no
//    produto real) e sem Math.max(0,...): um saldo negativo real é um
//    sinal legítimo (capital mais emprestado do que aportado) e não deve
//    ser escondido.
//
//  totalEmprestado = soma do CAPITAL de empréstimos não cancelados que
//    ainda têm saldo restante > 0 ("operações abertas", igual à descrição
//    do próprio card). O código demo tem uma comparação morta
//    (`e.status === 'quitado'`, que nunca é verdadeira porque o status
//    bruto só é 'andamento'/'cancelado') — uma vez descartada essa
//    cláusula sempre-falsa, a fórmula efetiva é exatamente esta.
//
//  totalAReceber = soma do saldo restante (valor - pago) de TODAS as
//    parcelas de empréstimos não cancelados — mesma soma que
//    GET /cobrancas?filtro=todas produziria, garantindo que Dashboard e
//    Cobranças nunca divirjam.
//
//  ganhoPrevisto = soma de (total-capital) de empréstimos não cancelados,
//    SEM filtro de período (o código demo não filtra por data aqui).
//
//  jaRecebido / ganhoRealizado = derivados de TODOS os pagamentos com
//    `data` dentro do período selecionado — inclusive de empréstimos que
//    tenham sido cancelados DEPOIS do pagamento (um pagamento já
//    recebido é fato histórico; cancelar o empréstimo depois não apaga
//    esse recebimento). ganhoRealizado usa a mesma fórmula proporcional
//    já validada em Metas (tipo "ganho"): valorRecebido × (ganhoPrevisto
//    do empréstimo / total do empréstimo).
//
//  entradas / saidas (do período) = somas de movimentacoes_financeiras
//    com `data` no período selecionado.
//
//  emAtraso = soma do saldo de parcelas vencidas (vencimento < hoje) de
//    empréstimos não cancelados — mesma definição de Cobranças
//    ?filtro=atrasadas.
//
//  qtdProximas / proximasCobrancas = parcelas com saldo > 0, vencimento
//    entre hoje e hoje+7 dias, de empréstimos não cancelados — mesma
//    definição de Cobranças ?filtro=7dias. CORRIGIDO em relação à fórmula
//    literal do modo demo (que contava "para trás", contradizendo o
//    próprio rótulo do card "próximos 7 dias") — decisão confirmada com
//    o usuário antes de implementar.
//
//  emprestimosAndamento = empréstimos não cancelados com statusCalculado
//    <> 'quitado' (até 5, mais recentes primeiro). CORRIGIDO em relação
//    à comparação morta do modo demo (`e.status !== 'quitado'`, que nunca
//    filtra nada) — decisão confirmada com o usuário antes de implementar.
//
//  Não incluído: "totalContratado" (soma de e.total) é calculado no modo
//  demo mas nunca é exibido em nenhum card real — omitido por não ser
//  usado pelo contrato real ("implemente somente o necessário").
//
// Nenhum gráfico separado existe no contrato real — a única visualização
// além dos números é a mesma barra de progresso entradas/saídas já
// coberta pelos campos `entradas`/`saidas` (o cálculo de largura da barra
// é feito no próprio frontend).
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function hojeISO() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

// vencimento - hoje, em dias de calendário (positivo = futuro, 0 = hoje, negativo = vencida)
function diasEntreDatas(hojeISO, vencimentoISO) {
  const [ay, am, ad] = hojeISO.split('-').map(Number);
  const [by, bm, bd] = vencimentoISO.split('-').map(Number);
  const A = Date.UTC(ay, am - 1, ad);
  const B = Date.UTC(by, bm - 1, bd);
  return Math.round((B - A) / 86400000);
}

function paraDataISO(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

// GET /api/dashboard?inicio=&fim=
router.get('/', async (req, res) => {
  const inicio = String(req.query.inicio || '');
  const fim = String(req.query.fim || '');
  if (!dataValida(inicio) || !dataValida(fim)) return res.status(400).json({ mensagem: 'Período inválido.' });

  try {
    const hoje = hojeISO();

    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      // 1) todos os empréstimos (qualquer status) + nome do cliente
      const rEmp = await c.query(
        `SELECT e.*, cl.nome AS cliente_nome
         FROM emprestimos e
         LEFT JOIN clientes cl ON cl.id = e.cliente_id
         ORDER BY e.criado_em DESC`
      );
      const empIds = rEmp.rows.map((e) => e.id);
      const rPar = empIds.length
        ? await c.query(`SELECT * FROM parcelas WHERE emprestimo_id = ANY($1::int[])`, [empIds])
        : { rows: [] };

      const parcelasPorEmp = new Map();
      for (const p of rPar.rows) {
        if (!parcelasPorEmp.has(p.emprestimo_id)) parcelasPorEmp.set(p.emprestimo_id, []);
        parcelasPorEmp.get(p.emprestimo_id).push(p);
      }

      const emprestimos = rEmp.rows.map((e) => {
        const parcelas = (parcelasPorEmp.get(e.id) || []).map((p) => ({
          id: p.id,
          valor: Number(p.valor_centavos),
          valorPago: Number(p.valor_pago_centavos),
          vencimento: paraDataISO(p.vencimento),
          statusBruto: p.status,
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
          proximaCobranca: proxima ? proxima.vencimento : null,
          parcelas,
        };
      });

      const naoCancelados = emprestimos.filter((e) => e.status !== 'cancelado');

      const totalEmprestado = naoCancelados.filter((e) => e.saldoRestante > 0).reduce((a, e) => a + e.capital, 0);
      const totalAReceber = naoCancelados.reduce((a, e) => a + e.saldoRestante, 0);
      const ganhoPrevisto = naoCancelados.reduce((a, e) => a + e.ganhoPrevisto, 0);

      // Recebido (all-time, só empréstimos não cancelados) — usado apenas
      // na composição da Carteira financeira, ver nota no topo do arquivo.
      const recebidoCarteira = naoCancelados.reduce(
        (a, e) => a + e.parcelas.reduce((acc, p) => acc + p.valorPago, 0),
        0
      );

      let emAtraso = 0;
      const proximasCobrancas = [];
      for (const e of naoCancelados) {
        for (const p of e.parcelas) {
          const restante = p.valor - p.valorPago;
          if (restante <= 0 || p.statusBruto === 'cancelado') continue;
          const delta = diasEntreDatas(hoje, p.vencimento); // vencimento - hoje
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
      const qtdProximas = proximasCobrancas.length;

      const emprestimosAndamento = naoCancelados
        .filter((e) => e.statusCalculado !== 'quitado')
        .slice(0, 5)
        .map((e) => ({
          id: e.id, clienteId: e.clienteId, cliente: e.clienteNome != null ? { nome: e.clienteNome } : null,
          statusCalculado: e.statusCalculado, saldoRestante: e.saldoRestante, proximaCobranca: e.proximaCobranca,
        }));

      // Pagamentos no período (independente de cancelamento posterior do empréstimo)
      const rPag = await c.query(
        `SELECT p.valor_recebido_centavos, e.capital_centavos, e.total_centavos
         FROM pagamentos p
         JOIN emprestimos e ON e.id = p.emprestimo_id
         WHERE p.data BETWEEN $1 AND $2`,
        [inicio, fim]
      );
      let jaRecebido = 0, ganhoRealizado = 0;
      for (const row of rPag.rows) {
        const vr = Number(row.valor_recebido_centavos);
        const cap = Number(row.capital_centavos);
        const tot = Number(row.total_centavos);
        jaRecebido += vr;
        ganhoRealizado += Math.round(vr * ((tot - cap) / tot));
      }

      // Movimentações financeiras no período (linha a linha, para poder
      // somar os totais E montar a série diária/mensal do gráfico de
      // Fluxo financeiro a partir da MESMA consulta — garante que
      // entradas/saidas e fluxoSerie nunca divirjam entre si).
      const rMovPeriodo = await c.query(
        `SELECT tipo, data, valor_centavos
         FROM movimentacoes_financeiras WHERE data BETWEEN $1 AND $2`,
        [inicio, fim]
      );
      let entradas = 0, saidas = 0;
      const porDia = new Map(); // 'YYYY-MM-DD' -> { entradas, saidas }
      for (const r of rMovPeriodo.rows) {
        const valor = Number(r.valor_centavos);
        const dataMov = paraDataISO(r.data);
        if (r.tipo === 'entrada') entradas += valor; else saidas += valor;
        if (!porDia.has(dataMov)) porDia.set(dataMov, { entradas: 0, saidas: 0 });
        const bucket = porDia.get(dataMov);
        if (r.tipo === 'entrada') bucket.entradas += valor; else bucket.saidas += valor;
      }

      // Monta a série contínua (sem buracos) no grão adequado à largura do
      // período: até 31 dias -> por dia; mais que isso -> por mês.
      const larguraDias = diasEntreDatas(inicio, fim) + 1;
      const fluxoSerie = [];
      if (larguraDias <= 31) {
        const [iy, im, id_] = inicio.split('-').map(Number);
        const [fy2, fm2, fd2] = fim.split('-').map(Number);
        let atual = Date.UTC(iy, im - 1, id_);
        const fimMs = Date.UTC(fy2, fm2 - 1, fd2);
        while (atual <= fimMs) {
          const iso = new Date(atual).toISOString().slice(0, 10);
          const b = porDia.get(iso) || { entradas: 0, saidas: 0 };
          fluxoSerie.push({ data: iso, entradas: b.entradas, saidas: b.saidas });
          atual += 86400000;
        }
      } else {
        const porMes = new Map(); // 'YYYY-MM-01' -> { entradas, saidas }
        for (const [dataMov, b] of porDia.entries()) {
          const chaveMes = dataMov.slice(0, 7) + '-01';
          if (!porMes.has(chaveMes)) porMes.set(chaveMes, { entradas: 0, saidas: 0 });
          const acc = porMes.get(chaveMes);
          acc.entradas += b.entradas;
          acc.saidas += b.saidas;
        }
        // preenche meses sem nenhuma movimentação, para a curva não ter buracos
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

      // Capital disponível: saldo ALL-TIME do Financeiro — mesma fonte, sem duplicar.
      const rMovTotal = await c.query(
        `SELECT tipo, COALESCE(SUM(valor_centavos), 0) AS total FROM movimentacoes_financeiras GROUP BY tipo`
      );
      let entradasTotais = 0, saidasTotais = 0;
      for (const r of rMovTotal.rows) {
        if (r.tipo === 'entrada') entradasTotais = Number(r.total); else saidasTotais = Number(r.total);
      }
      const capitalDisponivel = entradasTotais - saidasTotais;

      // Carteira financeira: recebido + a receber em dia + em atraso ==
      // total contratado (soma de total_centavos dos empréstimos não
      // cancelados) — três fatias mutuamente exclusivas, nada duplicado.
      const totalContratado = naoCancelados.reduce((a, e) => a + e.total, 0);
      const aReceberEmDia = totalAReceber - emAtraso;
      const carteira = {
        recebido: recebidoCarteira,
        aReceberEmDia,
        emAtraso,
        total: totalContratado,
      };

      return {
        capitalDisponivel, totalEmprestado, totalAReceber, jaRecebido, ganhoPrevisto, ganhoRealizado,
        emAtraso, qtdProximas, entradas, saidas,
        proximasCobrancas: proximasCobrancas.slice(0, 5),
        emprestimosAndamento,
        fluxoSerie, carteira,
      };
    });

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao calcular dashboard.' });
    console.error('[dashboard] erro:', err.message);
  }
});

module.exports = router;
