// CredPlus serverless — Lembretes (+ vínculo de cobrança e templates).
// Cobrança vinculada por ID (cliente/empréstimo/parcela); valores exibidos
// são lidos AO VIVO de parcelas/emprestimos — nunca cópias.
// Templates de WhatsApp: 4 chaves com texto-padrão no código; por usuário
// só persiste a personalização (upsert). Tudo no dispatcher d-rot.
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO, idRota } = require('../http');

const TIPOS = ['cobranca', 'cliente', 'operacao', 'reuniao', 'pessoal'];
const PRIORIDADES = ['alta', 'media', 'baixa'];
const ALERTAS = ['no-dia', '1-dia', '3-dias', 'personalizado'];

const TEMPLATES_PADRAO = {
  'antes-vencimento': {
    titulo: 'Lembrete antes do vencimento',
    texto: 'Olá, {cliente}! Passando para lembrar que sua parcela {parcela}, no valor de {valor}, vence em {vencimento}. Qualquer dúvida, estou à disposição.',
  },
  'vence-hoje': {
    titulo: 'Vence hoje',
    texto: 'Olá, {cliente}! Sua parcela {parcela}, no valor de {valor}, vence hoje ({vencimento}). Aguardo seu pagamento. Obrigado!',
  },
  'atrasada': {
    titulo: 'Parcela atrasada',
    texto: 'Olá, {cliente}! Verifiquei que sua parcela {parcela}, no valor de {valor}, venceu em {vencimento} e ainda está em aberto. Podemos regularizar hoje?',
  },
  'amigavel': {
    titulo: 'Cobrança amigável',
    texto: 'Oi, {cliente}! Tudo bem? Só um toque carinhoso sobre a parcela {parcela} de {valor} (vencimento {vencimento}). Me avise quando puder acertar!',
  },
};
const CHAVES_TEMPLATE = Object.keys(TEMPLATES_PADRAO);

async function vinculoCobranca(c, lembrete) {
  if (lembrete.parcela_id == null && lembrete.emprestimo_id == null) return null;
  if (lembrete.parcela_id == null) {
    const r = await c.query(
      `SELECT e.id AS emprestimo_id, cl.id AS cliente_id, cl.nome AS cliente_nome, cl.telefone, cl.whatsapp
       FROM emprestimos e JOIN clientes cl ON cl.id = e.cliente_id
       WHERE e.id = $1`, [lembrete.emprestimo_id]);
    if (!r.rows.length) return null;
    const v = r.rows[0];
    return { emprestimoId: v.emprestimo_id, parcela: null,
      cliente: { id: v.cliente_id, nome: v.cliente_nome, telefone: v.telefone, whatsapp: v.whatsapp } };
  }
  const r = await c.query(
    `SELECT p.id AS parcela_id, p.numero, e.qtd_parcelas AS total_parcelas,
            p.vencimento, p.valor_centavos, p.valor_pago_centavos, p.status,
            e.id AS emprestimo_id, e.status AS emprestimo_status,
            cl.id AS cliente_id, cl.nome AS cliente_nome, cl.telefone, cl.whatsapp
     FROM parcelas p
     JOIN emprestimos e ON e.id = p.emprestimo_id
     JOIN clientes cl ON cl.id = e.cliente_id
     WHERE p.id = $1 AND ($2 IS NULL OR e.id = $2)`,
    [lembrete.parcela_id, lembrete.emprestimo_id]);
  if (!r.rows.length) return null;
  const v = r.rows[0];
  return {
    emprestimoId: v.emprestimo_id,
    parcela: v.parcela_id == null ? null : {
      id: v.parcela_id, numero: v.numero, totalParcelas: v.total_parcelas,
      vencimento: paraDataISO(v.vencimento),
      valor: Number(v.valor_centavos), valorPago: Number(v.valor_pago_centavos),
      saldo: Number(v.valor_centavos) - Number(v.valor_pago_centavos),
      status: v.status,
    },
    cliente: { id: v.cliente_id, nome: v.cliente_nome, telefone: v.telefone, whatsapp: v.whatsapp },
  };
}

function horaValida(s) {
  return typeof s === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(s);
}

function montarResposta(l, cobranca) {
  return {
    id: l.id, descricao: l.descricao, tipo: l.tipo, prioridade: l.prioridade,
    data: paraDataISO(l.data),
    hora: l.hora != null ? String(l.hora).slice(0, 5) : null,
    alerta: l.alerta, concluido: l.concluido,
    clienteId: l.cliente_id, cliente: l.cliente_nome != null ? { nome: l.cliente_nome } : null,
    emprestimoId: l.emprestimo_id, parcelaId: l.parcela_id,
    cobranca: cobranca || null,
    criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
  };
}

