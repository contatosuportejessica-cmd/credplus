// Dispatcher 2/7 — cadastros: /api/clientes*
// Rewrites (vercel.json): /api/clientes + /api/clientes/:r* -> este arquivo.
const { criarDispatcher } = require('../lib/cp/adapter');
module.exports = criarDispatcher({
  clientes: { recurso: 'clientes' },
});
