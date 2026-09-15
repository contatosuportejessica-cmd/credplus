// GET /api/simulacoes/:id — PUT /api/simulacoes/:id — DELETE /api/simulacoes/:id
const { criarHandler, primeiro } = require('../../lib/cp/adapter');
module.exports = criarHandler({
  recurso: 'simulacoes',
  params: ['id'],
  segDe: (req) => [String(primeiro(req.query && req.query.id))],
});
