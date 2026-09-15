// CredPlus serverless — Auth (registro, login, me, logout, recuperação).
// Mesmas regras do backend antigo: funções SECURITY DEFINER para
// registro/login, hash scrypt, JWT 7d, resposta nunca inclui hash.
// Recuperação por pergunta secreta (migration 015): a resposta nunca sai
// do banco em texto (só o hash), e a redefinição troca SÓ a senha da
// conta dona do e-mail confirmado.
const db = require('../db');
const senhas = require('../senhas');
const { assinar } = require('../auth');
const { ok, falhar, emailValido } = require('../http');
const { TAMANHO_MINIMO, normalizarResposta } = senhas;

const PERGUNTAS_VALIDAS = [
  'Em qual cidade você nasceu?',
  'Qual era o nome do seu primeiro animal de estimação?',
  'Qual é sua comida favorita?',
  'Qual país você gostaria de conhecer?',
  'Qual é o segundo nome da sua mãe?',
  'Qual é o segundo nome do seu pai?',
  'Qual era seu apelido de infância?',
  'Qual era o nome do seu primeiro professor ou professora?',
  'Qual é seu filme favorito?',
  'Qual o primeiro nome de uma pessoa importante da sua infância?',
];

const RESPOSTA_MINIMA = 3;

// Limite simples anti-força-bruta nas rotas públicas de recuperação
// (por e-mail, em memória do container): 10 falhas em 15 minutos.
const JANELA_MS = 15 * 60 * 1000;
const MAX_FALHAS = 10;
const tentativas = new Map();

function throttleEmail(email) {
  const agora = Date.now();
  if (tentativas.size > 5000) {
    for (const [k, v] of tentativas) {
      if (agora - v.inicio > JANELA_MS) tentativas.delete(k);
      if (tentativas.size <= 4000) break;
    }
  }
  const reg = tentativas.get(email);
  if (reg && agora - reg.inicio < JANELA_MS && reg.falhas >= MAX_FALHAS) return false;
  return true;
}

function registrarFalha(email) {
  const agora = Date.now();
  const reg = tentativas.get(email);
  if (!reg || agora - reg.inicio >= JANELA_MS) tentativas.set(email, { falhas: 1, inicio: agora });
  else reg.falhas += 1;
}

function limparThrottle(email) {
  tentativas.delete(email);
}

function senhaDoCorpo(corpo) {
  return String((corpo && (corpo.senha ?? corpo.password)) ?? '');
}

async function registrar({ body, res }) {
  const nome = String((body || {}).nome || '').trim();
  const email = String((body || {}).email || '').trim().toLowerCase();
  const senha = senhaDoCorpo(body);
  const pergunta = String((body || {}).pergunta || '').trim();
  const resposta = normalizarResposta((body || {}).resposta);

  if (!nome || nome.length < 2) return falhar(res, 400, 'Nome é obrigatório (mínimo 2 caracteres)');
  if (nome.length > 200) return falhar(res, 400, 'Nome muito longo');
  if (!emailValido(email)) return falhar(res, 400, 'E-mail inválido');
  if (senha.length < TAMANHO_MINIMO) return falhar(res, 400, `Senha precisa ter ao menos ${TAMANHO_MINIMO} caracteres`);
  if (!PERGUNTAS_VALIDAS.includes(pergunta)) return falhar(res, 400, 'Escolha uma pergunta de recuperação válida.');
  if (resposta.length < RESPOSTA_MINIMA) return falhar(res, 400, `A resposta secreta precisa ter ao menos ${RESPOSTA_MINIMA} caracteres.`);

  try {
    const hash = await senhas.criarHash(senha);
    const hashResposta = await senhas.criarHash(resposta, RESPOSTA_MINIMA);
    const r = await db.queryPublica('SELECT credplus_registrar_usuario($1, $2, $3, $4, $5) AS id', [email, hash, nome, pergunta, hashResposta]);
    const id = r.rows[0].id;
    if (id === null) return falhar(res, 409, 'Já existe uma conta com este e-mail');
    const token = assinar(id);
    return ok(res, { ok: true, token, usuario: { id, nome, email, pergunta_recuperacao: pergunta, foto: null } }, 201);
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
    const { id, password_hash, nome, pergunta_recuperacao, foto } = r.rows[0];
    const confere = await senhas.conferir(senha, password_hash);
    if (!confere) return falhar(res, 401, 'Credenciais inválidas');
    const token = assinar(id);
    // Contas antigas (sem pergunta) devolvem null aqui e continuam
    // entrando normalmente — a pergunta é cadastrada depois em Segurança.
    return ok(res, { ok: true, token, usuario: { id, nome: nome || null, email, pergunta_recuperacao: pergunta_recuperacao || null, foto: foto || null } });
  } catch (e) {
    return falhar(res, 500, 'Falha ao entrar: ' + e.message);
  }
}

