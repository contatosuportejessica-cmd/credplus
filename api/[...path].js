// ═══════════════════════════════════════════════════════════════════════
// CredPlus — entrada serverless da Vercel para toda a API.
//
// Catch-all: qualquer requisição em /api/* (ex.: /api/auth/register,
// /api/clientes) cai aqui. Não usa app.listen(), PM2, porta fixa nem o
// proxy antigo da VPS (/site/credplus/api) — cada requisição é uma
// invocação própria desta função; quem decide a rota é o próprio Express
// app (backend/src/app.js), a mesma lógica de sempre, reaproveitada sem
// reescrever nada.
// ═══════════════════════════════════════════════════════════════════════
module.exports = require('../backend/src/app');
