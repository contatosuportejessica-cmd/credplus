// Dispatcher 6/7 — acompanhamento: /api/metas*, /api/notas*
// Rewrites (vercel.json): cada prefixo + /:r* -> este arquivo (__g = prefixo).
const { criarDispatcher } = require('../lib/cp/adapter');
module.exports = criarDispatcher({
  metas: { recurso: 'metas' },
  notas: { recurso: 'notas' },
});
