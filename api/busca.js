// GET /api/busca
const { criarHandler } = require('../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'busca', segDe: () => [] });
