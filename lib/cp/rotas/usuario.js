// CredPlus serverless — conta do usuário: perfil, troca de senha e backup.
//
// PUT /usuario/perfil devolve o usuário atualizado "flat" (o frontend faz
// merge direto em usuarioAtual). GET /usuario/backup exporta todos os dados
// do usuário (sem senhas/hashes/segredos).
const db = require('../db');
const senhas = require('../senhas');
const { ok, falhar } = require('../http');
const { TAMANHO_MINIMO, normalizarResposta } = senhas;
const { PERGUNTAS_VALIDAS, RESPOSTA_MINIMA } = require('./auth');

const FOTO_MAX_BYTES = 200 * 1024;

function fotoValida(v) {
  return typeof v === 'string'
    && v.length <= FOTO_MAX_BYTES
    && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
}

async function perfil({ body, usuarioId, res }) {
  const nome = String((body || {}).nome || '').trim();
  const telefoneRaw = (body || {}).telefone;
  const telefone = telefoneRaw != null ? String(telefoneRaw).trim().slice(0, 30) || null : null;
  const temFoto = Object.prototype.hasOwnProperty.call(body || {}, 'foto');
  const foto = temFoto ? String(body.foto ?? '') : null;

  if (!nome || nome.length < 2) return falhar(res, 400, 'Nome é obrigatório (mínimo 2 caracteres).');
  if (nome.length > 200) return falhar(res, 400, 'Nome muito longo.');
  if (temFoto && foto && !fotoValida(foto)) {
    return falhar(res, 400, 'Foto inválida. Use uma imagem JPEG/PNG pequena.');
  }

  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query(
        `UPDATE usuarios SET nome = $1, telefone = $2, foto = COALESCE($4, foto), atualizado_em = now() WHERE id = $3
         RETURNING id, email, nome, telefone, pergunta_recuperacao, foto, criado_em`,
        [nome, telefone, usuarioId, temFoto ? foto || null : null]));
    if (!r.rows.length) return falhar(res, 404, 'Usuário não encontrado.');
    return ok(res, r.rows[0]);
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar perfil.');
  }
}

async function trocarSenha({ body, usuarioId, res }) {
  const atual = String((body || {}).senha_atual || '');
  const nova = String((body || {}).senha_nova || '');

  if (!atual) return falhar(res, 400, 'Informe a senha atual.');
  if (nova.length < TAMANHO_MINIMO) {
    return falhar(res, 400, `A nova senha deve ter ao menos ${TAMANHO_MINIMO} caracteres.`);
  }

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const r = await c.query('SELECT password_hash FROM usuarios WHERE id = $1', [usuarioId]);
      if (!r.rows.length) return { erro: 404, mensagem: 'Usuário não encontrado.' };
      const confere = await senhas.conferir(atual, r.rows[0].password_hash);
      if (!confere) return { erro: 401, mensagem: 'A senha atual está incorreta.' };
      const hash = await senhas.criarHash(nova);
      await c.query('UPDATE usuarios SET password_hash = $1, atualizado_em = now() WHERE id = $2', [hash, usuarioId]);
      return { ok: true };
    });
    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao alterar senha.');
  }
}

async function backup({ usuarioId, res }) {
  try {
    const dados = await db.withUser(usuarioId, async (c) => {
      const usuario = (await c.query(
        'SELECT id, email, nome, telefone, pergunta_recuperacao, foto, criado_em FROM usuarios WHERE id = $1', [usuarioId])).rows[0];
      const clientes = (await c.query('SELECT * FROM clientes ORDER BY criado_em DESC')).rows;
      const emprestimos = (await c.query('SELECT * FROM emprestimos ORDER BY criado_em DESC')).rows;
      const parcelas = (await c.query('SELECT * FROM parcelas ORDER BY emprestimo_id, numero ASC')).rows;
      const pagamentos = (await c.query('SELECT * FROM pagamentos ORDER BY criado_em DESC')).rows;
      const movimentacoes = (await c.query('SELECT * FROM movimentacoes_financeiras ORDER BY data DESC, criado_em DESC')).rows;
      const lembretes = (await c.query('SELECT * FROM lembretes ORDER BY criado_em DESC')).rows;
      const metas = (await c.query('SELECT * FROM metas ORDER BY criado_em DESC')).rows;
      const notas = (await c.query('SELECT * FROM notas ORDER BY criado_em DESC')).rows;
      const simulacoes = (await c.query('SELECT * FROM simulacoes ORDER BY criado_em DESC')).rows;
      const simulacaoParcelas = (await c.query(
        'SELECT * FROM simulacao_parcelas ORDER BY simulacao_id, numero ASC')).rows;
      return {
        exportadoEm: new Date().toISOString(),
        usuario, clientes, emprestimos, parcelas, pagamentos,
        movimentacoes, lembretes, metas, notas, simulacoes, simulacaoParcelas,
      };
    });
    return ok(res, dados);
  } catch (e) {
    return falhar(res, 500, 'Falha ao exportar dados.');
  }
}

// PUT /usuario/recuperacao — troca a pergunta secreta + NOVA resposta.
// Exige a senha atual (prova de posse da sessão não basta para este dado
// sensível) e nunca devolve a resposta, nem a atual nem a nova.
async function trocarRecuperacao({ body, usuarioId, res }) {
  const senhaAtual = String((body || {}).senha_atual || '');
  const pergunta = String((body || {}).pergunta || '').trim();
  const resposta = normalizarResposta((body || {}).resposta);

  if (!senhaAtual) return falhar(res, 400, 'Informe sua senha atual para confirmar.');
  if (!PERGUNTAS_VALIDAS.includes(pergunta)) return falhar(res, 400, 'Escolha uma pergunta de recuperação válida.');
  if (resposta.length < RESPOSTA_MINIMA) return falhar(res, 400, `A resposta secreta precisa ter ao menos ${RESPOSTA_MINIMA} caracteres.`);

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const r = await c.query('SELECT password_hash FROM usuarios WHERE id = $1', [usuarioId]);
      if (!r.rows.length) return { erro: 404, mensagem: 'Usuário não encontrado.' };
      const confere = await senhas.conferir(senhaAtual, r.rows[0].password_hash);
      if (!confere) return { erro: 401, mensagem: 'A senha atual está incorreta.' };
      const hashResposta = await senhas.criarHash(resposta, RESPOSTA_MINIMA);
      const rUpd = await c.query(
        `UPDATE usuarios SET pergunta_recuperacao = $1, resposta_hash = $2, atualizado_em = now() WHERE id = $3
         RETURNING id, email, nome, telefone, pergunta_recuperacao, foto, criado_em`,
        [pergunta, hashResposta, usuarioId]);
      return { usuario: rUpd.rows[0] };
    });
    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, resultado.usuario);
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar pergunta de recuperação.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (method === 'PUT' && seg.length === 1 && seg[0] === 'perfil') return perfil(ctx);
  if (method === 'PUT' && seg.length === 1 && seg[0] === 'senha') return trocarSenha(ctx);
  if (method === 'PUT' && seg.length === 1 && seg[0] === 'recuperacao') return trocarRecuperacao(ctx);
  if (method === 'GET' && seg.length === 1 && seg[0] === 'backup') return backup(ctx);
  return null;
}

module.exports = { tratar };
