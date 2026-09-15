// ═══════════════════════════════════════════════════════════════════════
// CredPlus — entrada serverless da Vercel para toda a API (catch-all).
//
// Qualquer requisição em /api/* cai aqui. Roteamento manual em Node puro:
// SEM Express, SEM backend/src (o backend antigo em /backend segue existindo
// só como referência das regras de negócio — esta camada não o importa,
// não o executa e não depende dele).
//
// Cada invocação abre sua própria conexão com o Neon e a fecha ao final
// (ver lib/cp/db.js): nada de Pool fixo, app.listen, PM2, disco local ou
// dotenv — incompatíveis com serverless.
//
// Rotas fora do núcleo (recuperação de senha, notificações, uploads) ou
// de teste (registros) respondem 404 com mensagem clara: o frontend trata
// 404 como "recurso ainda não implementado" e orienta para a demonstração.
// ═══════════════════════════════════════════════════════════════════════
const { usuarioDoHeader } = require('../lib/cp/auth');
const { ok, falhar, lerCorpo } = require('../lib/cp/http');
const db = require('../lib/cp/db');

const ROTAS = {
  auth: require('../lib/cp/rotas/auth'),
  clientes: require('../lib/cp/rotas/clientes'),
  emprestimos: require('../lib/cp/rotas/emprestimos'),
  parcelas: require('../lib/cp/rotas/parcelas'),
  pagamentos: require('../lib/cp/rotas/pagamentos'),
  financeiro: require('../lib/cp/rotas/financeiro'),
  cobrancas: require('../lib/cp/rotas/cobrancas'),
  dashboard: require('../lib/cp/rotas/dashboard'),
  busca: require('../lib/cp/rotas/busca'),
  lembretes: require('../lib/cp/rotas/lembretes'),
  metas: require('../lib/cp/rotas/metas'),
  notas: require('../lib/cp/rotas/notas'),
  simulacoes: require('../lib/cp/rotas/simulacoes'),
  usuario: require('../lib/cp/rotas/usuario'),
};

// Recursos públicos (sem JWT).
function rotaPublica(recurso, seg, method) {
  if (recurso === 'health' && method === 'GET' && seg.length === 0) return true;
  if (recurso === 'auth' && method === 'POST' && seg.length === 1 && (seg[0] === 'login' || seg[0] === 'register')) return true;
  if (recurso === 'auth' && method === 'POST' && seg.length === 1 && seg[0] === 'logout') return true;
  return false;
}

// Extrai os segmentos após /api. Na Vercel o catch-all entrega
// req.query.path (array); fora dela, derivamos de req.url.
function segmentos(req) {
  const q = req.query;
  if (q) {
    const p = q.path;
    if (Array.isArray(p)) return p.filter(Boolean);
    if (typeof p === 'string' && p) return p.split('/').filter(Boolean);
  }
  try {
    const url = new URL(req.url || '/', 'http://local');
    return url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return [];
  }
}

function consulta(req) {
  if (req.query && typeof req.query === 'object') {
    const { path: _ignorado, ...resto } = req.query;
    const simples = {};
    for (const [k, v] of Object.entries(resto)) simples[k] = Array.isArray(v) ? v[0] : v;
    if (Object.keys(simples).length) return simples;
  }
  try {
    const url = new URL(req.url || '/', 'http://local');
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

async function saude(_ctx, res) {
  try {
    const t0 = Date.now();
    await db.queryPublica('SELECT 1', []);
    return ok(res, { ok: true, banco: { ok: true, ms: Date.now() - t0 } });
  } catch (e) {
    return ok(res, { ok: false, banco: { ok: false, motivo: e.message } }, 503);
  }
}

module.exports = async function handler(req, res) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    const partes = segmentos(req);
    const query = consulta(req);

    if (!partes.length) return falhar(res, 404, 'Rota não encontrada');
    const [recurso, ...seg] = partes;

    if (recurso === 'health' && method === 'GET' && seg.length === 0) return saude(null, res);

    const modulo = ROTAS[recurso];
    if (!modulo) return falhar(res, 404, 'Rota não encontrada');

    const ctx = { method, seg, query, res, usuarioId: null, body: undefined };

    if (!rotaPublica(recurso, seg, method)) {
      const usuarioId = usuarioDoHeader(req);
      if (!usuarioId) {
        const temToken = !!(req.headers && req.headers.authorization);
        return falhar(res, 401, temToken ? 'Sessão inválida ou expirada' : 'Não autenticado');
      }
      ctx.usuarioId = usuarioId;
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      ctx.body = await lerCorpo(req);
    } else {
      ctx.body = req.body !== undefined ? req.body : {};
    }

    const tratado = await modulo.tratar(ctx);
    if (tratado) return tratado;
    return falhar(res, 404, 'Rota não encontrada');
  } catch (e) {
    return falhar(res, 500, 'Erro interno');
  }
};
