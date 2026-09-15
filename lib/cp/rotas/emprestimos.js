// CredPlus serverless — Empréstimos + criação transacional.
// Mesmas regras do backend antigo: valores em centavos, soma das parcelas
// validada (nunca recalculada), saída financeira automática única,
// idempotência por chave do frontend, DELETE é cancelamento lógico.
const db = require('../db');
const { ok, falhar, dataValida, paraDataISO, hojeSP, diasEntreDatas, idRota } = require('../http');

const FREQUENCIAS = ['diario', 'semanal', 'quinzenal', 'mensal', 'personalizado'];
const FILTROS_DERIVADOS = ['todos', 'andamento', 'quitado', 'atraso', 'cancelado'];

class EmprestimoJaProcessado extends Error {
  constructor(chave) { super('empréstimo já processado para esta chave de idempotência'); this.chave = chave; }
}

function statusParcelaCalc(p, hojeISO) {
  if (p.status === 'cancelado') return 'cancelado';
  const restante = p.valor_centavos - p.valor_pago_centavos;
  const vencimento = paraDataISO(p.vencimento);
  const d = diasEntreDatas(hojeISO, vencimento);
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
    vencimento: paraDataISO(p.vencimento),
    status: p.status, statusCalc: statusParcelaCalc(p, hojeISO),
  };
}

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
    dataOperacao: paraDataISO(emp.data_operacao),
    observacoes: emp.observacoes, status: emp.status, statusCalculado,
    saldoRestante, proximaCobranca: proxima ? proxima.vencimento : null,
    criadoEm: emp.criado_em, parcelas,
  };
}

async function buscarEmprestimoCompleto(c, whereClause, params, usuarioId) {
  const rEmp = await c.query(
    `SELECT e.*, cl.nome AS cliente_nome FROM emprestimos e LEFT JOIN clientes cl ON cl.id = e.cliente_id WHERE (${whereClause}) AND e.usuario_id = $${params.length + 1}`,
    [...params, usuarioId]
  );
  if (!rEmp.rows.length) return null;
  const rPar = await c.query(
    `SELECT * FROM parcelas WHERE emprestimo_id = $1 AND usuario_id = $2 ORDER BY numero ASC`,
    [rEmp.rows[0].id, usuarioId]);
  return montarEmprestimoResposta(rEmp.rows[0], rPar.rows, rEmp.rows[0].cliente_nome, hojeSP());
}

// Transação de criação, reaproveitada por POST /emprestimos e pela
// conversão de simulações — mesma lógica, mesma saída automática,
// mesma idempotência.
async function criarEmprestimoTransacional(c, { usuarioId, clienteId, capital, total, qtdParcelas, frequencia, dataOperacao, observacoes, chave, parcelasValidadas }) {
  const rExistente = await c.query(
    `SELECT id FROM emprestimos WHERE usuario_id = $1 AND chave_idempotencia = $2`,
    [usuarioId, chave]
  );
  if (rExistente.rows.length) throw new EmprestimoJaProcessado(chave);

  const rCliente = await c.query('SELECT id, status FROM clientes WHERE id = $1 AND usuario_id = $2', [clienteId, usuarioId]);
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

  await c.query(
    `INSERT INTO movimentacoes_financeiras (usuario_id, tipo, origem, valor_centavos, descricao, categoria, data, cliente_id, emprestimo_id)
     VALUES ($1,'saida','emprestimo',$2,$3,'Capital emprestado',$4,$5,$6)`,
    [usuarioId, capital, 'Liberação de capital para operação', dataOperacao, clienteId, emp.id]
  );

  const rNomeCliente = await c.query('SELECT nome FROM clientes WHERE id = $1 AND usuario_id = $2', [clienteId, usuarioId]);
  return { emp, parcelasInseridas, clienteNome: (rNomeCliente.rows[0] || {}).nome || null };
}

