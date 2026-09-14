// ═══════════════════════════════════════════════════════════════════════
// CredPlus — construção do app Express (extraído de server.js).
//
// Este módulo só MONTA o app — nunca escuta porta, nunca chama
// app.listen(). É o que permite o MESMO app ser exposto de duas formas:
//   • VPS/PM2 (server.js, mantido por enquanto): app.listen() num processo
//     contínuo, escutando só em 127.0.0.1.
//   • Vercel Serverless (api/[...path].js, na raiz do projeto): cada
//     invocação chama este app diretamente como handler (req,res) — Express
//     app é, por si só, uma função nesse formato — sem processo próprio,
//     sem porta, sem PM2.
// Toda a lógica de rotas/negócio em ./rotas continua exatamente a mesma;
// só a camada de EXPOSIÇÃO mudou de lugar.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const helmet = require('helmet');
const db = require('./db');

const app = express();
app.set('trust proxy', 1); // atrás de um proxy (VPS) ou da borda da Vercel — IP real já vem filtrado
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

module.exports = app;
