// GET /api/clientes — POST /api/clientes
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'clientes', segDe: () => [] });
