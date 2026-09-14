// ═══════════════════════════════════════════════════════════════════════
// CredPlus — sessão via JWT (mesmo padrão do server.js do ZHEUS: issuer,
// audience e expiração real de verdade — iat em SEGUNDOS, deixado a cargo
// da própria lib, para não repetir o bug do "token que nunca vence").
// ═══════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  // Era `process.exit(1)` — correto num processo PM2 de vida longa (falha
  // rápido no boot), mas destrutivo numa função serverless: `require()`
  // deste módulo acontece a cada invocação (ou reaproveitando um container
  // já quente), e matar o PROCESSO em vez de recusar só ESTA invocação
  // podia derrubar outras requisições em andamento no mesmo container.
  // `throw` continua bloqueando 100% do uso sem segredo forte — só de um
  // jeito que a Vercel trata como falha normal da função (500), não como
  // processo caído.
  throw new Error('[FATAL] JWT_SECRET ausente ou curto demais (>=32 chars). Confira as variáveis de ambiente.');
}
const JWT_ISS = 'credplus';
const JWT_AUD = 'credplus-app';

function assinar(usuarioId) {
  return jwt.sign({ sub: String(usuarioId) }, JWT_SECRET, {
    expiresIn: '7d',
    issuer: JWT_ISS,
    audience: JWT_AUD,
    jwtid: crypto.randomBytes(12).toString('hex'),
  });
}

function verificar(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { issuer: JWT_ISS, audience: JWT_AUD });
  } catch {
    return null;
  }
}

// Middleware: exige `Authorization: Bearer <token>` válido; popula
// `req.usuarioId`. Isto é o único lugar que decide quem é o requisitante —
// toda rota de dado de usuário usa req.usuarioId, nunca um id vindo do body.
function exigirAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado' });
  const decoded = verificar(auth.slice(7));
  if (!decoded || !decoded.sub) return res.status(401).json({ error: 'Sessão inválida ou expirada' });
  req.usuarioId = parseInt(decoded.sub, 10);
  next();
}

module.exports = { assinar, verificar, exigirAuth };
