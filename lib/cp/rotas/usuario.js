// CredPlus serverless — conta do usuário: perfil, troca de senha e backup.
//
// PUT /usuario/perfil devolve o usuário atualizado "flat" (o frontend faz
// merge direto em usuarioAtual). GET /usuario/backup exporta todos os dados
// do usuário (sem senhas/hashes/segredos).
const db = require('../db');
const senhas = require('../senhas');
const { ok, falhar } = require('../http');
const { TAMANHO_MINIMO } = senhas;

async function perfil({ body, usuarioId, res }) {
  const nome = String((body || {}).nome || '').trim();
  const telefoneRaw = (body || {}).telefone;
  const telefone = telefoneRaw != null ? String(telefoneRaw).trim().slice(0, 30) || null : null;

  if (!nome || nome.length < 2) return falhar(res, 400, 'Nome é obrigatório (mínimo 2 caracteres).');
  if (nome.length > 200) return falhar(res, 400, 'Nome muito longo.');

  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query(
        `UPDATE usuarios SET nome = $1, telefone = $2, atualizado_em = now() WHERE id = $3
         RETURNING id, email, nome, telefone, criado_em`,
        [nome, telefone, usuarioId]));
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
        'SELECT id, email, nome, telefone, criado_em FROM usuarios WHERE id = $1', [usuarioId])).rows[0];
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

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (method === 'PUT' && seg.length === 1 && seg[0] === 'perfil') return perfil(ctx);
  if (method === 'PUT' && seg.length === 1 && seg[0] === 'senha') return trocarSenha(ctx);
  if (method === 'GET' && seg.length === 1 && seg[0] === 'backup') return backup(ctx);
  return null;
}

module.exports = { tratar };
