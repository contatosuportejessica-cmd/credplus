// GET /api/emprestimos — POST /api/emprestimos
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'emprestimos', segDe: () => [] });
