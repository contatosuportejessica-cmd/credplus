// PUT /api/usuario/senha
const { criarHandler } = require('../../lib/cp/adapter');
module.exports = criarHandler({ recurso: 'usuario', segDe: () => ['senha'] });
