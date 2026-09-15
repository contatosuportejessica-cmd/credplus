// Dispatcher 1/7 — conta e acesso: /api/auth/*
// Rewrites (vercel.json): /api/auth + /api/auth/:r* -> este arquivo.
const { criarDispatcher } = require('../lib/cp/adapter');
module.exports = criarDispatcher({
  auth: { recurso: 'auth', publicos: ['login', 'register', 'logout'] },
});