async function comCobranca(c, lembrete, clienteNome) {
  const cobranca = await vinculoCobranca(c, lembrete);
  return montarResposta({ ...lembrete, cliente_nome: clienteNome }, cobranca);
}

// Valida o vínculo: parcela pertence ao empréstimo; empréstimo pertence
// ao cliente (quando informado). Retorna {erro} ou null.
async function validarVinculo(c, { clienteId, emprestimoId, parcelaId }) {
  if (emprestimoId == null && parcelaId == null) return null;
  if (emprestimoId != null) {
    const r = await c.query('SELECT id, cliente_id FROM emprestimos WHERE id = $1', [emprestimoId]);
    if (!r.rows.length) return { erro: 404, mensagem: 'Empréstimo vinculado não encontrado.' };
    if (clienteId != null && r.rows[0].cliente_id !== clienteId) {
      return { erro: 400, mensagem: 'O empréstimo não pertence ao cliente selecionado.' };
    }
  }
  if (parcelaId != null) {
    const r = await c.query('SELECT id, emprestimo_id FROM parcelas WHERE id = $1', [parcelaId]);
    if (!r.rows.length) return { erro: 404, mensagem: 'Parcela vinculada não encontrada.' };
    if (emprestimoId != null && r.rows[0].emprestimo_id !== emprestimoId) {
      return { erro: 400, mensagem: 'A parcela não pertence ao empréstimo selecionado.' };
    }
  }
  return null;
}

function lerVinculoCorpo(corpo) {
  const emprestimoId = corpo.emprestimoId !== null && corpo.emprestimoId !== undefined && corpo.emprestimoId !== ''
    ? parseInt(corpo.emprestimoId, 10) : null;
  const parcelaId = corpo.parcelaId !== null && corpo.parcelaId !== undefined && corpo.parcelaId !== ''
    ? parseInt(corpo.parcelaId, 10) : null;
  const erros = [];
  if (corpo.emprestimoId != null && corpo.emprestimoId !== '' && !Number.isInteger(emprestimoId)) erros.push('Empréstimo vinculado inválido.');
  if (corpo.parcelaId != null && corpo.parcelaId !== '' && !Number.isInteger(parcelaId)) erros.push('Parcela vinculada inválida.');
  return { emprestimoId, parcelaId, erros };
}

async function listar({ usuarioId, res }) {
  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const r = await c.query(
        `SELECT l.*, cl.nome AS cliente_nome FROM lembretes l
         LEFT JOIN clientes cl ON cl.id = l.cliente_id ORDER BY l.criado_em DESC`);
      const out = [];
      for (const row of r.rows) out.push(await comCobranca(c, row, row.cliente_nome));
      return out;
    });
    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar lembretes.');
  }
}

