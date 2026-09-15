// CredPlus serverless — Cobranças.
// Sem tabela própria: view somente leitura sobre parcelas com saldo
// pendente de empréstimos não cancelados. Filtros por janela de
// vencimento, com "hoje" em America/Sao_Paulo.
const db = require('../db');
const { ok, falhar, paraDataISO, hojeSP, diasEntreDatas } = require('../http');

const FILTROS_VALIDOS = ['hoje', 'amanha', '7dias', '30dias', 'atrasadas', 'todas'];

function statusParcelaCalc(delta, restante) {
  if (restante <= 0) return 'pago';
  if (delta < 0) return 'atrasado';
  if (delta === 0) return 'vence-hoje';
  return 'pendente';
}

function montarCobranca(p, hoje) {
  const valor = Number(p.valor_centavos);
  const valorPago = Number(p.valor_pago_centavos);
  const restante = valor - valorPago;
  const vencimento = paraDataISO(p.vencimento);
  const delta = diasEntreDatas(hoje, vencimento);
  return {
    id: p.id, numero: p.numero, total: p.total_parcelas,
    valor, valorPago, vencimento, status: p.status,
    statusCalc: statusParcelaCalc(delta, restante),
    diasAtraso: delta < 0 ? -delta : 0, emprestimoId: p.emprestimo_id,
    cliente: { id: p.cliente_id, nome: p.cliente_nome, telefone: p.telefone, whatsapp: p.whatsapp },
    _delta: delta,
  };
}

function aplicarFiltro(c, filtro) {
  const d = c._delta;
  if (filtro === 'hoje') return d === 0;
  if (filtro === 'amanha') return d === 1;
  if (filtro === '7dias') return d >= 0 && d <= 7;
  if (filtro === '30dias') return d >= 0 && d <= 30;
  if (filtro === 'atrasadas') return d < 0;
  return true;
}

async function tratar({ method, seg, query, usuarioId, res }) {
  if (!(method === 'GET' && seg.length === 0)) return null;
  const filtro = String(query.filtro || 'todas').trim();
  if (!FILTROS_VALIDOS.includes(filtro)) return falhar(res, 400, 'Filtro inválido.');

  try {
    const hoje = hojeSP();
    const linhas = await db.withUser(usuarioId, (c) => c.query(
      `SELECT p.id, p.numero, e.qtd_parcelas AS total_parcelas, p.valor_centavos, p.valor_pago_centavos,
              p.vencimento, p.status, e.id AS emprestimo_id,
              cl.id AS cliente_id, cl.nome AS cliente_nome, cl.telefone, cl.whatsapp
       FROM parcelas p
       JOIN emprestimos e ON e.id = p.emprestimo_id
       JOIN clientes cl ON cl.id = e.cliente_id
       WHERE e.status <> 'cancelado' AND (p.valor_centavos - p.valor_pago_centavos) > 0
         AND p.usuario_id = $1 AND e.usuario_id = $1 AND cl.usuario_id = $1
        ORDER BY p.vencimento ASC`, [usuarioId]));

    const resultado = linhas.rows
      .map((p) => montarCobranca(p, hoje))
      .filter((c) => aplicarFiltro(c, filtro))
      .map(({ _delta, ...resto }) => resto);

    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar cobranças.');
  }
}

module.exports = { tratar };
