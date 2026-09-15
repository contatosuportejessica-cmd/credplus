// GET /api/clientes/:id — PUT /api/clientes/:id — DELETE /api/clientes/:id
const { criarHandler, primeiro } = require('../../lib/cp/adapter');
module.exports = criarHandler({
  recurso: 'clientes',
  params: ['id'],
  segDe: (req) => [String(primeiro(req.query && req.query.id))],
});
