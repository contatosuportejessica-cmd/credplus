// ═══════════════════════════════════════════════════════════════════════
// CredPlus — entrada VPS/PM2 do backend (mantida por enquanto, junto com a
// entrada serverless da Vercel em api/[...path].js — ver backend/src/app.js,
// que agora concentra a construção do app Express; este arquivo só decide
// COMO expô-lo aqui: processo próprio, porta fixa, só em 127.0.0.1).
//
// Continua útil para rodar numa VPS/PM2 se um dia for preciso; na Vercel
// quem responde é api/[...path].js, que importa o mesmo backend/src/app.js
// sem chamar app.listen() nenhum.
// ═══════════════════════════════════════════════════════════════════════
require('dotenv').config();
const app = require('./app');
const db = require('./db');

const PORT = process.env.PORT || 4300;
const HOST = '127.0.0.1'; // nunca 0.0.0.0 — este processo não é público

app.listen(PORT, HOST, () => {
  console.log(`[credplus] backend em http://${HOST}:${PORT} (pid ${process.pid})`);
});

process.on('SIGTERM', async () => { await db.pool.end().catch(() => {}); process.exit(0); });
