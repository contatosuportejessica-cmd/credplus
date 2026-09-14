// ═══════════════════════════════════════════════════════════════════════
// CredPlus — Empréstimos + Parcelas (Etapa 2 do produto real)
//
// Contrato definido pelo FRONTEND JÁ EXISTENTE (assets/js/app.js):
//   POST /emprestimos   { clienteId, capital, total, frequencia,
//                          dataOperacao, observacoes, parcelas: [...],
//                          chaveIdempotencia }
//   GET  /emprestimos?status=&cliente_id=
//   DELETE /emprestimos/:id      (cancelamento — loja.cancelarEmprestimo)
//   PUT  /parcelas/:id  { vencimento }   (único uso real hoje: adiar data)
//
// Não existe PUT /emprestimos/:id no frontend real — não foi criado aqui.
//
// "capital" e "total" chegam do frontend já em CENTAVOS (inteiros). O modo
// de cálculo (valor final vs percentual) é só uma conveniência de UI: o
// percentual NUNCA é enviado ao backend, então não há necessidade (nem
// contrato) de persisti-lo — ganho é sempre total - capital.
//
// O cronograma de parcelas também é gerado no frontend e pode ser editado
// manualmente pelo usuário antes de salvar. Por isso a soma das parcelas é
// VALIDADA aqui (não recalculada silenciosamente): se não fechar
// exatamente com "total", a operação é rejeitada com 400 — nunca
// inventamos nem perdemos centavos "corrigindo" por conta própria um valor
// que o usuário digitou.
//
// Saída financeira automática (migration 007 + 009): cada empréstimo real
// gera EXATAMENTE UMA movimentação de saída (tipo='saida',
// origem='emprestimo'), com valor igual ao CAPITAL emprestado — nunca o
// total a receber. O ganho (total-capital) não sai do caixa antecipado;
// ele só é "realizado" conforme pagamentos forem recebidos (etapa futura
// de Dashboard). Índice único parcial em movimentacoes_financeiras
// garante no banco que um empréstimo nunca gera duas saídas. Cancelar um
// empréstimo NÃO apaga nem reverte essa saída — o capital efetivamente
// saiu; um estorno futuro será um evento novo e explícito, nunca uma
// edição silenciosa desta linha (a tabela nem tem GRANT UPDATE/DELETE).
//
// Idempotência (migration 008): chaveIdempotencia gerada uma única vez
// pelo frontend por clique em "Salvar empréstimo". Diferente de Pagamentos
// (onde já existia uma parcela para travar com FOR UPDATE), aqui não há
// nenhuma linha prévia para travar — a própria criação é o evento. A
// serialização correta vem do índice ÚNICO (usuario_id, chave_idempotencia)
// em emprestimos: se duas transações concorrentes com a mesma chave
// tentam o INSERT em emprestimos ao mesmo tempo, o Postgres serializa
// essa inserção sozinho (a segunda espera a primeira terminar); a que
// perder recebe unique_violation, é revertida por inteiro (nada de
// parcelas/saída financeira sobra) e devolvemos o empréstimo que already
// venceu como resultado idempotente.
//
// REFATORAÇÃO (Simulações): a transação de criação (checar idempotência +
// validar cliente + inserir empréstimo + inserir parcelas + inserir saída
// financeira) foi extraída para `criarEmprestimoTransacional`, exportada
// junto com `EmprestimoJaProcessado`. Isso permite que
// rotas/simulacoes.js (endpoint de conversão de simulação em empréstimo)
// reaproveite EXATAMENTE a mesma lógica, dentro da SUA PRÓPRIA transação
// (que também atualiza a simulação para 'convertida'), em vez de duplicar
// regras financeiras. Nenhum comportamento desta rota mudou.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

const FREQUENCIAS = ['diario', 'semanal', 'quinzenal', 'mensal', 'personalizado'];
const FILTROS_DERIVADOS = ['todos', 'andamento', 'quitado', 'atraso', 'cancelado'];

class EmprestimoJaProcessado extends Error {
  constructor(chave) { super('empréstimo já processado para esta chave de idempotência'); this.chave = chave; }
}

