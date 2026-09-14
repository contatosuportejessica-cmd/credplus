// ═══════════════════════════════════════════════════════════════════════
// CredPlus — cadastro, login e "quem sou eu".
//
// Cadastro e login usam funções SECURITY DEFINER do Postgres
// (credplus_registrar_usuario / credplus_login_lookup — ver migrations),
// não uma sessão "admin" que ignore RLS: a exceção fica só nessas duas
// operações, exatamente pelo que elas são — não existe "usuario_id" antes
// de existir a conta, então a policy normal de RLS não tem como decidir.
//
// Contrato real do produto (payload em português): { nome, email, senha }.
// `password` continua aceito por compatibilidade temporária, mas as duas
// chaves são normalizadas numa única variável antes de qualquer uso —
// nunca há duas fontes de verdade para a mesma senha dentro da rota.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const senhas = require('../senhas');
const { assinar, exigirAuth } = require('../auth');

const router = express.Router();

const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Muitas tentativas. Espere alguns minutos.' },
});

function emailValido(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 200;
}

// Uma só variável de senha, venha ela de `senha` (contrato real) ou de
// `password` (compatibilidade). `??` só cai para o segundo campo quando o
// primeiro é null/undefined — um `senha: ""` explícito não é ignorado.
function senhaDoCorpo(corpo) {
  return String((corpo && (corpo.senha ?? corpo.password)) ?? '');
}

router.post('/register', limiteAuth, async (req, res) => {
  const nome = String((req.body || {}).nome || '').trim();
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const senha = senhaDoCorpo(req.body);

  if (!nome || nome.length < 2) return res.status(400).json({ error: 'Nome é obrigatório (mínimo 2 caracteres)' });
  if (nome.length > 200) return res.status(400).json({ error: 'Nome muito longo' });
  if (!emailValido(email)) return res.status(400).json({ error: 'E-mail inválido' });
  if (senha.length < 8) return res.status(400).json({ error: 'Senha precisa ter ao menos 8 caracteres' });

  try {
    const hash = await senhas.criarHash(senha);
    const r = await db.query('SELECT credplus_registrar_usuario($1, $2, $3) AS id', [email, hash, nome]);
    const id = r.rows[0].id;
    if (id === null) return res.status(409).json({ error: 'Já existe uma conta com este e-mail' });
    const token = assinar(id);
    // Resposta nunca inclui hash de senha, segredo JWT ou credencial de banco.
    res.status(201).json({ ok: true, token, usuario: { id, nome, email } });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao criar conta: ' + err.message });
  }
});

router.post('/login', limiteAuth, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const senha = senhaDoCorpo(req.body);
  if (!email || !senha) return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });

  try {
    const r = await db.query('SELECT * FROM credplus_login_lookup($1)', [email]);
    if (!r.rows.length) { await senhas.criarHash('senha-de-tempo-constante-000'); return res.status(401).json({ error: 'Credenciais inválidas' }); }
    const { id, password_hash, nome } = r.rows[0];
    const ok = await senhas.conferir(senha, password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
    const token = assinar(id);
    res.json({ ok: true, token, usuario: { id, nome: nome || null, email } });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao entrar: ' + err.message });
  }
});

router.get('/me', exigirAuth, async (req, res) => {
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query('SELECT id, email, nome, criado_em FROM usuarios WHERE id = $1', [req.usuarioId]));
    if (!r.rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ usuario: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao consultar conta: ' + err.message });
  }
});

module.exports = router;
