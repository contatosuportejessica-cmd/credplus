// ═══════════════════════════════════════════════════════════════════════
// CredPlus — backend dedicado (primeiro app full-stack sobre a
// infraestrutura reutilizável do ZHEUS: banco próprio, role própria,
// processo PM2 próprio, pasta de dados própria — nada compartilhado com o
// ZHEUS nem com futuros apps).
//
// Só escuta em 127.0.0.1: nunca é alcançado direto da internet. Quem chega
// nele é sempre o server.js do ZHEUS, via proxy em /site/credplus/api/*.
// ═══════════════════════════════════════════════════════════════════════
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const db = require('./db');

const PORT = process.env.PORT || 4300;
const HOST = '127.0.0.1'; // nunca 0.0.0.0 — este processo não é público

const app = express();
app.set('trust proxy', 1); // atrás do server.js do ZHEUS, que já filtra o IP real
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_req, res) => {
  const banco = await db.saude();
  res.status(banco.ok ? 200 : 503).json({ ok: banco.ok, banco });
});

app.use('/api/auth', require('./rotas/auth'));
app.use('/api/clientes', require('./rotas/clientes'));
app.use('/api/emprestimos', require('./rotas/emprestimos'));
app.use('/api/simulacoes', require('./rotas/simulacoes'));
app.use('/api/parcelas', require('./rotas/parcelas'));
app.use('/api/pagamentos', require('./rotas/pagamentos'));
app.use('/api/financeiro', require('./rotas/financeiro'));
app.use('/api/cobrancas', require('./rotas/cobrancas'));
app.use('/api/lembretes', require('./rotas/lembretes'));
app.use('/api/metas', require('./rotas/metas'));
app.use('/api/notas', require('./rotas/notas'));
app.use('/api/dashboard', require('./rotas/dashboard'));
app.use('/api/busca', require('./rotas/busca'));
app.use('/api/registros', require('./rotas/registros'));
app.use('/api/uploads', require('./rotas/uploads'));

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[credplus] erro não tratado:', err.stack || err);
  res.status(500).json({ error: 'Erro interno' });
});

app.listen(PORT, HOST, () => {
  console.log(`[credplus] backend em http://${HOST}:${PORT} (pid ${process.pid})`);
});

process.on('SIGTERM', async () => { await db.pool.end().catch(() => {}); process.exit(0); });