async function me({ usuarioId, res }) {
  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query('SELECT id, email, nome, telefone, pergunta_recuperacao, foto, criado_em FROM usuarios WHERE id = $1', [usuarioId]));
    if (!r.rows.length) return falhar(res, 404, 'Usuário não encontrado');
    return ok(res, { usuario: r.rows[0] });
  } catch (e) {
    return falhar(res, 500, 'Falha ao consultar conta: ' + e.message);
  }
}

// Etapa 2 da recuperação: devolve SÓ a pergunta da conta (nunca a resposta
// nem hash). 404 para e-mail desconhecido ou conta sem pergunta cadastrada.
async function perguntaRecuperacao({ body, res }) {
  const email = String((body || {}).email || '').trim().toLowerCase();
  if (!emailValido(email)) return falhar(res, 400, 'Informe um e-mail válido.');
  if (!throttleEmail(email)) return falhar(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');

  try {
    const r = await db.queryPublica('SELECT * FROM credplus_recuperacao_lookup($1)', [email]);
    if (!r.rows.length || !r.rows[0].pergunta || !r.rows[0].resposta_hash) {
      registrarFalha(email);
      return falhar(res, 404, 'Não encontramos uma conta com recuperação cadastrada para este e-mail.');
    }
    return ok(res, { pergunta: r.rows[0].pergunta });
  } catch (e) {
    return falhar(res, 500, 'Falha ao consultar recuperação: ' + e.message);
  }
}

// Etapa 3: confere a resposta (normalizada, contra o hash) e redefine SÓ
// a senha da conta dona do e-mail. Resposta errada genérica, sem vazar
// se o e-mail existe ou não além do já revelado na etapa 2.
async function redefinirSenha({ body, res }) {
  const email = String((body || {}).email || '').trim().toLowerCase();
  const resposta = normalizarResposta((body || {}).resposta);
  const senhaNova = String((body || {}).senha_nova ?? '');

  if (!emailValido(email)) return falhar(res, 400, 'Informe um e-mail válido.');
  if (!resposta) return falhar(res, 400, 'Informe a resposta secreta.');
  if (senhaNova.length < TAMANHO_MINIMO) return falhar(res, 400, `A nova senha deve ter ao menos ${TAMANHO_MINIMO} caracteres.`);
  if (!throttleEmail(email)) return falhar(res, 429, 'Muitas tentativas. Aguarde alguns minutos.');

  try {
    const r = await db.queryPublica('SELECT * FROM credplus_recuperacao_lookup($1)', [email]);
    if (!r.rows.length || !r.rows[0].resposta_hash) {
      registrarFalha(email);
      return falhar(res, 401, 'Resposta incorreta.');
    }
    const confere = await senhas.conferir(resposta, r.rows[0].resposta_hash);
    if (!confere) {
      registrarFalha(email);
      return falhar(res, 401, 'Resposta incorreta.');
    }
    const hashNova = await senhas.criarHash(senhaNova);
    await db.queryPublica('SELECT credplus_redefinir_senha($1, $2)', [r.rows[0].id, hashNova]);
    limparThrottle(email);
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao redefinir senha: ' + e.message);
  }
}

async function tratar(ctx) {
  const { method, seg, res } = ctx;
  if (method === 'POST' && seg.length === 1 && seg[0] === 'register') return registrar(ctx);
  if (method === 'POST' && seg.length === 1 && seg[0] === 'login') return login(ctx);
  if (method === 'GET' && seg.length === 1 && seg[0] === 'me') return me(ctx);
  if (method === 'POST' && seg.length === 2 && seg[0] === 'recuperar' && seg[1] === 'pergunta') return perguntaRecuperacao(ctx);
  if (method === 'POST' && seg.length === 2 && seg[0] === 'recuperar' && seg[1] === 'redefinir') return redefinirSenha(ctx);
  // Sessão stateless (JWT sem blacklist): logout é só descartar o token no cliente.
  if (method === 'POST' && seg.length === 1 && seg[0] === 'logout') return ok(res, { ok: true });
  return null;
}

module.exports = { tratar, PERGUNTAS_VALIDAS, RESPOSTA_MINIMA, normalizarResposta };
