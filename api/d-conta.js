// Dispatcher 7/7 — conta: /api/usuario/*
// Rewrites (vercel.json): /api/usuario + /api/usuario/:r* -> este arquivo.
const { criarDispatcher } = require('../lib/cp/adapter');
module.exports = criarDispatcher({
  usuario: { recurso: 'usuario' },
});
