// CredPlus serverless — Metas.
// Progresso sempre derivado ao vivo (nunca armazenado).
// Tipo 'recebimento_mensal': meta de quanto RECEBER num mês (mês-alvo
// guardado em data_inicio/data_fim = 1º/último dia, periodo='mensal' —
// sem coluna nova, sem migration). PUT existe (meta não é histórico
// financeiro); o tipo em si nunca muda depois de criado.
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO, idRota } = require('../http');

const TIPOS = ['capital_emprestado', 'recebimentos', 'ganho', 'quantidade_operacoes', 'recebimento_mensal'];
const PERIODOS = ['mensal', 'trimestral', 'anual', 'personalizado'];

function ultimoDiaMes(anoMes) {
  const [y, m] = anoMes.split('-').map(Number);
  return new Date(y, m, 0).toISOString().slice(0, 10);
}

function mesValidoParaMensal(dataInicio, dataFim) {
  if (!/^\d{4}-\d{2}-01$/.test(dataInicio)) return false;
  return dataFim === ultimoDiaMes(dataInicio.slice(0, 7));
}

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
    const r = await db.withUser(usuarioId, (c) => c.query(`SELECT * FROM metas WHERE usuario_id = $1 ORDER BY criado_em DESC`, [usuarioId]));
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
  if (tipo === 'recebimento_mensal') {
    if (periodo !== 'mensal') erros.push('Meta mensal usa período mensal.');
    else if (!mesValidoParaMensal(dataInicio, dataFim)) {
      erros.push('Mês-alvo inválido: use o 1º ao último dia do mês.');
    }
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
      const rMeta = await c.query('SELECT * FROM metas WHERE id = $1 AND usuario_id = $2', [id, usuarioId]);
      if (!rMeta.rows.length) return { erro: 404, mensagem: 'Meta não encontrada.' };
      const meta = rMeta.rows[0];

      let realizado = 0;
      let extra = null;
      if (meta.tipo === 'recebimento_mensal') {
        const inicio = paraDataISO(meta.data_inicio);
        const fim = paraDataISO(meta.data_fim);
        const mesAlvo = inicio.slice(0, 7);
        const rRec = await c.query(
          `SELECT COALESCE(SUM(valor_recebido_centavos), 0) AS recebido FROM pagamentos WHERE usuario_id = $1 AND data BETWEEN $2 AND $3`,
          [usuarioId, inicio, fim]);
        const recebido = Number(rRec.rows[0].recebido);
        const rPrev = await c.query(
          `SELECT COALESCE(SUM(p.valor_centavos - p.valor_pago_centavos), 0) AS previsto
           FROM parcelas p JOIN emprestimos e ON e.id = p.emprestimo_id
           WHERE e.status <> 'cancelado' AND p.vencimento BETWEEN $1 AND $2 AND (p.valor_centavos - p.valor_pago_centavos) > 0
             AND p.usuario_id = $3 AND e.usuario_id = $3`,
          [inicio, fim, usuarioId]);
        const previsto = Number(rPrev.rows[0].previsto);
        const alvo = Number(meta.valor_alvo);
        const potencial = recebido + previsto;
        const falta = Math.max(0, alvo - potencial);
        const rComp = await c.query(
          `SELECT p.id, p.numero, e.qtd_parcelas AS total_parcelas, p.vencimento,
                  p.valor_centavos, p.valor_pago_centavos,
                  (p.valor_centavos - p.valor_pago_centavos) AS saldo,
                  e.id AS emprestimo_id, cl.id AS cliente_id, cl.nome AS cliente_nome
           FROM parcelas p
           JOIN emprestimos e ON e.id = p.emprestimo_id
           JOIN clientes cl ON cl.id = e.cliente_id
           WHERE e.status <> 'cancelado' AND p.vencimento BETWEEN $1 AND $2
             AND p.usuario_id = $3 AND e.usuario_id = $3 AND cl.usuario_id = $3
           ORDER BY p.vencimento ASC, cl.nome ASC`,
          [inicio, fim, usuarioId]);
        const composicao = rComp.rows.map((p) => ({
          parcelaId: p.id, numero: p.numero, totalParcelas: p.total_parcelas,
          vencimento: paraDataISO(p.vencimento),
          valor: Number(p.valor_centavos), valorPago: Number(p.valor_pago_centavos),
          saldo: Number(p.saldo), emprestimoId: p.emprestimo_id,
          cliente: { id: p.cliente_id, nome: p.cliente_nome },
        }));
        const [ay, am] = mesAlvo.split('-').map(Number);
        const meses = [];
        for (let i = 0; i < 6; i++) {
          const d = new Date(Date.UTC(ay, am - 1 + i, 1));
          meses.push(d.toISOString().slice(0, 7));
        }
        const rProj = await c.query(
          `SELECT to_char(p.vencimento, 'YYYY-MM') AS mes,
                  COALESCE(SUM(p.valor_centavos - p.valor_pago_centavos), 0) AS previsto
           FROM parcelas p JOIN emprestimos e ON e.id = p.emprestimo_id
           WHERE e.status <> 'cancelado' AND (p.valor_centavos - p.valor_pago_centavos) > 0
             AND to_char(p.vencimento, 'YYYY-MM') = ANY($1)
             AND p.usuario_id = $2 AND e.usuario_id = $2
           GROUP BY 1`,
          [meses, usuarioId]);
        const porMes = new Map(rProj.rows.map((r2) => [r2.mes, Number(r2.previsto)]));
        const rTicket = await c.query(
          `SELECT COALESCE(AVG(p.valor_centavos), 0) AS ticket, COUNT(*) AS n
           FROM parcelas p JOIN emprestimos e ON e.id = p.emprestimo_id
           WHERE e.status <> 'cancelado' AND (p.valor_centavos - p.valor_pago_centavos) > 0
             AND p.usuario_id = $1 AND e.usuario_id = $1`, [usuarioId]);
        realizado = recebido;
        extra = {
          recebido, previsto, potencial, falta,
          cobertura: alvo > 0 ? Math.min(100, Math.round((potencial / alvo) * 100)) : 0,
          mesAlvo, composicao,
          projecao: meses.map((m) => ({ mes: m, previsto: porMes.get(m) || 0 })),
          ticketMedio: Number(rTicket.rows[0].ticket),
          qtdParcelasFuturas: Number(rTicket.rows[0].n),
        };
      } else if (meta.tipo === 'recebimentos') {
        const r = await c.query(
          `SELECT COALESCE(SUM(valor_recebido_centavos), 0) AS realizado FROM pagamentos WHERE usuario_id = $1 AND data BETWEEN $2 AND $3`,
          [usuarioId, meta.data_inicio, meta.data_fim]);
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'capital_emprestado') {
        const r = await c.query(
          `SELECT COALESCE(SUM(capital_centavos), 0) AS realizado FROM emprestimos WHERE usuario_id = $1 AND data_operacao BETWEEN $2 AND $3`,
          [usuarioId, meta.data_inicio, meta.data_fim]);
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'quantidade_operacoes') {
        const r = await c.query(
          `SELECT COUNT(*) AS realizado FROM emprestimos WHERE usuario_id = $1 AND data_operacao BETWEEN $2 AND $3`,
          [usuarioId, meta.data_inicio, meta.data_fim]);
        realizado = r.rows[0].realizado;
      } else if (meta.tipo === 'ganho') {
        const r = await c.query(
          `SELECT COALESCE(SUM(ROUND(p.valor_recebido_centavos::numeric * (e.total_centavos - e.capital_centavos) / e.total_centavos)), 0) AS realizado
           FROM pagamentos p JOIN emprestimos e ON e.id = p.emprestimo_id
           WHERE p.data BETWEEN $1 AND $2 AND p.usuario_id = $3 AND e.usuario_id = $3`, [meta.data_inicio, meta.data_fim, usuarioId]);
        realizado = r.rows[0].realizado;
      }
      return { realizado, extra };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    if (resultado.extra) {
      return ok(res, { realizado: Number(resultado.realizado), ...resultado.extra });
    }
    return ok(res, { realizado: Number(resultado.realizado) });
  } catch (e) {
    return falhar(res, 500, 'Falha ao calcular progresso da meta.');
  }
}

