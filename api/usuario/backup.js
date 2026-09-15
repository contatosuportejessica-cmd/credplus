// GET /api/usuario/backup
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'usuario', segDe: () => ['backup'] });