function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function diasEntre(hojeISO, vencimentoISO) {
  const a = new Date(hojeISO + 'T00:00:00Z').getTime();
  const b = new Date(vencimentoISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

// Mesma lógica de app.js: statusParcela(parcela) — valorPago é sempre 0
// nesta etapa (Pagamentos ainda não existe), então nunca retorna
// 'pago'/'parcial'/'atrasado-parcial' na prática, mas a fórmula é mantida
// idêntica para já nascer compatível com a etapa de Pagamentos.
// IMPORTANTE: "vencimento" precisa chegar aqui já como string 'YYYY-MM-DD'.
// node-postgres devolve colunas DATE como objeto Date por padrão — usá-lo
// direto em diasEntre() (que faz `vencimentoISO + 'T00:00:00Z'`) concatena
// o Date como texto e produz uma data inválida, fazendo `d` virar NaN e
// toda parcela vencida cair silenciosamente no `return 'pendente'` final
// em vez de 'atrasado'. Corrigido: normalizamos para string ANTES de
// calcular o status, não só na hora de montar a resposta.
function statusParcelaCalc(p, hojeISO) {
  if (p.status === 'cancelado') return 'cancelado';
  const restante = p.valor_centavos - p.valor_pago_centavos;
  const vencimento = p.vencimento instanceof Date ? p.vencimento.toISOString().slice(0, 10) : p.vencimento;
  const d = diasEntre(hojeISO, vencimento);
  if (restante <= 0) return 'pago';
  if (p.valor_pago_centavos > 0 && restante > 0) return d < 0 ? 'atrasado-parcial' : 'parcial';
  if (d < 0) return 'atrasado';
  if (d === 0) return 'vence-hoje';
  return 'pendente';
}

function montarParcelaResposta(p, hojeISO) {
  return {
    id: p.id, numero: p.numero, total: p.qtd_parcelas_total,
    valor: Number(p.valor_centavos), valorPago: Number(p.valor_pago_centavos),
    vencimento: p.vencimento instanceof Date ? p.vencimento.toISOString().slice(0, 10) : p.vencimento,
    status: p.status, statusCalc: statusParcelaCalc(p, hojeISO),
  };
}

// Monta o objeto de resposta no formato que app.js espera de
// listarEmprestimos/criarEmprestimo (mesmas chaves que _resumoEmprestimo
// produz no modo demo).
function montarEmprestimoResposta(emp, parcelasRows, clienteNome, hojeISO) {
  const parcelas = parcelasRows.map((p) => montarParcelaResposta({ ...p, qtd_parcelas_total: emp.qtd_parcelas }, hojeISO));
  const saldoRestante = parcelas.reduce((acc, p) => acc + (p.valor - p.valorPago), 0);
  const temAtraso = parcelas.some((p) => p.statusCalc === 'atrasado' || p.statusCalc === 'atrasado-parcial');
  let statusCalculado = emp.status;
  if (emp.status !== 'cancelado') {
    statusCalculado = saldoRestante <= 0 ? 'quitado' : (temAtraso ? 'atraso' : 'andamento');
  }
  const proxima = parcelas.filter((p) => p.valor - p.valorPago > 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
  const capital = Number(emp.capital_centavos);
  const total = Number(emp.total_centavos);
  return {
    id: emp.id, clienteId: emp.cliente_id, cliente: clienteNome != null ? { nome: clienteNome } : null,
    capital, total, ganhoPrevisto: total - capital,
    qtdParcelas: emp.qtd_parcelas, frequencia: emp.frequencia,
    dataOperacao: emp.data_operacao instanceof Date ? emp.data_operacao.toISOString().slice(0, 10) : emp.data_operacao,
    observacoes: emp.observacoes, status: emp.status, statusCalculado,
    saldoRestante, proximaCobranca: proxima ? proxima.vencimento : null,
    criadoEm: emp.criado_em, parcelas,
  };
}

// Corrigido na Etapa 5: "hoje" precisa ser o dia no fuso do NEGÓCIO
// (America/Sao_Paulo), não o fuso do processo Node/VPS. Sem isso, uma
// parcela que vence hoje no horário do usuário podia ser considerada
// atrasada horas antes da meia-noite local (se o servidor rodar em UTC),
// e o mesmo dia podia divergir entre esta rota e /api/cobrancas.
function hojeISO() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

async function buscarEmprestimoCompleto(c, whereClause, params) {
  const rEmp = await c.query(
    `SELECT e.*, cl.nome AS cliente_nome FROM emprestimos e LEFT JOIN clientes cl ON cl.id = e.cliente_id WHERE ${whereClause}`,
    params
  );
  if (!rEmp.rows.length) return null;
  const rPar = await c.query(`SELECT * FROM parcelas WHERE emprestimo_id = $1 ORDER BY numero ASC`, [rEmp.rows[0].id]);
  return montarEmprestimoResposta(rEmp.rows[0], rPar.rows, rEmp.rows[0].cliente_nome, hojeISO());
}

// Transação de criação, reaproveitada por POST /api/emprestimos e por
// POST /api/simulacoes/:id/converter. `c` é o cliente de transação já
// aberto por db.comUsuario (o chamador controla BEGIN/COMMIT/ROLLBACK).
// `parcelasValidadas` já deve chegar validada (numero/valor/vencimento) e
// com soma == total — quem chama é responsável por essa validação, pois
// as regras de validação de payload diferem entre "novo empréstimo manual"
// (parcelas vêm do corpo da requisição) e "converter simulação" (parcelas
// vêm do snapshot já salvo em simulacao_parcelas, não do corpo).
async function criarEmprestimoTransacional(c, { usuarioId, clienteId, capital, total, qtdParcelas, frequencia, dataOperacao, observacoes, chave, parcelasValidadas }) {
  // Checagem otimista: evita trabalho desnecessário no caso comum de
  // reenvio sequencial (a proteção real contra corrida é o índice
  // único, verificado logo abaixo no próprio INSERT).
  const rExistente = await c.query(
    `SELECT id FROM emprestimos WHERE usuario_id = $1 AND chave_idempotencia = $2`,
    [usuarioId, chave]
  );
  if (rExistente.rows.length) throw new EmprestimoJaProcessado(chave);

  const rCliente = await c.query('SELECT id, status FROM clientes WHERE id = $1', [clienteId]);
  if (!rCliente.rows.length) return { erro: 404, mensagem: 'Cliente não encontrado.' };
  if (rCliente.rows[0].status === 'arquivado') return { erro: 400, mensagem: 'Este cliente está arquivado e não pode receber novos empréstimos.' };

  let rEmp;
  try {
    rEmp = await c.query(
      `INSERT INTO emprestimos (usuario_id, cliente_id, capital_centavos, total_centavos, qtd_parcelas, frequencia, data_operacao, observacoes, chave_idempotencia)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [usuarioId, clienteId, capital, total, qtdParcelas, frequencia, dataOperacao, observacoes, chave]
    );
  } catch (errIns) {
    // Corrida real: duas requisições com a mesma chave chegaram ao
    // INSERT quase juntas. O Postgres serializa sozinho pelo índice
    // único — a perdedora cai aqui, é revertida por inteiro (nenhuma
    // parcela nem saída financeira desta transação sobrevive) e
    // devolvemos a vencedora como resultado idempotente.
    if (errIns.code === '23505') throw new EmprestimoJaProcessado(chave);
    throw errIns;
  }
  const emp = rEmp.rows[0];

  const parcelasInseridas = [];
  for (const p of parcelasValidadas) {
    const rPar = await c.query(
      `INSERT INTO parcelas (emprestimo_id, usuario_id, numero, valor_centavos, valor_pago_centavos, vencimento, status)
       VALUES ($1,$2,$3,$4,0,$5,'pendente') RETURNING *`,
      [emp.id, usuarioId, p.numero, p.valor, p.vencimento]
    );
    parcelasInseridas.push(rPar.rows[0]);
  }

  // Saída financeira automática — mesma transação: se isto falhar,
  // TUDO acima (empréstimo + parcelas) é revertido junto.
  await c.query(
    `INSERT INTO movimentacoes_financeiras (usuario_id, tipo, origem, valor_centavos, descricao, categoria, data, cliente_id, emprestimo_id)
     VALUES ($1,'saida','emprestimo',$2,$3,'Capital emprestado',$4,$5,$6)`,
    [usuarioId, capital, 'Liberação de capital para operação', dataOperacao, clienteId, emp.id]
  );

  const rNomeCliente = await c.query('SELECT nome FROM clientes WHERE id = $1', [clienteId]);
  return { emp, parcelasInseridas, clienteNome: rNomeCliente.rows[0]?.nome || null };
}

// GET /api/emprestimos?status=&cliente_id=
router.get('/', async (req, res) => {
  const status = String(req.query.status || 'todos').trim();
  const clienteIdRaw = req.query.cliente_id;
  const clienteId = clienteIdRaw !== undefined ? parseInt(clienteIdRaw, 10) : null;
  if (clienteIdRaw !== undefined && !Number.isInteger(clienteId)) {
    return res.status(400).json({ mensagem: 'cliente_id inválido.' });
  }
  if (!FILTROS_DERIVADOS.includes(status)) {
    return res.status(400).json({ mensagem: 'Filtro de status inválido.' });
  }

  try {
    const hoje = hojeISO();
    const resultado = await db.comUsuario(req.usuarioId, async (c) => {
      const params = [];
      let where = '';
      if (clienteId !== null) { params.push(clienteId); where = `WHERE e.cliente_id = $${params.length}`; }
      const sqlEmp = `
        SELECT e.*, cl.nome AS cliente_nome
        FROM emprestimos e
        LEFT JOIN clientes cl ON cl.id = e.cliente_id
        ${where}
        ORDER BY e.criado_em DESC`;
      const rEmp = await c.query(sqlEmp, params);
      if (!rEmp.rows.length) return [];

      const ids = rEmp.rows.map((e) => e.id);
      const rPar = await c.query(
        `SELECT * FROM parcelas WHERE emprestimo_id = ANY($1::int[]) ORDER BY emprestimo_id, numero ASC`,
        [ids]
      );
      const parcelasPorEmp = new Map();
      for (const p of rPar.rows) {
        if (!parcelasPorEmp.has(p.emprestimo_id)) parcelasPorEmp.set(p.emprestimo_id, []);
        parcelasPorEmp.get(p.emprestimo_id).push(p);
      }
      return rEmp.rows.map((e) => montarEmprestimoResposta(e, parcelasPorEmp.get(e.id) || [], e.cliente_nome, hoje));
    });

    const lista = status === 'todos' ? resultado : resultado.filter((e) => e.statusCalculado === status);
    res.json(lista);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao listar empréstimos.' });
    console.error('[emprestimos] erro ao listar:', err.message);
  }
});

// GET /api/emprestimos/:id  (não usado pela UI atual, mantido por paridade com o padrão de Clientes)
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Empréstimo não encontrado.' });
  try {
    const resultado = await db.comUsuario(req.usuarioId, (c) => buscarEmprestimoCompleto(c, 'e.id = $1', [id]));
    if (!resultado) return res.status(404).json({ mensagem: 'Empréstimo não encontrado.' });
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao buscar empréstimo.' });
    console.error('[emprestimos] erro ao buscar:', err.message);
  }
});

// POST /api/emprestimos
router.post('/', async (req, res) => {
  const corpo = req.body || {};
  const clienteId = parseInt(corpo.clienteId, 10);
  const capital = Math.trunc(Number(corpo.capital));
  const total = Math.trunc(Number(corpo.total));
  const frequencia = String(corpo.frequencia || '');
  const dataOperacao = String(corpo.dataOperacao || '');
  const observacoes = corpo.observacoes != null ? String(corpo.observacoes).trim().slice(0, 4000) : null;
  const parcelasEntrada = Array.isArray(corpo.parcelas) ? corpo.parcelas : null;
  const chave = String(corpo.chaveIdempotencia || '').trim();

  const erros = [];
  if (!Number.isInteger(clienteId) || clienteId <= 0) erros.push('Cliente inválido.');
  if (!Number.isFinite(capital) || capital <= 0) erros.push('Valor emprestado deve ser maior que zero.');
  if (!Number.isFinite(total) || total <= capital) erros.push('Valor total a receber deve ser maior que o valor emprestado.');
  if (!FREQUENCIAS.includes(frequencia)) erros.push('Frequência inválida.');
  if (!dataValida(dataOperacao)) erros.push('Data da operação inválida.');
  if (!parcelasEntrada || !parcelasEntrada.length) erros.push('É necessário ao menos uma parcela.');
  if (!chave || chave.length < 8 || chave.length > 200) erros.push('Chave de idempotência ausente ou inválida.');

  let parcelasValidadas = [];
  if (parcelasEntrada && parcelasEntrada.length) {
    let somaParcelas = 0;
    for (const [i, p] of parcelasEntrada.entries()) {
      const numero = parseInt(p.numero, 10);
      const valor = Math.trunc(Number(p.valor));
      const vencimento = String(p.vencimento || '');
      if (!Number.isInteger(numero) || numero <= 0) { erros.push(`Parcela ${i + 1}: número inválido.`); continue; }
      if (!Number.isFinite(valor) || valor < 0) { erros.push(`Parcela ${i + 1}: valor inválido.`); continue; }
      if (!dataValida(vencimento)) { erros.push(`Parcela ${i + 1}: vencimento inválido.`); continue; }
      somaParcelas += valor;
      parcelasValidadas.push({ numero, valor, vencimento });
    }
    if (Number.isFinite(total) && parcelasValidadas.length === parcelasEntrada.length && somaParcelas !== total) {
      erros.push(`A soma das parcelas (${(somaParcelas / 100).toFixed(2)}) não é igual ao valor total a receber (${(total / 100).toFixed(2)}).`);
    }
  }

  if (erros.length) return res.status(400).json({ mensagem: erros[0], erros });

  try {
    const resultado = await db.comUsuario(req.usuarioId, (c) => criarEmprestimoTransacional(c, {
      usuarioId: req.usuarioId, clienteId, capital, total, qtdParcelas: parcelasValidadas.length,
      frequencia, dataOperacao, observacoes, chave, parcelasValidadas,
    }));

    if (resultado.erro) return res.status(resultado.erro).json({ mensagem: resultado.mensagem });

    const resposta = montarEmprestimoResposta(resultado.emp, resultado.parcelasInseridas, resultado.clienteNome, hojeISO());
    res.status(201).json(resposta);
  } catch (err) {
    if (err instanceof EmprestimoJaProcessado) {
      try {
        const resultadoExistente = await db.comUsuario(req.usuarioId, (c) =>
          buscarEmprestimoCompleto(c, 'e.usuario_id = $1 AND e.chave_idempotencia = $2', [req.usuarioId, err.chave]));
        if (resultadoExistente) return res.status(200).json(resultadoExistente);
      } catch (err2) {
        console.error('[emprestimos] erro ao recuperar empréstimo idempotente:', err2.message);
      }
    }
    res.status(500).json({ mensagem: 'Falha ao criar empréstimo.' });
    console.error('[emprestimos] erro ao criar:', err.message);
  }
});

// DELETE /api/emprestimos/:id — cancelamento lógico (loja.cancelarEmprestimo).
// Sem GRANT DELETE na tabela: fisicamente não há como apagar um empréstimo
// por esta rota. As parcelas NÃO são alteradas (mesmo comportamento do
// modo demo: só o status do empréstimo muda).
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ mensagem: 'Empréstimo não encontrado.' });
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query(`UPDATE emprestimos SET status = 'cancelado', cancelado_em = now(), atualizado_em = now() WHERE id = $1 RETURNING id`, [id]));
    if (!r.rows.length) return res.status(404).json({ mensagem: 'Empréstimo não encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ mensagem: 'Falha ao cancelar empréstimo.' });
    console.error('[emprestimos] erro ao cancelar:', err.message);
  }
});

module.exports = router;
module.exports.criarEmprestimoTransacional = criarEmprestimoTransacional;
module.exports.EmprestimoJaProcessado = EmprestimoJaProcessado;
module.exports.hojeISO = hojeISO;
module.exports.dataValida = dataValida;
module.exports.montarEmprestimoResposta = montarEmprestimoResposta;
module.exports.FREQUENCIAS = FREQUENCIAS;
