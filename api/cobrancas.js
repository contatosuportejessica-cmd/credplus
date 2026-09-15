// GET /api/cobrancas
const { criarHandler } = require('../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'cobrancas', segDe: () => [] });
