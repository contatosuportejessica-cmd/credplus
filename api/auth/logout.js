// POST /api/auth/logout (pública, stateless)
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'auth', publico: true, segDe: () => ['logout'] });
