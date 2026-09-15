// Dispatcher 3/7 — operações: /api/emprestimos*, /api/parcelas/*, /api/simulacoes*
// Rewrites (vercel.json): cada prefixo + /:r* -> este arquivo (__g = prefixo).
const { criarDispatcher } = require('../lib/cp/adapter');
module.exports = criarDispatcher({
  emprestimos: { recurso: 'emprestimos' },
  parcelas: { recurso: 'parcelas' },
  simulacoes: { recurso: 'simulacoes' },
});
