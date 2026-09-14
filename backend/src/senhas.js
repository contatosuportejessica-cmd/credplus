// ═══════════════════════════════════════════════════════════════════════
// CredPlus — hash de senha (mesmo padrão do senhas.js do ZHEUS: scrypt,
// memory-hard, sal aleatório por senha, parâmetros de custo guardados
// dentro do próprio hash, comparação em tempo constante).
// ═══════════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const CUSTO = { N: 32768, r: 8, p: 1, keylen: 32 };
const MAXMEM = 96 * 1024 * 1024;
const PREFIXO = 'scrypt$';

function derivar(senha, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      String(senha), salt, params.keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM },
      (err, chave) => (err ? reject(err) : resolve(chave)),
    );
  });
}

async function criarHash(senha) {
  if (typeof senha !== 'string' || senha.length < 8) throw new Error('Senha precisa ter ao menos 8 caracteres');
  const salt = crypto.randomBytes(16);
  const chave = await derivar(senha, salt, CUSTO);
  return [PREFIXO + CUSTO.N, CUSTO.r, CUSTO.p, salt.toString('base64'), chave.toString('base64')].join('$');
}

async function conferir(senha, guardado) {
  if (typeof guardado !== 'string' || !guardado.startsWith(PREFIXO) || typeof senha !== 'string') return false;
  const partes = guardado.split('$');
  if (partes.length !== 6) return false;
  const params = {
    N: parseInt(partes[1], 10), r: parseInt(partes[2], 10),
    p: parseInt(partes[3], 10), keylen: Buffer.from(partes[5], 'base64').length,
  };
  if (!(params.N > 1) || !(params.r > 0) || !(params.p > 0) || !(params.keylen > 0)) return false;
  try {
    const chave = await derivar(senha, Buffer.from(partes[4], 'base64'), params);
    const guardada = Buffer.from(partes[5], 'base64');
    if (chave.length !== guardada.length) return false;
    return crypto.timingSafeEqual(chave, guardada);
  } catch {
    return false;
  }
}

module.exports = { criarHash, conferir };
