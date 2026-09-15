// GET /api/lembretes — POST /api/lembretes
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'lembretes', segDe: () => [] });
