// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Clientes (Etapa 1 do produto real)
//
// Contrato definido pelo FRONTEND JÁ EXISTENTE (assets/js/app.js, loja de
// Clientes) — não inventado aqui. Campos, formatos e comportamento (busca,
// arquivar em vez de apagar) seguem exatamente o que o formulário e a loja
// já chamam.
//
// usuario_id NUNCA vem do corpo da requisição — sempre de req.usuarioId,
// que só existe depois do JWT verificado em exigirAuth. Isolamento real é
// garantido pela RLS do Postgres (ver migrations/003-criar-clientes.sql):
// mesmo que uma query aqui esquecesse o filtro, o banco não devolveria
// nem deixaria alterar linha de outro usuário.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

const CAMPOS_TEXTO = [
  ['nome', 200],
  ['telefone', 30],
  ['whatsapp', 30],
  ['email', 200],
  ['documento', 30],
  ['endereco', 300],
  ['complemento', 120],
  ['cidade', 120],
  ['estado', 2],
  ['cep', 15],
  ['localizacao', 500],
  ['observacoes', 4000],
];

const COLUNAS_RETORNO = [
  'id', 'nome', 'telefone', 'whatsapp', 'email', 'documento', 'endereco',
  'complemento', 'cidade', 'estado', 'cep', 'localizacao', 'observacoes',
  'foto', 'status', 'criado_em', 'atualizado_em', 'arquivado_em',
];

function emailValido(v) {
  return typeof v === 'string' && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Lê e valida os campos de texto do corpo. `parcial=true` (PUT) só inclui
// no resultado os campos realmente enviados, para permitir atualização
// parcial sem apagar os demais.
function lerCamposTexto(corpo, { parcial }) {
  const dados = {};
  const erros = [];
  for (const [campo, tamanhoMax] of CAMPOS_TEXTO) {
    const veio = Object.prototype.hasOwnProperty.call(corpo || {}, campo);
    if (!veio) {
      if (!parcial) dados[campo] = null;
      continue;
    }
    let valor = String(corpo[campo] ?? '').trim();
    if (campo === 'estado') valor = valor.toUpperCase();
    if (valor.length > tamanhoMax) { erros.push(`Campo "${campo}" excede o tamanho máximo (${tamanhoMax}).`); continue; }
    if (campo === 'email' && valor && !emailValido(valor)) { erros.push('E-mail inválido.'); continue; }
    dados[campo] = valor || null;
  }
  return { dados, erros };
}

function idValido(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) { res.status(404).json({ mensagem: 'Cliente não encontrado.' }); return null; }
  return id;
}

// GET /api/clientes?busca=&status=
router.get('/', async (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const status = String(req.query.status || 'todos').trim();
  try {
    const condicoes = [];
    const params = [];
    if (status === 'ativo' || status === 'arquivado') {
      params.push(status);
      condicoes.push(`status = $${params.length}`);
    } else {
      // "todos" (valor padrão hoje enviado pelo frontend): esconde
      // arquivados por padrão, no mesmo espírito do modo demo (arquivar
      // remove da listagem principal), sem apagar o histórico.
      condicoes.push(`status <> 'arquivado'`);
    }
    if (busca) {
      params.push(`%${busca}%`);
      condicoes.push(`nome ILIKE $${params.length}`);
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const sql = `SELECT ${COLUNAS_RETORNO.join(', ')} FROM clientes ${where} ORDER BY criado_em DESC, nome ASC`;
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(sql, params));
    // Campos agregados de operações (empréstimos/parcelas) ainda não
    // existem nesta etapa — refletem corretamente "zero" até a Etapa 2.
    const lista = r.rows.map((c) => ({ ...c, operacoes: 0, saldoPendente: 0, proximaCobranca: null }));
    res.json(lista);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar clientes.' });
    console.error('[clientes] erro ao listar:', err.message);
  }
});

// GET /api/clientes/:id
router.get('/:id', async (req, res) => {
  const id = idValido(req, res);
  if (id === null) return;
  try {
    const sql = `SELECT ${COLUNAS_RETORNO.join(', ')} FROM clientes WHERE id = $1`;
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(sql, [id]));
    if (!r.rows.length) return res.status(404).json({ mensagem: 'Cliente não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao buscar cliente.' });
    console.error('[clientes] erro ao buscar:', err.message);
  }
});

// POST /api/clientes
router.post('/', async (req, res) => {
  const { dados, erros } = lerCamposTexto(req.body, { parcial: false });
  if (!dados.nome || dados.nome.length < 2) erros.unshift('Nome é obrigatório (mínimo 2 caracteres).');
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  const colunas = CAMPOS_TEXTO.map(([c]) => c);
  const valores = colunas.map((c) => dados[c]);
  try {
    const sql = `INSERT INTO clientes (usuario_id, ${colunas.join(', ')}) VALUES ($1, ${colunas.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${COLUNAS_RETORNO.join(', ')}`;
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(sql, [req.usuarioId, ...valores]));
    const criado = { ...r.rows[0], operacoes: 0, saldoPendente: 0, proximaCobranca: null };
    res.status(201).json(criado);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao criar cliente.' });
    console.error('[clientes] erro ao criar:', err.message);
  }
});

// PUT /api/clientes/:id  (atualização parcial — só altera os campos enviados)
router.put('/:id', async (req, res) => {
  const id = idValido(req, res);
  if (id === null) return;
  const { dados, erros } = lerCamposTexto(req.body, { parcial: true });
  if (Object.prototype.hasOwnProperty.call(dados, 'nome') && (!dados.nome || dados.nome.length < 2)) {
    erros.unshift('Nome é obrigatório (mínimo 2 caracteres).');
  }
  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  const campos = Object.keys(dados);
  if (!campos.length) return res.status(400).json({ mensagem: 'Nenhum campo para atualizar.' });

  const setClause = campos.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const valores = campos.map((c) => dados[c]);
  try {
    const sql = `UPDATE clientes SET ${setClause}, atualizado_em = now() WHERE id = $1 RETURNING ${COLUNAS_RETORNO.join(', ')}`;
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(sql, [id, ...valores]));
    if (!r.rows.length) return res.status(404).json({ mensagem: 'Cliente não encontrado.' });
    res.json({ ...r.rows[0], operacoes: 0, saldoPendente: 0, proximaCobranca: null });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao atualizar cliente.' });
    console.error('[clientes] erro ao atualizar:', err.message);
  }
});

// DELETE /api/clientes/:id — arquivamento lógico (soft delete). A role de
// aplicação nem tem GRANT DELETE nesta tabela: fisicamente não há como
// apagar um cliente por esta rota, mesmo que o código mudasse amanhã.
router.delete('/:id', async (req, res) => {
  const id = idValido(req, res);
  if (id === null) return;
  try {
    const sql = `UPDATE clientes SET status = 'arquivado', arquivado_em = now(), atualizado_em = now() WHERE id = $1 RETURNING id`;
    const r = await db.comUsuario(req.usuarioId, (c) => c.query(sql, [id]));
    if (!r.rows.length) return res.status(404).json({ mensagem: 'Cliente não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao arquivar cliente.' });
    console.error('[clientes] erro ao arquivar:', err.message);
  }
});

module.exports = router;