async function criar({ body, usuarioId, res }) {
  const corpo = body || {};
  const descricao = String(corpo.descricao || '').trim().slice(0, 300);
  const tipo = String(corpo.tipo || 'pessoal');
  const prioridade = String(corpo.prioridade || 'media');
  const data = String(corpo.data || '');
  const hora = corpo.hora != null && corpo.hora !== '' ? String(corpo.hora) : null;
  const alerta = corpo.alerta != null && corpo.alerta !== '' ? String(corpo.alerta) : null;
  const clienteId = corpo.clienteId !== null && corpo.clienteId !== undefined ? parseInt(corpo.clienteId, 10) : null;

  const erros = [];
  if (!descricao) erros.push('Informe a descrição do lembrete.');
  if (!TIPOS.includes(tipo)) erros.push('Tipo inválido.');
  if (!PRIORIDADES.includes(prioridade)) erros.push('Prioridade inválida.');
  if (!dataValida(data)) erros.push('Data inválida.');
  if (hora !== null && !horaValida(hora)) erros.push('Horário inválido.');
  if (alerta !== null && !ALERTAS.includes(alerta)) erros.push('Alerta inválido.');
  if (corpo.clienteId != null && !Number.isInteger(clienteId)) erros.push('Cliente vinculado inválido.');
  const { emprestimoId, parcelaId, erros: errosVinc } = lerVinculoCorpo(corpo);
  erros.push(...errosVinc);
  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      if (clienteId !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteId]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      const erroVinc = await validarVinculo(c, { clienteId, emprestimoId, parcelaId });
      if (erroVinc) return erroVinc;
      const rIns = await c.query(
        `INSERT INTO lembretes (usuario_id, cliente_id, emprestimo_id, parcela_id, descricao, tipo, prioridade, data, hora, alerta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [usuarioId, clienteId, emprestimoId, parcelaId, descricao, tipo, prioridade, data, hora, alerta]);
      let clienteNome = null;
      if (clienteId !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1', [clienteId]);
        clienteNome = (rc.rows[0] || {}).nome || null;
      }
      const cobranca = await vinculoCobranca(c, rIns.rows[0]);
      return { resposta: montarResposta({ ...rIns.rows[0], cliente_nome: clienteNome }, cobranca) };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, resultado.resposta, 201);
  } catch (e) {
    return falhar(res, 500, 'Falha ao criar lembrete.');
  }
}

async function atualizar({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Lembrete não encontrado.');
  const corpo = body || {};

  const campos = [];
  const valores = [];
  const erros = [];
  const add = (coluna, valor) => { campos.push(coluna); valores.push(valor); };

  if (Object.prototype.hasOwnProperty.call(corpo, 'descricao')) {
    const v = String(corpo.descricao || '').trim().slice(0, 300);
    if (!v) erros.push('Descrição não pode ficar vazia.'); else add('descricao', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'tipo')) {
    const v = String(corpo.tipo || '');
    if (!TIPOS.includes(v)) erros.push('Tipo inválido.'); else add('tipo', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'prioridade')) {
    const v = String(corpo.prioridade || '');
    if (!PRIORIDADES.includes(v)) erros.push('Prioridade inválida.'); else add('prioridade', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'data')) {
    const v = String(corpo.data || '');
    if (!dataValida(v)) erros.push('Data inválida.'); else add('data', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'hora')) {
    const v = corpo.hora != null && corpo.hora !== '' ? String(corpo.hora) : null;
    if (v !== null && !horaValida(v)) erros.push('Horário inválido.'); else add('hora', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'alerta')) {
    const v = corpo.alerta != null && corpo.alerta !== '' ? String(corpo.alerta) : null;
    if (v !== null && !ALERTAS.includes(v)) erros.push('Alerta inválido.'); else add('alerta', v);
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'concluido')) add('concluido', !!corpo.concluido);
  let clienteIdNovo; let temClienteId = false;
  if (Object.prototype.hasOwnProperty.call(corpo, 'clienteId')) {
    temClienteId = true;
    clienteIdNovo = corpo.clienteId !== null && corpo.clienteId !== undefined ? parseInt(corpo.clienteId, 10) : null;
    if (corpo.clienteId != null && !Number.isInteger(clienteIdNovo)) erros.push('Cliente vinculado inválido.');
  }
  let emprestimoIdNovo; let temEmprestimoId = false;
  let parcelaIdNova; let temParcelaId = false;
  if (Object.prototype.hasOwnProperty.call(corpo, 'emprestimoId')) {
    temEmprestimoId = true;
    emprestimoIdNovo = corpo.emprestimoId !== null && corpo.emprestimoId !== undefined && corpo.emprestimoId !== ''
      ? parseInt(corpo.emprestimoId, 10) : null;
    if (corpo.emprestimoId != null && corpo.emprestimoId !== '' && !Number.isInteger(emprestimoIdNovo)) erros.push('Empréstimo vinculado inválido.');
  }
  if (Object.prototype.hasOwnProperty.call(corpo, 'parcelaId')) {
    temParcelaId = true;
    parcelaIdNova = corpo.parcelaId !== null && corpo.parcelaId !== undefined && corpo.parcelaId !== ''
      ? parseInt(corpo.parcelaId, 10) : null;
    if (corpo.parcelaId != null && corpo.parcelaId !== '' && !Number.isInteger(parcelaIdNova)) erros.push('Parcela vinculada inválida.');
  }

  if (erros.length) return falhar(res, 400, erros[0], { erros });
  if (!campos.length && !temClienteId && !temEmprestimoId && !temParcelaId) return falhar(res, 400, 'Nenhum campo para atualizar.');

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      if (temClienteId && clienteIdNovo !== null) {
        const r = await c.query('SELECT id FROM clientes WHERE id = $1', [clienteIdNovo]);
        if (!r.rows.length) return { erro: 404, mensagem: 'Cliente vinculado não encontrado.' };
      }
      // Valida o vínculo FINAL (linha atual + alterações) antes de gravar —
      // nada é persistido se a combinação for inválida.
      const rAtual = await c.query('SELECT cliente_id, emprestimo_id, parcela_id FROM lembretes WHERE id = $1', [id]);
      if (!rAtual.rows.length) return { erro: 404, mensagem: 'Lembrete não encontrado.' };
      const efetivo = {
        clienteId: temClienteId ? clienteIdNovo : rAtual.rows[0].cliente_id,
        emprestimoId: temEmprestimoId ? emprestimoIdNovo : rAtual.rows[0].emprestimo_id,
        parcelaId: temParcelaId ? parcelaIdNova : rAtual.rows[0].parcela_id,
      };
      const erroVinc = await validarVinculo(c, efetivo);
      if (erroVinc) return erroVinc;
      if (temClienteId) { campos.push('cliente_id'); valores.push(clienteIdNovo); }
      if (temEmprestimoId) { campos.push('emprestimo_id'); valores.push(emprestimoIdNovo); }
      if (temParcelaId) { campos.push('parcela_id'); valores.push(parcelaIdNova); }
      const setClause = campos.map((col, i) => `${col} = $${i + 2}`).join(', ');
      const rUpd = await c.query(
        `UPDATE lembretes SET ${setClause}, atualizado_em = now() WHERE id = $1 RETURNING *`, [id, ...valores]);
      if (!rUpd.rows.length) return { erro: 404, mensagem: 'Lembrete não encontrado.' };
      let clienteNome = null;
      if (rUpd.rows[0].cliente_id !== null) {
        const rc = await c.query('SELECT nome FROM clientes WHERE id = $1', [rUpd.rows[0].cliente_id]);
        clienteNome = (rc.rows[0] || {}).nome || null;
      }
      const cobranca = await vinculoCobranca(c, rUpd.rows[0]);
      return { resposta: montarResposta({ ...rUpd.rows[0], cliente_nome: clienteNome }, cobranca) };
    });

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, resultado.resposta);
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar lembrete.');
  }
}

async function excluir({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Lembrete não encontrado.');
  try {
    const r = await db.withUser(usuarioId, (c) => c.query(`DELETE FROM lembretes WHERE id = $1 RETURNING id`, [id]));
    if (!r.rows.length) return falhar(res, 404, 'Lembrete não encontrado.');
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao excluir lembrete.');
  }
}

// GET /api/lembretes/templates — 4 padrões + personalizações do usuário
async function listarTemplates({ usuarioId, res }) {
  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query(`SELECT chave, texto FROM lembrete_templates`));
    const custom = new Map(r.rows.map((t) => [t.chave, t.texto]));
    return ok(res, CHAVES_TEMPLATE.map((chave) => ({
      chave,
      titulo: TEMPLATES_PADRAO[chave].titulo,
      texto: custom.has(chave) ? custom.get(chave) : TEMPLATES_PADRAO[chave].texto,
      personalizado: custom.has(chave),
    })));
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar templates.');
  }
}

// PUT /api/lembretes/templates/:chave { texto } — personaliza (upsert)
async function salvarTemplate({ seg, body, usuarioId, res }) {
  const chave = String(seg[1] || '');
  if (!CHAVES_TEMPLATE.includes(chave)) return falhar(res, 404, 'Template não encontrado.');
  const texto = String((body || {}).texto || '').trim().slice(0, 1000);
  if (!texto) return falhar(res, 400, 'Informe o texto do template.');
  try {
    await db.withUser(usuarioId, (c) => c.query(
      `INSERT INTO lembrete_templates (usuario_id, chave, texto, atualizado_em)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (usuario_id, chave) DO UPDATE SET texto = EXCLUDED.texto, atualizado_em = now()`,
      [usuarioId, chave, texto]));
    return ok(res, { ok: true, chave, texto, personalizado: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao salvar template.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (method === 'GET' && seg.length === 1 && seg[0] === 'templates') return listarTemplates(ctx);
  if (method === 'PUT' && seg.length === 2 && seg[0] === 'templates') return salvarTemplate(ctx);
  if (method === 'GET' && seg.length === 0) return listar(ctx);
  if (method === 'POST' && seg.length === 0) return criar(ctx);
  if (method === 'PUT' && seg.length === 1) return atualizar(ctx);
  if (method === 'DELETE' && seg.length === 1) return excluir(ctx);
  return null;
}

module.exports = { tratar, TEMPLATES_PADRAO };
