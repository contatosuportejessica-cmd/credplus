// CredPlus serverless — Clientes.
// Mesmas regras do backend antigo: validação de campos, busca por nome,
// "todos" esconde arquivados, DELETE é arquivamento lógico.
const db = require('../db');
const { ok, falhar, emailValido, idRota } = require('../http');

const CAMPOS_TEXTO = [
  ['nome', 200], ['telefone', 30], ['whatsapp', 30], ['email', 200],
  ['documento', 30], ['endereco', 300], ['complemento', 120], ['cidade', 120],
  ['estado', 2], ['cep', 15], ['localizacao', 500], ['observacoes', 4000],
];

const COLUNAS_RETORNO = [
  'id', 'nome', 'telefone', 'whatsapp', 'email', 'documento', 'endereco',
  'complemento', 'cidade', 'estado', 'cep', 'localizacao', 'observacoes',
  'foto', 'status', 'criado_em', 'atualizado_em', 'arquivado_em',
];

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

async function listar({ query, usuarioId, res }) {
  const busca = String(query.busca || '').trim();
  const status = String(query.status || 'todos').trim();
  try {
    const condicoes = [];
    const params = [];
    if (status === 'ativo' || status === 'arquivado') {
      params.push(status);
      condicoes.push(`status = $${params.length}`);
    } else {
      condicoes.push(`status <> 'arquivado'`);
    }
    if (busca) {
      params.push(`%${busca}%`);
      condicoes.push(`nome ILIKE $${params.length}`);
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const sql = `SELECT ${COLUNAS_RETORNO.join(', ')} FROM clientes ${where} ORDER BY criado_em DESC, nome ASC`;
    const r = await db.withUser(usuarioId, (c) => c.query(sql, params));
    // Agregados de operações: o frontend real só usa operacoes/saldoPendente/
    // proximaCobranca vindos de Empréstimos/Busca; aqui refletem zero até que
    // a rota de detalhe agregada exista — mesmo comportamento do antigo.
    return ok(res, r.rows.map((c) => ({ ...c, operacoes: 0, saldoPendente: 0, proximaCobranca: null })));
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar clientes.');
  }
}

async function obter({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Cliente não encontrado.');
  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query(`SELECT ${COLUNAS_RETORNO.join(', ')} FROM clientes WHERE id = $1`, [id]));
    if (!r.rows.length) return falhar(res, 404, 'Cliente não encontrado.');
    return ok(res, r.rows[0]);
  } catch (e) {
    return falhar(res, 500, 'Falha ao buscar cliente.');
  }
}

async function criar({ body, usuarioId, res }) {
  const { dados, erros } = lerCamposTexto(body, { parcial: false });
  if (!dados.nome || dados.nome.length < 2) erros.unshift('Nome é obrigatório (mínimo 2 caracteres).');
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  const colunas = CAMPOS_TEXTO.map(([c]) => c);
  const valores = colunas.map((c) => dados[c]);
  try {
    const sql = `INSERT INTO clientes (usuario_id, ${colunas.join(', ')}) VALUES ($1, ${colunas.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${COLUNAS_RETORNO.join(', ')}`;
    const r = await db.withUser(usuarioId, (c) => c.query(sql, [usuarioId, ...valores]));
    return ok(res, { ...r.rows[0], operacoes: 0, saldoPendente: 0, proximaCobranca: null }, 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao criar cliente.');
  }
}

async function atualizar({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Cliente não encontrado.');
  const { dados, erros } = lerCamposTexto(body, { parcial: true });
  if (Object.prototype.hasOwnProperty.call(dados, 'nome') && (!dados.nome || dados.nome.length < 2)) {
    erros.unshift('Nome é obrigatório (mínimo 2 caracteres).');
  }
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  const campos = Object.keys(dados);
  if (!campos.length) return falhar(res, 400, 'Nenhum campo para atualizar.');

  const setClause = campos.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const valores = campos.map((c) => dados[c]);
  try {
    const sql = `UPDATE clientes SET ${setClause}, atualizado_em = now() WHERE id = $1 RETURNING ${COLUNAS_RETORNO.join(', ')}`;
    const r = await db.withUser(usuarioId, (c) => c.query(sql, [id, ...valores]));
    if (!r.rows.length) return falhar(res, 404, 'Cliente não encontrado.');
    return ok(res, { ...r.rows[0], operacoes: 0, saldoPendente: 0, proximaCobranca: null });
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar cliente.');
  }
}

async function arquivar({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Cliente não encontrado.');
  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query(`UPDATE clientes SET status = 'arquivado', arquivado_em = now(), atualizado_em = now() WHERE id = $1 RETURNING id`, [id]));
    if (!r.rows.length) return falhar(res, 404, 'Cliente não encontrado.');
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao arquivar cliente.');
  }
}

const arquivos = require('./arquivos');

async function tratar(ctx) {
  const { method, seg } = ctx;
  // /api/clientes/:id/arquivos... (d-cad cobre o prefixo; sem função nova)
  if (seg.length >= 2 && seg[1] === 'arquivos') return arquivos.tratar(ctx);
  if (method === 'GET' && seg.length === 0) return listar(ctx);
  if (method === 'GET' && seg.length === 1) return obter(ctx);
  if (method === 'POST' && seg.length === 0) return criar(ctx);
  if (method === 'PUT' && seg.length === 1) return atualizar(ctx);
  if (method === 'DELETE' && seg.length === 1) return arquivar(ctx);
  return null;
}

module.exports = { tratar };
