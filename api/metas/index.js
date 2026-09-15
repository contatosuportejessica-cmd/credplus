// GET /api/metas — POST /api/metas
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'metas', segDe: () => [] });
