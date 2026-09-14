// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Cobranças (Etapa 5 do produto real)
//
// DECISÃO DE ARQUITETURA: não existe tabela "cobrancas". Uma cobrança é
// simplesmente uma PARCELA com saldo pendente (valor - valorPago > 0) de
// um empréstimo que não está cancelado — exatamente como o próprio modo
// demo do frontend já constrói essa lista (loja.listarCobrancas). Ter uma
// segunda tabela armazenando "cobranças" criaria uma segunda fonte de
// verdade que poderia divergir da parcela real (ex.: parcela paga mas
// cobrança ainda marcada como aberta). Esta rota é uma VIEW somente
// leitura sobre clientes + emprestimos + parcelas.
//
// Contrato real (app.js):
//   GET /api/cobrancas?filtro=hoje|amanha|7dias|30dias|atrasadas|todas
//   -> cada item: parcela + cliente (nome/telefone/whatsapp) + emprestimoId
//      + diasAtraso (0 se não vencida) + statusCalc.
//   "Adiar lembrete" reusa PUT /api/parcelas/:id (já existe, nenhuma rota
//   nova necessária para isso). "Registrar pagamento" reusa POST
//   /api/pagamentos. O WhatsApp é só um link wa.me montado no PRÓPRIO
//   frontend (loja não muda) — nenhuma integração paga aqui.
//
// Fuso horário: "hoje" é calculado explicitamente em America/Sao_Paulo,
// não no fuso do processo Node/VPS — isso evita que uma parcela que vence
// hoje (no horário do usuário, no Brasil) apareça como atrasada por causa
// de o servidor rodar em UTC (ver mesma correção em rotas/emprestimos.js).
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

const FILTROS_VALIDOS = ['hoje', 'amanha', '7dias', '30dias', 'atrasadas', 'todas'];

function hojeSaoPaulo() {
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
  const vencimento = p.vencimento instanceof Date ? p.vencimento.toISOString().slice(0, 10) : p.vencimento;
  const delta = diasEntreDatas(hoje, vencimento); // vencimento - hoje
  const diasAtraso = delta < 0 ? -delta : 0;
  return {
    id: p.id, numero: p.numero, total: p.total_parcelas,
    valor, valorPago, vencimento, status: p.status,
    statusCalc: statusParcelaCalc(delta, restante),
    diasAtraso, emprestimoId: p.emprestimo_id,
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
  return true; // 'todas'
}

// GET /api/cobrancas?filtro=
router.get('/', async (req, res) => {
  const filtro = String(req.query.filtro || 'todas').trim();
  if (!FILTROS_VALIDOS.includes(filtro)) return res.status(400).json({ mensagem: 'Filtro inválido.' });

  try {
    const hoje = hojeSaoPaulo();
    const linhas = await db.comUsuario(req.usuarioId, (c) => c.query(
      `SELECT p.id, p.numero, e.qtd_parcelas AS total_parcelas, p.valor_centavos, p.valor_pago_centavos,
              p.vencimento, p.status, e.id AS emprestimo_id,
              cl.id AS cliente_id, cl.nome AS cliente_nome, cl.telefone, cl.whatsapp
       FROM parcelas p
       JOIN emprestimos e ON e.id = p.emprestimo_id
       JOIN clientes cl ON cl.id = e.cliente_id
       WHERE e.status <> 'cancelado' AND (p.valor_centavos - p.valor_pago_centavos) > 0
       ORDER BY p.vencimento ASC`
    ));

    const resultado = linhas.rows
      .map((p) => montarCobranca(p, hoje))
      .filter((c) => aplicarFiltro(c, filtro))
      .map(({ _delta, ...resto }) => resto);

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar cobranças.' });
    console.error('[cobrancas] erro ao listar:', err.message);
  }
});

module.exports = router;
