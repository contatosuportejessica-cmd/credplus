// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Busca Global (Etapa 10 do produto real)
//
// Contrato definido pelo FRONTEND JÁ EXISTENTE (assets/js/app.js):
//   GET /busca?q=<termo>
//   -> loja.buscarGlobal(termo): "if (!termo) return [];" e no modo demo
//      filtra APENAS this.demo.clientes por nome (substring,
//      case-insensitive, sem tratamento de acento):
//        this.demo.clientes.filter(c => c.nome.toLowerCase().includes(t))
//          .map(c => this._resumoCliente(c))
//
// Ou seja: a Busca Global pesquisa SOMENTE Clientes, SOMENTE pelo campo
// nome. Não existem categorias de Empréstimos/Lembretes/Metas/Notas no
// contrato real — não foram inventadas aqui.
//
// Resultado consumido pelo dropdown (wireBusca em app.js):
//   c.id, c.nome, c.operacoes, c.saldoPendente, c.proximaCobranca
// Nenhum outro campo é lido — não retornamos telefone/documento/email/
// observações (minimização de dados: só o que a interface renderiza).
//
// Clique no resultado chama navegarClienteDetalhe(c.id) — reaproveita a
// tela de detalhe do cliente já existente (GET /api/clientes/:id, Etapa
// 1); nenhuma rota nova de navegação precisa existir.
//
// Sem tabela de busca própria: consulta direta em clientes (+ emprestimos
// e parcelas só para computar os agregados operacoes/saldoPendente/
// proximaCobranca do mesmo jeito que Empréstimos e Dashboard já fazem —
// nenhum dado financeiro é duplicado, tudo calculado ao vivo).
//
// Clientes arquivados ficam de fora, mesma convenção já usada em
// GET /api/clientes (arquivado = fora das listagens operacionais normais).
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

const LIMITE_RESULTADOS = 20;

// Escapa os metacaracteres do ILIKE (% _ \) para que um termo de busca
// contendo esses símbolos seja tratado como texto literal, não como
// coringa — e sempre via parâmetro ligado ($1), nunca concatenado na
// string SQL (proteção estrutural contra SQL injection).
function escaparCoringasLike(s) {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

function paraDataISO(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

// GET /api/busca?q=
router.get('/', async (req, res) => {
  const termo = String(req.query.q || '').trim();
  if (!termo) return res.json([]);
  if (termo.length > 200) return res.status(400).json({ mensagem: 'Termo de busca muito longo.' });

  const padrao = `%${escaparCoringasLike(termo)}%`;

  try {
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      const rClientes = await c.query(
        `SELECT id, nome FROM clientes
         WHERE status <> 'arquivado' AND nome ILIKE $1 ESCAPE '\\'
         ORDER BY nome ASC
         LIMIT $2`,
        [padrao, LIMITE_RESULTADOS]
      );
      if (!rClientes.rows.length) return [];

      const idsClientes = rClientes.rows.map((c2) => c2.id);
      const rEmp = await c.query(
        `SELECT id, cliente_id, status FROM emprestimos WHERE cliente_id = ANY($1::int[])`,
        [idsClientes]
      );
      const empIds = rEmp.rows.map((e) => e.id);
      const rPar = empIds.length
        ? await c.query(
            `SELECT emprestimo_id, valor_centavos, valor_pago_centavos, vencimento FROM parcelas WHERE emprestimo_id = ANY($1::int[])`,
            [empIds]
          )
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

        if (!resumoPorCliente.has(e.cliente_id)) resumoPorCliente.set(e.cliente_id, { operacoes: 0, saldoPendente: 0, proximaCobranca: null });
        const r = resumoPorCliente.get(e.cliente_id);
        r.operacoes += 1;
        r.saldoPendente += saldo;
        if (proxima && (!r.proximaCobranca || proxima < r.proximaCobranca)) r.proximaCobranca = proxima;
      }

      return rClientes.rows.map((cl) => {
        const r = resumoPorCliente.get(cl.id) || { operacoes: 0, saldoPendente: 0, proximaCobranca: null };
        return { id: cl.id, nome: cl.nome, operacoes: r.operacoes, saldoPendente: r.saldoPendente, proximaCobranca: r.proximaCobranca };
      });
    });

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao buscar.' });
    console.error('[busca] erro:', err.message);
  }
});

module.exports = router;
