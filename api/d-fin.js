// Dispatcher 4/7 — dinheiro: /api/pagamentos*, /api/financeiro/*
// Rewrites (vercel.json): cada prefixo + /:r* -> este arquivo (__g = prefixo).
const { criarDispatcher } = require('../lib/cp/adapter');
module.exports = criarDispatcher({
  pagamentos: { recurso: 'pagamentos' },
  financeiro: { recurso: 'financeiro' },
});
