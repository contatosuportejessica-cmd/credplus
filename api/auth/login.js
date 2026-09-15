// POST /api/auth/login (pública)
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'auth', publico: true, segDe: () => ['login'] });
