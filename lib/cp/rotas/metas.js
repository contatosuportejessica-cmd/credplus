// CredPlus serverless — Metas.
// Progresso sempre derivado ao vivo (nunca armazenado). Sem PUT: meta não
// é editada depois de criada.
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO, idRota } = require('../http');

const TIPOS = ['capital_emprestado', 'recebimentos', 'ganho', 'quantidade_operacoes'];
const PERIODOS = ['mensal', 'trimestral', 'anual', 'personalizado'];

function montarResposta(m) {
  return {
    id: m.id, titulo: m.titulo, tipo: m.tipo, periodo: m.periodo,
    valorAlvo: Number(m.valor_alvo),
    dataInicio: paraDataISO(m.data_inicio), dataFim: paraDataISO(m.data_fim),
    criadoEm: m.criado_em,
  };
}

async function listar({ usuarioId, res }) {
  try {
    const r = await db.withUser(usuarioId, (c) => c.query(`SELECT * FROM metas ORDER BY criado_em DESC`));
    return ok(res, r.rows.map(montarResposta));
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar metas.');
  }
}

async function criar({ body, usuarioId, res }) {
  const corpo = body || {};
  const titulo = String(corpo.titulo || '').trim().slice(0, 200);
  const tipo = String(corpo.tipo || '');
  const periodo = String(corpo.periodo || '');
  const valorAlvo = Math.trunc(Number(corpo.valorAlvo));
  const dataInicio = String(corpo.dataInicio || '');
  const dataFim = String(corpo.dataFim || '');

  const erros = [];
  if (!titulo) erros.push('Informe um título para a meta.');
  if (!TIPOS.includes(tipo)) erros.push('Tipo de meta inválido.');
  if (!PERIODOS.includes(periodo)) erros.push('Período inválido.');
  if (!Number.isFinite(valorAlvo) || valorAlvo <= 0) erros.push('Informe um valor alvo válido.');
  if (!dataValida(dataInicio)) erros.push('Data de início inválida.');
  if (!dataValida(dataFim)) erros.push('Data de fim inválida.');
  if (dataValida(dataInicio) && dataValida(dataFim) && dataFim < dataInicio) {
    erros.push('A data de fim não pode ser anterior à data de início.');
  }
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const r = await db.withUser(usuarioId, (c) => c.query(
      `INSERT INTO metas (usuario_id, titulo, tipo, periodo, valor_alvo, data_inicio, data_fim)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [usuarioId, titulo, tipo, periodo, valorAlvo, dataInicio, dataFim]));
    return ok(res, montarResposta(r.rows[0]), 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao criar meta.');
  }
}

async function progresso({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Meta não encontrada.');

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const rMeta = await c.query('SELECT * FROM metas WHERE id = $1', [id]);
      if (!rMeta.rows.length) return { erro: 404, mensagem: 'Meta não encontrada.' };
      const meta = rMeta.rows[0];

      let realizado = 0;
      if (meta.tipo === 'recebimentos') {
        const r = await c.query(
          `SELECT COALESCE(SUM(valor_recebido_centavos), 0) AS realizado FROM pagamentos WHERE data BETWEEN $1 AND $2`,
          [meta.data_inicio, meta.data_fim]);
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'capital_emprestado') {
        const r = await c.query(
          `SELECT COALESCE(SUM(capital_centavos), 0) AS realizado FROM emprestimos WHERE data_operacao BETWEEN $1 AND $2`,
          [meta.data_inicio, meta.data_fim]);
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'quantidade_operacoes') {
        const r = await c.query(
          `SELECT COUNT(*) AS realizado FROM emprestimos WHERE data_operacao BETWEEN $1 AND $2`,
          [meta.data_inicio, meta.data_fim]);
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'ganho') {
        const r = await c.query(
          `SELECT COALESCE(SUM(ROUND(p.valor_recebido_centavos::numeric * (e.total_centavos - e.capital_centavos) / e.total_centavos)), 0) AS realizado
           FROM pagamentos p JOIN emprestimos e ON e.id = p.emprestimo_id
           WHERE p.data BETWEEN $1 AND $2`, [meta.data_inicio, meta.data_fim]);
        realizado = r.rows[0].realizado;
      }
      return { realizado };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, { realizado: Number(resultado.realizado) });
  } catch (e) {
    return falhar(res, 500, 'Falha ao calcular progresso da meta.');
  }
}

async function excluir({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Meta não encontrada.');
  try {
    const r = await db.withUser(usuarioId, (c) => c.query(`DELETE FROM metas WHERE id = $1 RETURNING id`, [id]));
    if (!r.rows.length) return falhar(res, 404, 'Meta não encontrada.');
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao excluir meta.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (method === 'GET' && seg.length === 0) return listar(ctx);
  if (method === 'POST' && seg.length === 0) return criar(ctx);
  if (method === 'GET' && seg.length === 2 && seg[1] === 'progresso') return progresso(ctx);
  if (method === 'DELETE' && seg.length === 1) return excluir(ctx);
  return null;
}

module.exports = { tratar };