// PUT /api/metas/:id — edita título/valor/período (meta não é histórico
// financeiro). O tipo nunca muda (cada tipo tem semântica própria).
async function atualizar({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Meta não encontrada.');
  const corpo = body || {};
  const titulo = corpo.titulo !== undefined ? String(corpo.titulo || '').trim().slice(0, 200) : undefined;
  const valorAlvo = corpo.valorAlvo !== undefined ? Math.trunc(Number(corpo.valorAlvo)) : undefined;
  const dataInicio = corpo.dataInicio !== undefined ? String(corpo.dataInicio || '') : undefined;
  const dataFim = corpo.dataFim !== undefined ? String(corpo.dataFim || '') : undefined;
  const periodo = corpo.periodo !== undefined ? String(corpo.periodo || '') : undefined;

  const erros = [];
  if (titulo !== undefined && !titulo) erros.push('Informe um título para a meta.');
  if (valorAlvo !== undefined && (!Number.isFinite(valorAlvo) || valorAlvo <= 0)) erros.push('Informe um valor alvo válido.');
  if (periodo !== undefined && !PERIODOS.includes(periodo)) erros.push('Período inválido.');
  if (dataInicio !== undefined && !dataValida(dataInicio)) erros.push('Data de início inválida.');
  if (dataFim !== undefined && !dataValida(dataFim)) erros.push('Data de fim inválida.');
  if (titulo === undefined && valorAlvo === undefined && dataInicio === undefined && dataFim === undefined && periodo === undefined) {
    erros.push('Nenhum campo para atualizar.');
  }
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  function ehMensal(tipo) { return tipo === 'recebimento_mensal'; }

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const rMeta = await c.query('SELECT * FROM metas WHERE id = $1 AND usuario_id = $2', [id, usuarioId]);
      if (!rMeta.rows.length) return { erro: 404, mensagem: 'Meta não encontrada.' };
      const atual = rMeta.rows[0];
      const ini = dataInicio !== undefined ? dataInicio : paraDataISO(atual.data_inicio);
      const fim = dataFim !== undefined ? dataFim : paraDataISO(atual.data_fim);
      if (fim < ini) return { erro: 400, mensagem: 'A data de fim não pode ser anterior à data de início.' };
      if (ehMensal(atual.tipo) && !mesValidoParaMensal(ini, fim)) {
        return { erro: 400, mensagem: 'Mês-alvo inválido: use o 1º ao último dia do mês.' };
      }
      const campos = [];
      const valores = [];
      const add = (col, v) => { campos.push(col); valores.push(v); };
      if (titulo !== undefined) add('titulo', titulo);
      if (valorAlvo !== undefined) add('valor_alvo', valorAlvo);
      if (periodo !== undefined) {
        if (ehMensal(atual.tipo) && periodo !== 'mensal') {
          return { erro: 400, mensagem: 'Meta mensal usa período mensal.' };
        }
        add('periodo', periodo);
      }
      if (dataInicio !== undefined) add('data_inicio', ini);
      if (dataFim !== undefined) add('data_fim', fim);
      if (!campos.length) return { erro: 400, mensagem: 'Nenhum campo para atualizar.' };
      const setClause = campos.map((col, i) => `${col} = $${i + 2}`).join(', ');
      const _n = valores.length;
      const rUpd = await c.query(`UPDATE metas SET ${setClause} WHERE id = $1 AND usuario_id = $${_n + 2} RETURNING *`, [id, ...valores, usuarioId]);
      return { meta: rUpd.rows[0] };
    });
    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarResposta(resultado.meta));
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar meta.');
  }
}

async function excluir({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Meta não encontrada.');
  try {
    const r = await db.withUser(usuarioId, (c) => c.query(`DELETE FROM metas WHERE id = $1 AND usuario_id = $2 RETURNING id`, [id, usuarioId]));
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
  if (method === 'PUT' && seg.length === 1) return atualizar(ctx);
  if (method === 'DELETE' && seg.length === 1) return excluir(ctx);
  return null;
}

module.exports = { tratar };
