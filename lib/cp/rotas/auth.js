// CredPlus serverless — Auth (registro, login, me, logout).
// Mesmas regras do backend antigo: funções SECURITY DEFINER para
// registro/login, hash scrypt, JWT 7d, resposta nunca inclui hash.
const db = require('../db');
const senhas = require('../senhas');
const { assinar } = require('../auth');
const { ok, falhar, emailValido } = require('../http');
const { TAMANHO_MINIMO } = senhas;

function senhaDoCorpo(corpo) {
  return String((corpo && (corpo.senha ?? corpo.password)) ?? '');
}

async function registrar({ body, res }) {
  const nome = String((body || {}).nome || '').trim();
  const email = String((body || {}).email || '').trim().toLowerCase();
  const senha = senhaDoCorpo(body);

  if (!nome || nome.length < 2) return falhar(res, 400, 'Nome é obrigatório (mínimo 2 caracteres)');
  if (nome.length > 200) return falhar(res, 400, 'Nome muito longo');
  if (!emailValido(email)) return falhar(res, 400, 'E-mail inválido');
  if (senha.length < TAMANHO_MINIMO) return falhar(res, 400, `Senha precisa ter ao menos ${TAMANHO_MINIMO} caracteres`);

  try {
    const hash = await senhas.criarHash(senha);
    const r = await db.queryPublica('SELECT credplus_registrar_usuario($1, $2, $3) AS id', [email, hash, nome]);
    const id = r.rows[0].id;
    if (id === null) return falhar(res, 409, 'Já existe uma conta com este e-mail');
    const token = assinar(id);
    return ok(res, { ok: true, token, usuario: { id, nome, email } }, 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao criar conta: ' + e.message);
  }
}

async function login({ body, res }) {
  const email = String((body || {}).email || '').trim().toLowerCase();
  const senha = senhaDoCorpo(body);
  if (!email || !senha) return falhar(res, 400, 'E-mail e senha são obrigatórios');

  try {
    const r = await db.queryPublica('SELECT * FROM credplus_login_lookup($1)', [email]);
    if (!r.rows.length) {
      await senhas.criarHash('senha-de-tempo-constante-000');
      return falhar(res, 401, 'Credenciais inválidas');
    }
    const { id, password_hash, nome } = r.rows[0];
    const confere = await senhas.conferir(senha, password_hash);
    if (!confere) return falhar(res, 401, 'Credenciais inválidas');
    const token = assinar(id);
    return ok(res, { ok: true, token, usuario: { id, nome: nome || null, email } });
  } catch (e) {
    return falhar(res, 500, 'Falha ao entrar: ' + e.message);
  }
}

async function me({ usuarioId, res }) {
  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query('SELECT id, email, nome, telefone, criado_em FROM usuarios WHERE id = $1', [usuarioId]));
    if (!r.rows.length) return falhar(res, 404, 'Usuário não encontrado');
    return ok(res, { usuario: r.rows[0] });
  } catch (e) {
    return falhar(res, 500, 'Falha ao consultar conta: ' + e.message);
  }
}

async function tratar(ctx) {
  const { method, seg, res } = ctx;
  if (method === 'POST' && seg.length === 1 && seg[0] === 'register') return registrar(ctx);
  if (method === 'POST' && seg.length === 1 && seg[0] === 'login') return login(ctx);
  if (method === 'GET' && seg.length === 1 && seg[0] === 'me') return me(ctx);
  // Sessão stateless (JWT sem blacklist): logout é só descartar o token no cliente.
  if (method === 'POST' && seg.length === 1 && seg[0] === 'logout') return ok(res, { ok: true });
  return null;
}

module.exports = { tratar };
