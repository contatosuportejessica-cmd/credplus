// GET /api/simulacoes — POST /api/simulacoes
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'simulacoes', segDe: () => [] });
