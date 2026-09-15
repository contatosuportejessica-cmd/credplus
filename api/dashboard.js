// GET /api/dashboard
const { criarHandler } = require('../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'dashboard', segDe: () => [] });
