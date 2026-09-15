// Dispatcher 5/7 — rotina: /api/cobrancas, /api/dashboard, /api/busca, /api/lembretes*
// Rewrites (vercel.json): cada prefixo + /:r* -> este arquivo (__g = prefixo).
const { criarDispatcher } = require('../lib/cp/adapter');
module.exports = criarDispatcher({
  cobrancas: { recurso: 'cobrancas' },
  dashboard: { recurso: 'dashboard' },
  busca: { recurso: 'busca' },
  lembretes: { recurso: 'lembretes' },
});
