// PUT /api/usuario/perfil
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'usuario', segDe: () => ['perfil'] });
