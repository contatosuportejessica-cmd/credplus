// GET /api/financeiro/movimentacoes — POST /api/financeiro/movimentacoes
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'financeiro', segDe: () => ['movimentacoes'] });
