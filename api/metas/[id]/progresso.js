// GET /api/metas/:id/progresso
const { criarHandler, primeiro } = require('../../../lib/cp/adapter');
module.exports = criarHandler({
  recurso: 'metas',
  params: ['id'],
  segDe: (req) => [String(primeiro(req.query && req.query.id)), 'progresso'],
});
