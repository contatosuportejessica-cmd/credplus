// GET /api/emprestimos/:id — DELETE /api/emprestimos/:id
const { criarHandler, primeiro } = require('../../lib/cp/adapter');
module.exports = criarHandler({
  recurso: 'emprestimos',
  params: ['id'],
  segDe: (req) => [String(primeiro(req.query && req.query.id))],
});
