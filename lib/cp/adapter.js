// CredPlus serverless — fábrica de handlers para as rotas file-based em api/.
//
// Cada arquivo em api/ é um adaptador mínimo: declara o recurso (chave de
// lib/cp/rotas/*), os segmentos e os parâmetros da rota. TODA a lógica de
// negócio, SQL e validação continua em lib/cp/rotas/* — aqui só existe
// tradução HTTP (método, query, corpo, JWT) para o contexto que os módulos
// de rota já esperam. Sem Express, sem SQL, sem regras de negócio.
const { usuarioDoHeader } = require('./auth');
const { ok, falhar, lerCorpo } = require('./http');
const db = require('./db');

const ROTAS = {
  auth: require('./rotas/auth'),
  clientes: require('./rotas/clientes'),
  emprestimos: require('./rotas/emprestimos'),
  parcelas: require('./rotas/parcelas'),
  pagamentos: require('./rotas/pagamentos'),
  financeiro: require('./rotas/financeiro'),
  cobrancas: require('./rotas/cobrancas'),
  dashboard: require('./rotas/dashboard'),
  busca: require('./rotas/busca'),
  lembretes: require('./rotas/lembretes'),
  metas: require('./rotas/metas'),
  notas: require('./rotas/notas'),
  simulacoes: require('./rotas/simulacoes'),
  usuario: require('./rotas/usuario'),
};

function primeiro(v) {
  return Array.isArray(v) ? v[0] : v;
}

// Query limpa no formato Vercel (req.query mistura querystring + params da
// rota): remove as chaves que são parâmetros do caminho e achata arrays.
function consultaLimpa(query, params) {
  const limpa = {};
  for (const [k, v] of Object.entries(query || {})) {
    if (params.indexOf(k) >= 0) continue;
    limpa[k] = primeiro(v);
  }
  return limpa;
}

function criarHandler({ recurso, segDe, params = [], publico = false }) {
  const modulo = ROTAS[recurso];
  if (!modulo) throw new Error('[adapter] recurso desconhecido: ' + recurso);
  return async function handler(req, res) {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      let usuarioId = null;
      if (!publico) {
        usuarioId = usuarioDoHeader(req);
        if (!usuarioId) {
          const temToken = !!(req.headers && req.headers.authorization);
          return falhar(res, 401, temToken ? 'Sessão inválida ou expirada' : 'Não autenticado');
        }
      }
      let body = {};
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        body = await lerCorpo(req);
      } else if (req.body !== undefined) {
        body = req.body;
      }
      const ctx = {
        method,
        seg: segDe(req),
        query: consultaLimpa(req.query, params),
        body,
        usuarioId,
        res,
      };
      const tratado = await modulo.tratar(ctx);
      if (tratado) return tratado;
      return falhar(res, 404, 'Rota não encontrada');
    } catch (e) {
      return falhar(res, 500, 'Erro interno');
    }
  };
}

// GET /api/health — único endpoint fora dos módulos de rota (só verifica
// a conexão com o banco, sem dado de usuário).
async function saudeHandler(_req, res) {
  try {
    const t0 = Date.now();
    await db.queryPublica('SELECT 1', []);
    return ok(res, { ok: true, banco: { ok: true, ms: Date.now() - t0 } });
  } catch (e) {
    return ok(res, { ok: false, banco: { ok: false, motivo: e.message } }, 503);
  }
}

// Dispatcher multi-prefixo para as funções consolidadas (api/d-*.js).
//
// Cada arquivo d-* atende VÁRIOS prefixos /api/* via `rewrites` do
// vercel.json, que entrega `__g` (grupo/prefixo) e `__r` (restante do
// caminho) na query. O mapa declara prefixo -> { recurso, publicos }.
//
// REGRA DE CRESCIMENTO (limite de 12 funções no Hobby): um endpoint novo
// entra no dispatcher do seu grupo (mapa + 1-2 regras de rewrite) — NUNCA
// como arquivo novo em api/. Só crie api/d-*.js novo se nenhum grupo
// existente servir, e sempre contando o total (máx. 8 por margem).
function criarDispatcher(mapa) {
  const recursos = {};
  for (const prefixo of Object.keys(mapa)) {
    const entrada = mapa[prefixo];
    if (!ROTAS[entrada.recurso]) throw new Error('[adapter] recurso desconhecido: ' + entrada.recurso);
    recursos[prefixo] = entrada;
  }
  return async function handler(req, res) {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const q = req.query || {};
      const grupo = primeiro(q.__g);
      const resto = primeiro(q.__r);
      const entrada = recursos[grupo];
      if (!entrada) return falhar(res, 404, 'Rota não encontrada');
      const seg = String(resto || '').split('/').filter(Boolean).map(decodeURIComponent);
      const publicos = entrada.publicos || [];
      let usuarioId = null;
      if (publicos.indexOf(seg[0]) < 0) {
        usuarioId = usuarioDoHeader(req);
        if (!usuarioId) {
          const temToken = !!(req.headers && req.headers.authorization);
          return falhar(res, 401, temToken ? 'Sessão inválida ou expirada' : 'Não autenticado');
        }
      }
      let body = {};
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        body = await lerCorpo(req);
      } else if (req.body !== undefined) {
        body = req.body;
      }
      const query = {};
      for (const [k, v] of Object.entries(q)) {
        if (k === '__g' || k === '__r') continue;
        query[k] = primeiro(v);
      }
      const ctx = { method, seg, query, body, usuarioId, res };
      const tratado = await ROTAS[entrada.recurso].tratar(ctx);
      if (tratado) return tratado;
      return falhar(res, 404, 'Rota não encontrada');
    } catch (e) {
      return falhar(res, 500, 'Erro interno');
    }
  };
}

module.exports = { criarHandler, criarDispatcher, saudeHandler, primeiro };
