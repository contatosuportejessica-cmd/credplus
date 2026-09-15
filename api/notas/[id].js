// PUT /api/notas/:id — DELETE /api/notas/:id
const { criarHandler, primeiro } = require('../../lib/cp/adapter');
module.exports = criarHandler({
  recurso: 'notas',
  params: ['id'],
  segDe: (req) => [String(primeiro(req.query && req.query.id))],
});
