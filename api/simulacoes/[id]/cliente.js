// PUT /api/simulacoes/:id/cliente
const { criarHandler, primeiro } = require('../../../lib/cp/adapter');
module.exports = criarHandler({
  recurso: 'simulacoes',
  params: ['id'],
  segDe: (req) => [String(primeiro(req.query && req.query.id)), 'cliente'],
});