async function listar({ query, usuarioId, res }) {
  const status = String(query.status || 'todos').trim();
  const clienteId = query.cliente_id !== undefined ? parseInt(query.cliente_id, 10) : null;
  if (query.cliente_id !== undefined && !Number.isInteger(clienteId)) {
    return falhar(res, 400, 'cliente_id inválido.');
  }
  if (!FILTROS_DERIVADOS.includes(status)) {
    return falhar(res, 400, 'Filtro de status inválido.');
  }

  try {
    const hoje = hojeSP();
    const resultado = await db.withUser(usuarioId, async (c) => {
      const params = [usuarioId];
      let where = `WHERE e.usuario_id = $1`;
      if (clienteId !== null) { params.push(clienteId); where += ` AND e.cliente_id = $${params.length}`; }
      const rEmp = await c.query(
        `SELECT e.*, cl.nome AS cliente_nome FROM emprestimos e
         LEFT JOIN clientes cl ON cl.id = e.cliente_id
         ${where} ORDER BY e.criado_em DESC`, params);
      if (!rEmp.rows.length) return [];
      const ids = rEmp.rows.map((e) => e.id);
      const rPar = await c.query(
        `SELECT * FROM parcelas WHERE emprestimo_id = ANY($1::int[]) AND usuario_id = $2 ORDER BY emprestimo_id, numero ASC`, [ids, usuarioId]);
      const parcelasPorEmp = new Map();
      for (const p of rPar.rows) {
        if (!parcelasPorEmp.has(p.emprestimo_id)) parcelasPorEmp.set(p.emprestimo_id, []);
        parcelasPorEmp.get(p.emprestimo_id).push(p);
      }
      return rEmp.rows.map((e) => montarEmprestimoResposta(e, parcelasPorEmp.get(e.id) || [], e.cliente_nome, hoje));
    });

    const lista = status === 'todos' ? resultado : resultado.filter((e) => e.statusCalculado === status);
    return ok(res, lista);
  } catch (e) {
    return falhar(res, 500, 'Falha ao listar empréstimos.');
  }
}

