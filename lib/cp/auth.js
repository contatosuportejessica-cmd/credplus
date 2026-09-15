// CredPlus — sessão via JWT (mesmas regras do backend antigo:
// issuer, audience e expiração real de 7 dias).
//
// O segredo é lido de process.env DENTRO das funções (nunca no require):
// numa função serverless, falhar no carregamento do módulo derrubaria
// todas as rotas; aqui a falta de JWT_SECRET vira 500 só na invocação.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_ISS = 'credplus';
const JWT_AUD = 'credplus-app';

function segredo() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET ausente ou curto demais (>=32 chars).');
  return s;
}

function assinar(usuarioId) {
  return jwt.sign({ sub: String(usuarioId) }, segredo(), {
    expiresIn: '7d',
    issuer: JWT_ISS,
    audience: JWT_AUD,
    jwtid: crypto.randomBytes(12).toString('hex'),
  });
}

function verificar(token) {
  try {
    return jwt.verify(token, segredo(), { issuer: JWT_ISS, audience: JWT_AUD });
  } catch {
    return null;
  }
}

// Extrai o usuarioId do header Authorization. Retorna null se ausente/inválido.
function usuarioDoHeader(req) {
  const auth = req.headers && req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const decoded = verificar(auth.slice(7));
  if (!decoded || !decoded.sub) return null;
  const id = parseInt(decoded.sub, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { assinar, verificar, usuarioDoHeader };
