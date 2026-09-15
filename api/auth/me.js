// GET /api/auth/me
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'auth', segDe: () => ['me'] });
