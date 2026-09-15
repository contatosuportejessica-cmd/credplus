// PUT /api/parcelas/:id
const { criarHandler, primeiro } = require('../../lib/cp/adapter');
module.exports = criarHandler({
  recurso: 'parcelas',
  params: ['id'],
  segDe: (req) => [String(primeiro(req.query && req.query.id))],
});
