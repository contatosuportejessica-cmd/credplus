// GET /api/pagamentos — POST /api/pagamentos
const { criarHandler } = require('../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'pagamentos', segDe: () => [] });
