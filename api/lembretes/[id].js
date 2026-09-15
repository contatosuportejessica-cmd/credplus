// PUT /api/lembretes/:id — DELETE /api/lembretes/:id
const { criarHandler, primeiro } = require('../../lib/cp/adapter');
module.exports = criarHandler({
  recurso: 'lembretes',
  params: ['id'],
  segDe: (req) => [String(primeiro(req.query && req.query.id))],
});
