// GET /api/notas — POST /api/notas
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'notas', segDe: () => [] });