async function obter({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Empréstimo não encontrado.');
  try {
    const resultado = await db.withUser(usuarioId, (c) => buscarEmprestimoCompleto(c, 'e.id = $1', [id], usuarioId));
    if (!resultado) return falhar(res, 404, 'Empréstimo não encontrado.');
    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao buscar empréstimo.');
  }
}

async function criar({ body, usuarioId, res }) {
  const corpo = body || {};
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

  if (erros.length) return falhar(res, 400, erros[0], { erros });

  try {
    const resultado = await db.withUser(usuarioId, (c) => criarEmprestimoTransacional(c, {
      usuarioId, clienteId, capital, total, qtdParcelas: parcelasValidadas.length,
      frequencia, dataOperacao, observacoes, chave, parcelasValidadas,
    }));

    if (resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, montarEmprestimoResposta(resultado.emp, resultado.parcelasInseridas, resultado.clienteNome, hojeSP()), 201);
  } catch (e) {
    if (e instanceof EmprestimoJaProcessado) {
      try {
        const existente = await db.withUser(usuarioId, (c) =>
          buscarEmprestimoCompleto(c, 'e.usuario_id = $1 AND e.chave_idempotencia = $2', [usuarioId, e.chave], usuarioId));
        if (existente) return ok(res, existente);
      } catch {}
    }
    return falhar(res, 500, 'Falha ao criar empréstimo.');
  }
}

async function cancelar({ seg, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Empréstimo não encontrado.');
  try {
    const r = await db.withUser(usuarioId, (c) =>
      c.query(`UPDATE emprestimos SET status = 'cancelado', cancelado_em = now(), atualizado_em = now() WHERE id = $1 AND usuario_id = $2 RETURNING id`, [id, usuarioId]));
    if (!r.rows.length) return falhar(res, 404, 'Empréstimo não encontrado.');
    return ok(res, { ok: true });
  } catch (e) {
    return falhar(res, 500, 'Falha ao cancelar empréstimo.');
  }
}

// PUT /api/emprestimos/:id — edição completa com travas por campo
// (loja.atualizarEmprestimo). Regras de integridade, na ordem:
//   * cancelado: nada edita.
//   * capital/cliente: nunca (capital já foi liberado; saída financeira
//     vinculada). Contagem de parcelas: nunca (adicionar/remover deslocaria
//     números — cancele e recrie a operação nesse caso).
//   * parcela com valor_pago > 0: numero/valor/vencimento IMUTÁVEIS — o
//     recebimento e sua vinculação (pagamento_itens) continuam intactos.
//   * parcelas sem pagamento: valor e vencimento editáveis, desde que
//     soma(pago) + soma(novo não-pago) == total e total > capital.
//   * dataOperacao/observacoes/frequencia: sempre (não afetam dinheiro).
// Tudo numa transação: ou a nova versão inteira entra, ou nada muda.
async function atualizar({ seg, body, usuarioId, res }) {
  const id = idRota(seg[0]);
  if (id === null) return falhar(res, 404, 'Empréstimo não encontrado.');
  const corpo = body || {};
  const temObs = Object.prototype.hasOwnProperty.call(corpo, 'observacoes');
  const temData = Object.prototype.hasOwnProperty.call(corpo, 'dataOperacao');
  const temTotal = Object.prototype.hasOwnProperty.call(corpo, 'total');
  const temFreq = Object.prototype.hasOwnProperty.call(corpo, 'frequencia');
  const temParcelas = Object.prototype.hasOwnProperty.call(corpo, 'parcelas');
  const observacoes = temObs ? (corpo.observacoes != null ? String(corpo.observacoes).trim().slice(0, 4000) : null) : undefined;
  const dataOperacao = temData ? String(corpo.dataOperacao || '') : undefined;
  const total = temTotal ? Math.trunc(Number(corpo.total)) : undefined;
  const frequencia = temFreq ? String(corpo.frequencia || '') : undefined;
  const parcelasEntrada = temParcelas && Array.isArray(corpo.parcelas) ? corpo.parcelas : (temParcelas ? null : undefined);

  if (corpo.capital != null) return falhar(res, 400, 'O valor emprestado não pode ser alterado (já foi liberado).');
  if (corpo.clienteId != null) return falhar(res, 400, 'O cliente da operação não pode ser alterado.');
  if (!temObs && !temData && !temTotal && !temFreq && !temParcelas) {
    return falhar(res, 400, 'Nenhum campo para atualizar.');
  }
  if (temData && !dataValida(dataOperacao)) return falhar(res, 400, 'Data da operação inválida.');
  if (temTotal && (!Number.isFinite(total) || total <= 0)) return falhar(res, 400, 'Valor total inválido.');
  if (temFreq && !FREQUENCIAS.includes(frequencia)) return falhar(res, 400, 'Frequência inválida.');
  if (temParcelas && !parcelasEntrada) return falhar(res, 400, 'Parcelas inválidas.');

  try {
    const resultado = await db.withUser(usuarioId, async (c) => {
      const rEmp = await c.query('SELECT * FROM emprestimos WHERE id = $1 AND usuario_id = $2', [id, usuarioId]);
      if (!rEmp.rows.length) return { erro: 404, mensagem: 'Empréstimo não encontrado.' };
      const emp = rEmp.rows[0];
      if (emp.status === 'cancelado') return { erro: 400, mensagem: 'Empréstimo cancelado não pode ser editado.' };

      const rPar = await c.query(`SELECT * FROM parcelas WHERE emprestimo_id = $1 AND usuario_id = $2 ORDER BY numero ASC`, [id, usuarioId]);
      const atuais = rPar.rows;
      const pagas = atuais.filter((p) => Number(p.valor_pago_centavos) > 0);
      const somaPaga = pagas.reduce((a, p) => a + Number(p.valor_pago_centavos), 0);

      let novasParcelas = null;
      if (temParcelas) {
        if (parcelasEntrada.length !== atuais.length) {
          return { erro: 400, mensagem: 'Não é possível mudar a quantidade de parcelas editando. Cancele e recrie a operação.' };
        }
        const porNumero = new Map(atuais.map((p) => [p.numero, p]));
        novasParcelas = [];
        for (const [i, p] of parcelasEntrada.entries()) {
          const numero = parseInt(p.numero, 10);
          const valor = Math.trunc(Number(p.valor));
          const vencimento = String(p.vencimento || '');
          const atual = porNumero.get(numero);
          if (!atual) return { erro: 400, mensagem: `Parcela ${i + 1}: número não pertence a esta operação.` };
          if (!Number.isFinite(valor) || valor < 0) return { erro: 400, mensagem: `Parcela ${numero}: valor inválido.` };
          if (!dataValida(vencimento)) return { erro: 400, mensagem: `Parcela ${numero}: vencimento inválido.` };
          if (Number(atual.valor_pago_centavos) > 0) {
            const vencAtual = atual.vencimento instanceof Date ? atual.vencimento.toISOString().slice(0, 10) : atual.vencimento;
            if (Number(atual.valor_centavos) !== valor || vencAtual !== vencimento) {
              return { erro: 400, mensagem: `A parcela ${numero} já possui recebimento registrado e não pode ser alterada.` };
            }
          }
          novasParcelas.push({ numero, valor, vencimento });
        }
      }

      const totalFinal = temTotal ? total : Number(emp.total_centavos);
      if (totalFinal <= Number(emp.capital_centavos)) {
        return { erro: 400, mensagem: 'Valor total a receber deve ser maior que o valor emprestado.' };
      }
      if (temParcelas) {
        const somaNaoPagas = novasParcelas
          .filter((p) => {
            const atual = atuais.find((a) => a.numero === p.numero);
            return Number(atual.valor_pago_centavos) <= 0;
          })
          .reduce((a, p) => a + p.valor, 0);
        if (somaPaga + somaNaoPagas !== totalFinal) {
          return { erro: 400, mensagem: `A soma das parcelas (${((somaPaga + somaNaoPagas) / 100).toFixed(2)}) não fecha com o valor total (${(totalFinal / 100).toFixed(2)}).` };
        }
      } else if (temTotal) {
        const somaAtual = atuais.reduce((a, p) => a + Number(p.valor_centavos), 0);
        if (somaAtual !== totalFinal) {
          return { erro: 400, mensagem: 'Ajuste também os valores das parcelas para fechar com o novo total.' };
        }
      }

      const sets = [];
      const vals = [];
      if (temTotal) { sets.push('total_centavos'); vals.push(totalFinal); }
      if (temFreq) { sets.push('frequencia'); vals.push(frequencia); }
      if (temData) { sets.push('data_operacao'); vals.push(dataOperacao); }
      if (temObs) { sets.push('observacoes'); vals.push(observacoes); }
      if (sets.length) {
        const setClause = sets.map((col, i) => `${col} = $${i + 2}`).join(', ');
        await c.query(`UPDATE emprestimos SET ${setClause}, atualizado_em = now() WHERE id = $1 AND usuario_id = $${vals.length + 2}`, [id, ...vals, usuarioId]);
      }
      if (temParcelas) {
        for (const p of novasParcelas) {
          await c.query(
            `UPDATE parcelas SET valor_centavos = $2, vencimento = $3, atualizado_em = now()
             WHERE emprestimo_id = $1 AND numero = $4 AND usuario_id = $5`, [id, p.valor, p.vencimento, p.numero, usuarioId]);
        }
      }
      return buscarEmprestimoCompleto(c, 'e.id = $1', [id], usuarioId);
    });
    if (resultado && resultado.erro) return falhar(res, resultado.erro, resultado.mensagem);
    return ok(res, resultado);
  } catch (e) {
    return falhar(res, 500, 'Falha ao atualizar empréstimo.');
  }
}

async function tratar(ctx) {
  const { method, seg } = ctx;
  if (method === 'GET' && seg.length === 0) return listar(ctx);
  if (method === 'GET' && seg.length === 1) return obter(ctx);
  if (method === 'POST' && seg.length === 0) return criar(ctx);
  if (method === 'PUT' && seg.length === 1) return atualizar(ctx);
  if (method === 'DELETE' && seg.length === 1) return cancelar(ctx);
  return null;
}

module.exports = { tratar, criarEmprestimoTransacional, EmprestimoJaProcessado, montarEmprestimoResposta, FREQUENCIAS };
