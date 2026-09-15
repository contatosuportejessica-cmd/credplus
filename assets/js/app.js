try {
window.CP = window.CP || {};

// Camada de storage segura: o preview do ZHEUS roda o app num iframe
// sandboxed sem a flag "allow-same-origin", condição em que o navegador
// bloqueia o acesso a localStorage/sessionStorage lançando SecurityError
// já na leitura da propriedade (não só nas chamadas). Por isso nunca
// tocamos em window.localStorage/window.sessionStorage diretamente em
// nenhum outro lugar do app — tudo passa por este módulo, que testa a
// disponibilidade uma vez, protegida por try/catch, e mantém um espelho
// em memória que garante que a aplicação sempre inicializa, mesmo com
// as duas Storage APIs completamente indisponíveis (nesse caso, a sessão
// dura apenas a navegação atual, sem sobreviver a um F5 — limitação do
// próprio sandbox do preview, não algo que o app possa contornar).
(function () {
  'use strict';

  const memoria = {};

  function armazenamentoDisponivel(tipo) {
    try {
      const s = window[tipo];
      const chaveTeste = '__credplus_teste_storage__';
      s.setItem(chaveTeste, '1');
      s.removeItem(chaveTeste);
      return true;
    } catch (e) {
      return false;
    }
  }

  const temLocal = armazenamentoDisponivel('localStorage');
  const temSessao = armazenamentoDisponivel('sessionStorage');

  const armazenamento = {
    disponivel: temLocal || temSessao,
    obter(chave) {
      if (Object.prototype.hasOwnProperty.call(memoria, chave)) return memoria[chave];
      try {
        if (temLocal) {
          const v = window.localStorage.getItem(chave);
          if (v !== null) return v;
        }
      } catch (e) { /* ignorado: storage pode falhar a qualquer momento no sandbox */ }
      try {
        if (temSessao) {
          const v = window.sessionStorage.getItem(chave);
          if (v !== null) return v;
        }
      } catch (e) { /* idem */ }
      return null;
    },
    definir(chave, valor, persistente) {
      memoria[chave] = valor;
      try {
        if (persistente && temLocal) { window.localStorage.setItem(chave, valor); return; }
        if (temSessao) { window.sessionStorage.setItem(chave, valor); return; }
        if (temLocal) { window.localStorage.setItem(chave, valor); }
      } catch (e) { /* mantém apenas o espelho em memória */ }
    },
    remover(chave) {
      delete memoria[chave];
      try { if (temLocal) window.localStorage.removeItem(chave); } catch (e) { /* ignorado */ }
      try { if (temSessao) window.sessionStorage.removeItem(chave); } catch (e) { /* ignorado */ }
    },
  };

  Object.assign(window.CP, { armazenamento });
})();

(function () {
  'use strict';

  function formatarMoeda(valorCentavos) {
    const valor = (Number(valorCentavos) || 0) / 100;
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function reaisParaCentavos(texto) {
    if (typeof texto === 'number') return Math.round(texto * 100);
    const limpo = String(texto).replace(/[^\d,-]/g, '').replace(',', '.');
    const n = parseFloat(limpo);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }

  function mascaraMoedaInput(el) {
    el.addEventListener('input', () => {
      let digitos = el.value.replace(/\D/g, '');
      if (!digitos) { el.value = ''; return; }
      const num = parseInt(digitos, 10) / 100;
      el.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    });
  }

  function formatarData(isoOuData, comHora = false) {
    if (!isoOuData) return '—';
    let d;
    if (isoOuData instanceof Date) {
      d = isoOuData;
    } else if (typeof isoOuData === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoOuData)) {
      // Data pura (sem hora), ex.: vencimento de parcela, data de operação.
      // new Date('YYYY-MM-DD') interpreta a string como meia-noite UTC; ao
      // exibir no fuso local (Brasil, UTC-3 ou mais atrasado), o dia
      // sempre aparecia 1 dia ANTES do real. Construindo a partir dos
      // componentes no fuso LOCAL evitamos esse deslocamento — uma data
      // "pura" representa um dia de calendário, não um instante UTC.
      const [ano, mes, dia] = isoOuData.split('-').map(Number);
      d = new Date(ano, mes - 1, dia);
    } else {
      d = new Date(isoOuData);
    }
    if (Number.isNaN(d.getTime())) return '—';
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (comHora) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
    return d.toLocaleDateString('pt-BR', opts).replace(',', comHora ? ' às' : '');
  }

  function dataParaISO(data) {
    return data instanceof Date ? data.toISOString().slice(0, 10) : data;
  }

  function hoje() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function diasEntre(a, b) {
    const A = new Date(a); A.setHours(0, 0, 0, 0);
    const B = new Date(b); B.setHours(0, 0, 0, 0);
    return Math.round((B - A) / 86400000);
  }

  function somarDias(data, dias) {
    const d = new Date(data);
    d.setDate(d.getDate() + dias);
    return d;
  }

  function somarMeses(data, meses) {
    const d = new Date(data);
    d.setMonth(d.getMonth() + meses);
    return d;
  }

  function iniciais(nome) {
    if (!nome) return '?';
    const partes = nome.trim().split(/\s+/);
    return ((partes[0]?.[0] || '') + (partes[partes.length - 1]?.[0] || '')).toUpperCase();
  }

  function debounce(fn, ms = 300) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function gerarId() {
    return 'id_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // Chave de idempotência de uma tentativa de pagamento: única por clique,
  // enviada ao backend em POST /pagamentos para que um reenvio da MESMA
  // tentativa (duplo clique, retry de rede, resposta perdida) nunca gere
  // um segundo pagamento no PostgreSQL.
  function gerarChaveIdempotencia() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'pg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12) + '_' + Math.random().toString(36).slice(2, 12);
  }

  function normalizarTelefone(tel) {
    return String(tel || '').replace(/\D/g, '');
  }

  function linkWhatsapp(telefone, mensagem) {
    const numero = normalizarTelefone(telefone);
    const comDDI = numero.length <= 11 ? `55${numero}` : numero;
    return `https://wa.me/${comDDI}?text=${encodeURIComponent(mensagem || '')}`;
  }

  function calcularPorValorFinal(capitalCentavos, totalCentavos) {
    const ganho = totalCentavos - capitalCentavos;
    const percentual = capitalCentavos > 0 ? (ganho / capitalCentavos) * 100 : 0;
    return { ganho, percentual, total: totalCentavos };
  }

  function calcularPorPercentual(capitalCentavos, percentual) {
    const ganho = Math.round(capitalCentavos * (percentual / 100));
    const total = capitalCentavos + ganho;
    return { ganho, percentual, total };
  }

  function gerarCronogramaParcelas({ totalCentavos, qtdParcelas, frequencia, dataPrimeira, diasPersonalizado }) {
    const parcelas = [];
    const valorBase = Math.floor(totalCentavos / qtdParcelas);
    let acumulado = 0;
    for (let i = 0; i < qtdParcelas; i++) {
      let valor = valorBase;
      if (i === qtdParcelas - 1) valor = totalCentavos - acumulado;
      acumulado += valor;
      let vencimento;
      if (frequencia === 'diario') vencimento = somarDias(dataPrimeira, i);
      else if (frequencia === 'semanal') vencimento = somarDias(dataPrimeira, i * 7);
      else if (frequencia === 'quinzenal') vencimento = somarDias(dataPrimeira, i * 15);
      else if (frequencia === 'mensal') vencimento = somarMeses(dataPrimeira, i);
      else vencimento = somarDias(dataPrimeira, i * (diasPersonalizado || 30));
      parcelas.push({
        numero: i + 1, total: qtdParcelas, valor,
        vencimento: dataParaISO(vencimento), status: 'pendente',
        valorPago: 0,
      });
    }
    return parcelas;
  }

  function statusParcela(parcela) {
    if (parcela.status === 'cancelado') return 'cancelado';
    const restante = parcela.valor - (parcela.valorPago || 0);
    const d = diasEntre(hoje(), new Date(parcela.vencimento));
    if (restante <= 0) return 'pago';
    if (parcela.valorPago > 0 && restante > 0) {
      return d < 0 ? 'atrasado-parcial' : 'parcial';
    }
    if (d < 0) return 'atrasado';
    if (d === 0) return 'vence-hoje';
    return 'pendente';
  }

  const ROTULOS_STATUS_PARCELA = {
    pendente: 'Pendente', 'vence-hoje': 'Vence hoje', pago: 'Pago', parcial: 'Parcial',
    atrasado: 'Atrasado', 'atrasado-parcial': 'Atrasado (parcial)', cancelado: 'Cancelado',
  };

  const CORES_STATUS_PARCELA = {
    pendente: 'cinza', 'vence-hoje': 'amarelo', pago: 'verde', parcial: 'azul',
    atrasado: 'vermelho', 'atrasado-parcial': 'vermelho', cancelado: 'cinza',
  };

  function criarSeletorCliente({ montarEm, clienteInicial, aoSelecionar }) {
    const cp = window.CP;
    let clientesCache = null;
    let clienteAtual = clienteInicial || null;
    montarEm.innerHTML = `
      <div style="position:relative">
        <input class="input" id="sel-cliente-input" placeholder="Selecionar cliente..." autocomplete="off" value="${clienteAtual ? cp.escapeHtml(clienteAtual.nome) : ''}">
        <div class="busca-resultados oculto" id="sel-cliente-lista" style="position:absolute;z-index:20;max-height:260px;overflow-y:auto"></div>
      </div>`;
    const input = montarEm.querySelector('#sel-cliente-input');
    const lista = montarEm.querySelector('#sel-cliente-lista');

    async function garantirCache() {
      if (!clientesCache) clientesCache = await cp.loja.listarClientes({}).catch(() => []);
      return clientesCache;
    }

    function renderLista(filtro) {
      const termo = (filtro || '').trim().toLowerCase();
      const itens = (clientesCache || []).filter((c) => !termo || c.nome.toLowerCase().includes(termo));
      lista.innerHTML = itens.length ? itens.map((c) => `
        <div class="busca-resultado-item" data-id="${c.id}" style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0">${(c.nome || '?').slice(0, 2).toUpperCase()}</div>
          <div>
            <div style="font-weight:600">${cp.escapeHtml(c.nome)}</div>
            <div class="texto-xs texto-mudo">${cp.escapeHtml(c.whatsapp || c.telefone || '')}</div>
          </div>
        </div>`).join('') : `<div class="busca-resultado-item texto-mudo">${(clientesCache || []).length ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado.'}</div>`;
      lista.querySelectorAll('[data-id]').forEach((item) => item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const c = (clientesCache || []).find((x) => String(x.id) === item.dataset.id);
        clienteAtual = c || null;
        input.value = c ? c.nome : '';
        lista.classList.add('oculto');
        aoSelecionar?.(clienteAtual);
      }));
    }

    input.addEventListener('focus', async () => {
      await garantirCache();
      renderLista(input.value);
      lista.classList.remove('oculto');
    });
    input.addEventListener('input', () => { renderLista(input.value); lista.classList.remove('oculto'); });
    input.addEventListener('blur', () => setTimeout(() => lista.classList.add('oculto'), 150));

    return {
      obterClienteId: () => clienteAtual?.id || null,
      obterCliente: () => clienteAtual,
      definirCliente: (c) => { clienteAtual = c || null; input.value = c ? c.nome : ''; },
    };
  }


  Object.assign(window.CP, {
    formatarMoeda, reaisParaCentavos, mascaraMoedaInput, formatarData, dataParaISO, hoje, diasEntre,
    somarDias, somarMeses, iniciais, debounce, escapeHtml, gerarId, gerarChaveIdempotencia, normalizarTelefone, linkWhatsapp,
    calcularPorValorFinal, calcularPorPercentual, gerarCronogramaParcelas, statusParcela,
    ROTULOS_STATUS_PARCELA, CORES_STATUS_PARCELA, criarSeletorCliente,
  });
})();
window.CP = window.CP || {};
(function () {
  'use strict';

  const caminhos = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z',
  clientes: 'M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M23 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  emprestimos: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  financeiro: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  cobrancas: 'M4 4h16v2H4zM4 10h16v2H4zM4 16h10v2H4z',
  atrasos: 'M12 8v5l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  lembretes: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9ZM13.73 21a2 2 0 0 1-3.46 0',
  metas: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  simulador: 'M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 5h6M9 12h1M9 16h1M14 12h1M14 16h1',
  notas: 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5',
  relatorios: 'M3 3v18h18M8 17V9m5 8V5m5 12v-6',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.15-1.5l2-1.5-2-3.4-2.35.9a8 8 0 0 0-2.6-1.5L14.5 2h-5l-.4 2.5a8 8 0 0 0-2.6 1.5l-2.35-.9-2 3.4 2 1.5A8 8 0 0 0 4 12a8 8 0 0 0 .15 1.5l-2 1.5 2 3.4 2.35-.9a8 8 0 0 0 2.6 1.5l.4 2.5h5l.4-2.5a8 8 0 0 0 2.6-1.5l2.35.9 2-3.4-2-1.5A8 8 0 0 0 20 12Z',
  mais: 'M12 5v14M5 12h14',
  busca: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  sino: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9ZM13.73 21a2 2 0 0 1-3.46 0',
  olho: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  olhoFechado: 'M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22',
  seta: 'M5 12h14M13 6l6 6-6 6',
  setaEsquerda: 'M19 12H5M12 19l-7-7 7-7',
  setaCima: 'M17 17V7H7M17 7 7 17',
  setaBaixo: 'M17 7v10H7M17 17 7 7',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  mais2: 'M12 5v14M5 12h14',
  editar: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  lixo: 'M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14',
  telefone: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.35 1.79.68 2.63a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.45-1.25a2 2 0 0 1 2.11-.45c.84.33 1.73.56 2.63.68A2 2 0 0 1 22 16.92Z',
  whatsapp: 'M20 12a8 8 0 0 1-11.65 7.1L4 20l.94-4.24A8 8 0 1 1 20 12Z M8.5 9.5c0 3.5 3 6 6 6l1.5-2-2.5-1-1 .5c-1-.6-2-1.5-2.5-2.5l.5-1-1-2.5-2 .5Z',
  email: 'M4 4h16v16H4zM22 6l-10 7L2 6',
  local: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  arquivo: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  download: 'M12 4v12M6 12l6 6 6-6M4 20h16',
  filtro: 'M4 4h16l-6 8v6l-4 2v-8Z',
  fechar: 'M18 6 6 18M6 6l12 12',
  usuario: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  cadeado: 'M6 10V7a6 6 0 1 1 12 0v3M5 10h14v11H5z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  fixar: 'M12 2 9 9l-6 1 4.5 4L6 21l6-4 6 4-1.5-7L21 10l-6-1Z',
  grafico: 'M3 3v18h18M7 14l3-4 3 2 5-7',
  estrela: 'M12 2 9 9l-6 1 4.5 4L6 21l6-4 6 4-1.5-7L21 10l-6-1Z',
  cifrao: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  relogio: 'M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  imagem: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 15l-5-5L5 21',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
};

  function icone(nome, tamanho = 20, cor = 'currentColor') {
    const d = caminhos[nome] || caminhos.info;
    return `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="${cor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d.split(' M').map((seg, i) => `<path d="${i === 0 ? seg : 'M' + seg}"/>`).join('')}</svg>`;
  }

  Object.assign(window.CP, { icone });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { armazenamento } = window.CP;

  // A API do CredPlus vive em /api/* — funções serverless da Vercel
  // (api/[...path].js na raiz do projeto, que expõe backend/src/app.js).
  // Antes disto apontava para /site/credplus/api/*, um proxy da VPS antiga
  // que a Vercel não tem: qualquer chamada de cadastro/login voltava 404, e
  // o app mostrava "Cadastro de novas contas ainda não está disponível
  // neste servidor" (ver app.js mais abaixo, tratamento de err.status===404).
  // Caminho absoluto (começa com "/"), não fixa domínio nem IP.
  const API_BASE = '/api';

  const CHAVE_TOKEN = 'credplus_token';
  const CHAVE_LEMBRAR = 'credplus_lembrar';

  function obterToken() {
    return armazenamento.obter(CHAVE_TOKEN);
  }

  function salvarToken(token, lembrar) {
    armazenamento.definir(CHAVE_TOKEN, token, !!lembrar);
    if (lembrar) armazenamento.definir(CHAVE_LEMBRAR, '1', true);
  }

  function limparToken() {
    armazenamento.remover(CHAVE_TOKEN);
    armazenamento.remover(CHAVE_LEMBRAR);
  }

  class ErroAPI extends Error {
    constructor(mensagem, status, dados) {
      super(mensagem);
      this.status = status;
      this.dados = dados;
    }
  }

  // Mensagem padrão quando o servidor respondeu (não é falha de rede) mas
  // não trouxe um campo "mensagem"/"erro" próprio no corpo JSON. Diferencia
  // erro de validação, credenciais inválidas, conflito (ex.: e-mail já
  // cadastrado), recurso inexistente e erro interno — em vez de um "Falha de
  // rede" genérico que esconderia a causa real.
  function mensagemPadraoPorStatus(status) {
    if (status === 400 || status === 422) return 'Dados inválidos. Verifique os campos preenchidos e tente novamente.';
    if (status === 401) return 'E-mail ou senha incorretos.';
    if (status === 403) return 'Você não tem permissão para realizar esta ação.';
    if (status === 404) return 'Recurso não encontrado no servidor.';
    if (status === 409) return 'Este e-mail já está cadastrado.';
    if (status >= 500) return 'Erro interno do servidor. Tente novamente em instantes.';
    return `Erro ao comunicar com o servidor (${status}).`;
  }

  // Deduplicação de GET em voo: se a MESMA URL já tem uma requisição
  // pendente, devolve a promessa dela em vez de abrir outra — só isso.
  // Sem TTL, sem guardar resultado depois de resolvida: assim que a
  // requisição termina (sucesso OU erro), sai do mapa, e a PRÓXIMA chamada
  // — mesmo que idêntica — vai à rede de novo. Nunca cacheia POST/PUT/DELETE.
  // Existe porque os logs de produção mostraram /api/emprestimos chamado 5x
  // em 7s (telas/handlers diferentes pedindo os mesmos dados ao mesmo
  // tempo) — cada clique/atualização legítima e espaçada continua indo à
  // rede normalmente.
  const _getsEmVoo = new Map();

  async function requisicao(caminho, { method = 'GET', body, headers = {}, isFormData = false } = {}) {
    if (method === 'GET') {
      const emVoo = _getsEmVoo.get(caminho);
      if (emVoo) return emVoo;
      const promessa = _requisicaoSemDedup(caminho, { method, body, headers, isFormData })
        .finally(() => _getsEmVoo.delete(caminho));
      _getsEmVoo.set(caminho, promessa);
      return promessa;
    }
    return _requisicaoSemDedup(caminho, { method, body, headers, isFormData });
  }

  async function _requisicaoSemDedup(caminho, { method = 'GET', body, headers = {}, isFormData = false } = {}) {
    const token = obterToken();
    const opcoes = {
      method,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    };
    if (body !== undefined) opcoes.body = isFormData ? body : JSON.stringify(body);

    const controle = new AbortController();
    const cronometro = setTimeout(() => controle.abort(), 15000);
    opcoes.signal = controle.signal;

    let resposta;
    try {
      resposta = await fetch(`${API_BASE}${caminho}`, opcoes);
    } catch (e) {
      // Falha real de rede/transporte: DNS, conexão recusada, CORS bloqueado
      // pelo navegador ou timeout (AbortError) — o servidor nunca respondeu.
      // Isto é diferente de uma resposta HTTP de erro (tratada abaixo), que
      // significa que o servidor foi alcançado e respondeu.
      const mensagem = e && e.name === 'AbortError'
        ? 'O servidor demorou demais para responder. Tente novamente.'
        : 'Não foi possível alcançar o servidor. Verifique sua conexão e tente novamente.';
      throw new ErroAPI(mensagem, 0, null);
    } finally {
      clearTimeout(cronometro);
    }

    // Um 401 só significa "sessão expirada" quando a chamada de fato carregava
    // um token (rota autenticada). Em /auth/login e /auth/register não há
    // token ainda — ali, 401 é resposta normal de credencial inválida, não
    // uma sessão que expirou, e não deve forçar logout nem disparar o evento
    // global de sessão expirada.
    if (resposta.status === 401 && token) {
      limparToken();
      window.dispatchEvent(new CustomEvent('credplus:sessao-expirada'));
      throw new ErroAPI('Sessão expirada. Faça login novamente.', 401, null);
    }

    const tipo = resposta.headers.get('content-type') || '';
    const dados = tipo.includes('application/json') ? await resposta.json().catch(() => null) : null;

    if (!resposta.ok) {
      const msg = (dados && (dados.mensagem || dados.erro)) || mensagemPadraoPorStatus(resposta.status);
      throw new ErroAPI(msg, resposta.status, dados);
    }
    return dados;
  }

  const api = {
    base: API_BASE,
    get: (caminho) => requisicao(caminho),
    post: (caminho, body) => requisicao(caminho, { method: 'POST', body }),
    put: (caminho, body) => requisicao(caminho, { method: 'PUT', body }),
    del: (caminho) => requisicao(caminho, { method: 'DELETE' }),
    upload: (caminho, formData) => requisicao(caminho, { method: 'POST', body: formData, isFormData: true }),
  };

  const auth = {
    login: (email, senha) => api.post('/auth/login', { email, senha }),
    registrar: (nome, email, senha, pergunta, resposta) => api.post('/auth/register', { nome, email, senha, pergunta, resposta }),
    me: () => api.get('/auth/me'),
    logout: () => api.post('/auth/logout', {}),
    recuperarPergunta: (email) => api.post('/auth/recuperar/pergunta', { email }),
    redefinirSenha: (email, resposta, senha_nova) => api.post('/auth/recuperar/redefinir', { email, resposta, senha_nova }),
  };

  const PERGUNTAS_RECUPERACAO = [
    'Em qual cidade você nasceu?',
    'Qual era o nome do seu primeiro animal de estimação?',
    'Qual é sua comida favorita?',
    'Qual país você gostaria de conhecer?',
    'Qual é o segundo nome da sua mãe?',
    'Qual é o segundo nome do seu pai?',
    'Qual era seu apelido de infância?',
    'Qual era o nome do seu primeiro professor ou professora?',
    'Qual é seu filme favorito?',
    'Qual o primeiro nome de uma pessoa importante da sua infância?',
  ];

  function opcoesPerguntasQuestionario(selecionada) {
    const esc = window.CP.escapeHtml;
    return ['<option value="">Selecione uma pergunta...</option>']
      .concat(PERGUNTAS_RECUPERACAO.map((p) => `<option value="${esc(p)}"${p === selecionada ? ' selected' : ''}>${esc(p)}</option>`))
      .join('');
  }

  Object.assign(window.CP, { obterToken, salvarToken, limparToken, ErroAPI, api, auth, PERGUNTAS_RECUPERACAO, opcoesPerguntasQuestionario });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { gerarId, dataParaISO, somarDias, somarMeses, gerarCronogramaParcelas } = window.CP;

// Gera um conjunto coerente de dados fictícios, usado SOMENTE no modo de
// demonstração (client-side, nunca gravado no backend real). Cada registro
// carrega `demo:true` para que a interface deixe claro que não é dado real.
function gerarDadosDemo() {
  const agora = new Date();
  const clientes = [
    { id: gerarId(), demo: true, nome: 'João Silva', telefone: '11987654321', whatsapp: '11987654321', email: 'joao.silva@exemplo.com', documento: '123.456.789-00', endereco: 'Rua das Flores, 120', complemento: 'Apto 42', cidade: 'São Paulo', estado: 'SP', cep: '01234-000', localizacao: '', observacoes: 'Cliente pontual, prefere contato por WhatsApp.', foto: 'assets/img/avatar-1.jpg', criadoEm: dataParaISO(somarMeses(agora, -4)) },
    { id: gerarId(), demo: true, nome: 'Maria Oliveira', telefone: '11976543210', whatsapp: '11976543210', email: 'maria.oliveira@exemplo.com', documento: '987.654.321-00', endereco: 'Av. Central, 800', complemento: '', cidade: 'Campinas', estado: 'SP', cep: '13010-000', localizacao: '', observacoes: 'Já atrasou uma vez, mas regularizou rápido.', foto: 'assets/img/avatar-2.jpg', criadoEm: dataParaISO(somarMeses(agora, -2)) },
    { id: gerarId(), demo: true, nome: 'Carlos Pereira', telefone: '11965432109', whatsapp: '11965432109', email: 'carlos.pereira@exemplo.com', documento: '456.789.123-00', endereco: 'Rua dos Ipês, 55', complemento: 'Casa 2', cidade: 'Guarulhos', estado: 'SP', cep: '07000-000', localizacao: '', observacoes: '', foto: '', criadoEm: dataParaISO(somarMeses(agora, -1)) },
  ];

  const emprestimos = [];
  const parcelasPorEmprestimo = {};
  const pagamentos = [];
  const movimentacoes = [];

  function criarOperacao({ clienteId, capital, total, qtdParcelas, frequencia, mesesAtras, pagarAte, comAtraso }) {
    const dataOperacao = somarMeses(agora, -mesesAtras);
    const id = gerarId();
    const parcelas = gerarCronogramaParcelas({
      totalCentavos: total, qtdParcelas, frequencia, dataPrimeira: dataOperacao,
    }).map((p) => ({ ...p, id: gerarId(), emprestimoId: id, demo: true }));

    for (let i = 0; i < pagarAte; i++) {
      const p = parcelas[i];
      p.status = 'pago';
      p.valorPago = p.valor;
      const dataPg = i === pagarAte - 1 && comAtraso ? somarDias(p.vencimento, 4) : p.vencimento;
      const pagamentoId = gerarId();
      pagamentos.push({
        id: pagamentoId, demo: true, clienteId, emprestimoId: id, parcelaId: p.id,
        valorEsperado: p.valor, valorRecebido: p.valor, data: dataParaISO(dataPg),
        forma: i % 2 === 0 ? 'pix' : 'dinheiro', observacao: '',
      });
      movimentacoes.push({
        id: gerarId(), demo: true, tipo: 'entrada', categoria: 'Recebimento de parcela', clienteId,
        emprestimoId: id, valor: p.valor, data: dataParaISO(dataPg), descricao: `Parcela ${p.numero}/${p.total} recebida`,
      });
    }

    movimentacoes.push({
      id: gerarId(), demo: true, tipo: 'saida', categoria: 'Capital emprestado', clienteId, emprestimoId: id,
      valor: capital, data: dataParaISO(dataOperacao), descricao: 'Liberação de capital para operação',
    });

    const saldoRestante = parcelas.reduce((acc, p) => acc + (p.valor - p.valorPago), 0);
    emprestimos.push({
      id, demo: true, clienteId, capital, total, ganhoPrevisto: total - capital, qtdParcelas, frequencia,
      dataOperacao: dataParaISO(dataOperacao), primeiraColranca: parcelas[0].vencimento,
      status: saldoRestante <= 0 ? 'quitado' : 'andamento', observacoes: '',
    });
    parcelasPorEmprestimo[id] = parcelas;
  }

  criarOperacao({ clienteId: clientes[0].id, capital: 400000, total: 600000, qtdParcelas: 6, frequencia: 'mensal', mesesAtras: 3, pagarAte: 3, comAtraso: false });
  criarOperacao({ clienteId: clientes[1].id, capital: 250000, total: 350000, qtdParcelas: 5, frequencia: 'semanal', mesesAtras: 1, pagarAte: 2, comAtraso: true });
  criarOperacao({ clienteId: clientes[2].id, capital: 150000, total: 195000, qtdParcelas: 4, frequencia: 'quinzenal', mesesAtras: 2, pagarAte: 4, comAtraso: false });

  const lembretes = [
    { id: gerarId(), demo: true, tipo: 'cobranca', data: dataParaISO(agora), hora: '09:00', descricao: 'Cobrar parcela em atraso da Maria', clienteId: clientes[1].id, prioridade: 'alta', alerta: 'no-dia', concluido: false },
    { id: gerarId(), demo: true, tipo: 'reuniao', data: dataParaISO(somarDias(agora, 2)), hora: '14:30', descricao: 'Reunião com Carlos sobre renovação', clienteId: clientes[2].id, prioridade: 'media', alerta: '1-dia', concluido: false },
  ];

  const metas = [
    { id: gerarId(), demo: true, tipo: 'ganho', titulo: 'Ganho mensal', periodo: 'mensal', valorAlvo: 4000000, dataInicio: dataParaISO(somarDias(agora, -15)), dataFim: dataParaISO(somarDias(agora, 15)) },
    { id: gerarId(), demo: true, tipo: 'capital_emprestado', titulo: 'Capital emprestado no trimestre', periodo: 'trimestral', valorAlvo: 3000000, dataInicio: dataParaISO(somarMeses(agora, -2)), dataFim: dataParaISO(somarMeses(agora, 1)) },
  ];

  const notas = [
    { id: gerarId(), demo: true, titulo: 'Renegociar com Maria', conteudo: 'Ofereceu pagar em duas vezes. Avaliar próxima semana.', categoria: 'cliente', clienteId: clientes[1].id, fixado: true, criadoEm: dataParaISO(agora) },
    { id: gerarId(), demo: true, titulo: 'Ideia: bônus por antecipação', conteudo: 'Dar desconto de 5% para quem quitar antes do prazo.', categoria: 'ideia', clienteId: null, fixado: false, criadoEm: dataParaISO(somarDias(agora, -5)) },
  ];

  return { clientes, emprestimos, parcelasPorEmprestimo, pagamentos, movimentacoes, lembretes, metas, notas, notificacoes: [] };
}

  Object.assign(window.CP, { gerarDadosDemo });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { api, ErroAPI, gerarDadosDemo, gerarId, statusParcela, diasEntre, hoje, armazenamento, obterToken } = window.CP;

const CHAVE_DEMO = 'credplus_modo_demo';

function arquivoParaUrl(dadosB64, mime) {
  const bin = atob(dadosB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
}

class Loja extends EventTarget {
  constructor() {
    super();
    this.usuario = null;
    this.demoAtivo = armazenamento.obter(CHAVE_DEMO) === '1';
    this.demo = this.demoAtivo ? gerarDadosDemo() : null;
  }

  emitir(nome, detalhe) {
    this.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));
  }

  ativarDemo() {
    this.demoAtivo = true;
    this.demo = gerarDadosDemo();
    armazenamento.definir(CHAVE_DEMO, '1', false);
    this.emitir('mudou');
  }

  desativarDemo() {
    this.demoAtivo = false;
    this.demo = null;
    armazenamento.remover(CHAVE_DEMO);
    this.emitir('mudou');
  }

  // ===== Clientes =====
  async listarClientes({ busca = '', status = 'todos' } = {}) {
    if (this.demoAtivo) {
      let lista = this.demo.clientes;
      if (busca) lista = lista.filter((c) => c.nome.toLowerCase().includes(busca.toLowerCase()));
      return lista.map((c) => this._resumoCliente(c));
    }
    const qs = new URLSearchParams({ busca, status }).toString();
    return api.get(`/clientes?${qs}`);
  }

  _resumoCliente(cliente) {
    const emprestimos = this.demo.emprestimos.filter((e) => e.clienteId === cliente.id);
    let saldoPendente = 0, proximaCobranca = null;
    for (const emp of emprestimos) {
      const parcelas = this.demo.parcelasPorEmprestimo[emp.id] || [];
      for (const p of parcelas) {
        const restante = p.valor - p.valorPago;
        if (restante > 0) {
          saldoPendente += restante;
          if (!proximaCobranca || p.vencimento < proximaCobranca) proximaCobranca = p.vencimento;
        }
      }
    }
    return { ...cliente, operacoes: emprestimos.length, saldoPendente, proximaCobranca };
  }

  async obterCliente(id) {
    if (this.demoAtivo) {
      const cliente = this.demo.clientes.find((c) => c.id === id);
      return cliente ? this._resumoCliente(cliente) : null;
    }
    return api.get(`/clientes/${id}`);
  }

  async criarCliente(dados) {
    if (this.demoAtivo) {
      const novo = { id: gerarId(), demo: true, criadoEm: new Date().toISOString().slice(0, 10), ...dados };
      this.demo.clientes.unshift(novo);
      this.emitir('mudou');
      return novo;
    }
    const criado = await api.post('/clientes', dados);
    this.emitir('mudou');
    return criado;
  }

  async atualizarCliente(id, dados) {
    if (this.demoAtivo) {
      const i = this.demo.clientes.findIndex((c) => c.id === id);
      if (i >= 0) this.demo.clientes[i] = { ...this.demo.clientes[i], ...dados };
      this.emitir('mudou');
      return this.demo.clientes[i];
    }
    const atualizado = await api.put(`/clientes/${id}`, dados);
    this.emitir('mudou');
    return atualizado;
  }

  async arquivarCliente(id) {
    if (this.demoAtivo) {
      this.demo.clientes = this.demo.clientes.filter((c) => c.id !== id);
      this.emitir('mudou');
      return true;
    }
    await api.del(`/clientes/${id}`);
    this.emitir('mudou');
    return true;
  }

  // ===== Empréstimos =====
  async listarEmprestimos({ status = 'todos', clienteId } = {}) {
    if (this.demoAtivo) {
      let lista = this.demo.emprestimos.map((e) => this._resumoEmprestimo(e));
      if (clienteId) lista = lista.filter((e) => e.clienteId === clienteId);
      if (status !== 'todos') lista = lista.filter((e) => e.statusCalculado === status);
      return lista;
    }
    const qs = new URLSearchParams({ status, ...(clienteId ? { cliente_id: clienteId } : {}) }).toString();
    return api.get(`/emprestimos?${qs}`);
  }

  _resumoEmprestimo(emp) {
    const parcelas = (this.demo.parcelasPorEmprestimo[emp.id] || []).map((p) => ({ ...p, statusCalc: statusParcela(p) }));
    const saldoRestante = parcelas.reduce((acc, p) => acc + (p.valor - p.valorPago), 0);
    const temAtraso = parcelas.some((p) => p.statusCalc === 'atrasado' || p.statusCalc === 'atrasado-parcial');
    const proxima = parcelas.filter((p) => p.valor - p.valorPago > 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
    const cliente = this.demo.clientes.find((c) => c.id === emp.clienteId);
    let statusCalculado = emp.status;
    if (emp.status !== 'cancelado') {
      statusCalculado = saldoRestante <= 0 ? 'quitado' : (temAtraso ? 'atraso' : 'andamento');
    }
    return { ...emp, parcelas, saldoRestante, statusCalculado, proximaCobranca: proxima?.vencimento || null, cliente };
  }

  async obterEmprestimo(id) {
    if (this.demoAtivo) {
      const emp = this.demo.emprestimos.find((e) => e.id === id);
      return emp ? this._resumoEmprestimo(emp) : null;
    }
    return api.get(`/emprestimos/${id}`);
  }

  async atualizarEmprestimo(id, dados) {
    if (this.demoAtivo) {
      const emp = this.demo.emprestimos.find((e) => e.id === id);
      if (!emp) throw new Error('Empréstimo não encontrado.');
      if (emp.status === 'cancelado') throw new Error('Empréstimo cancelado não pode ser editado.');
      if (dados.capital != null) throw new Error('O valor emprestado não pode ser alterado (já foi liberado).');
      const atuais = this.demo.parcelasPorEmprestimo[id] || [];
      if (Array.isArray(dados.parcelas)) {
        if (dados.parcelas.length !== atuais.length) throw new Error('Não é possível mudar a quantidade de parcelas editando.');
        for (const p of dados.parcelas) {
          const atual = atuais.find((a) => a.numero === p.numero);
          if (!atual) throw new Error(`Parcela ${p.numero} não pertence a esta operação.`);
          if ((atual.valorPago || 0) > 0 && (atual.valor !== p.valor || atual.vencimento !== p.vencimento)) {
            throw new Error(`A parcela ${p.numero} já possui recebimento registrado e não pode ser alterada.`);
          }
        }
        this.demo.parcelasPorEmprestimo[id] = dados.parcelas.map((p) => {
          const atual = atuais.find((a) => a.numero === p.numero);
          return { ...atual, valor: p.valor, vencimento: p.vencimento };
        });
      }
      if (dados.total != null) {
        const soma = (this.demo.parcelasPorEmprestimo[id] || []).reduce((a, p) => a + p.valor, 0);
        if (soma !== dados.total) throw new Error('A soma das parcelas não fecha com o valor total.');
        if (dados.total <= emp.capital) throw new Error('Valor total a receber deve ser maior que o valor emprestado.');
        emp.total = dados.total;
      }
      if (dados.dataOperacao) emp.dataOperacao = dados.dataOperacao;
      if (dados.frequencia) emp.frequencia = dados.frequencia;
      if (dados.observacoes !== undefined) emp.observacoes = dados.observacoes;
      this.emitir('mudou');
      return this._resumoEmprestimo(emp);
    }
    const atualizado = await api.put(`/emprestimos/${id}`, dados);
    this.emitir('mudou');
    return atualizado;
  }

  async criarEmprestimo(dados) {
    if (this.demoAtivo) {
      const id = gerarId();
      const parcelas = dados.parcelas.map((p) => ({ ...p, id: gerarId(), emprestimoId: id, demo: true, valorPago: 0, status: 'pendente' }));
      const novo = {
        id, demo: true, clienteId: dados.clienteId, capital: dados.capital, total: dados.total,
        ganhoPrevisto: dados.total - dados.capital, qtdParcelas: dados.parcelas.length, frequencia: dados.frequencia,
        dataOperacao: dados.dataOperacao, primeiraColranca: parcelas[0]?.vencimento, status: 'andamento', observacoes: dados.observacoes || '',
      };
      this.demo.emprestimos.unshift(novo);
      this.demo.parcelasPorEmprestimo[id] = parcelas;
      this.demo.movimentacoes.unshift({
        id: gerarId(), demo: true, tipo: 'saida', categoria: 'Capital emprestado', clienteId: dados.clienteId,
        emprestimoId: id, valor: dados.capital, data: dados.dataOperacao, descricao: 'Liberação de capital para operação',
      });
      this.emitir('mudou');
      return novo;
    }
    const criado = await api.post('/emprestimos', dados);
    this.emitir('mudou');
    return criado;
  }

  async cancelarEmprestimo(id) {
    if (this.demoAtivo) {
      const emp = this.demo.emprestimos.find((e) => e.id === id);
      if (emp) emp.status = 'cancelado';
      this.emitir('mudou');
      return true;
    }
    await api.del(`/emprestimos/${id}`);
    this.emitir('mudou');
    return true;
  }

  async ajustarParcela(parcelaId, dados) {
    if (this.demoAtivo) {
      for (const lista of Object.values(this.demo.parcelasPorEmprestimo)) {
        const p = lista.find((x) => x.id === parcelaId);
        if (p) Object.assign(p, dados);
      }
      this.emitir('mudou');
      return true;
    }
    await api.put(`/parcelas/${parcelaId}`, dados);
    this.emitir('mudou');
    return true;
  }

  // ===== Simulações =====
  async listarSimulacoes({ status = 'todas', busca = '' } = {}) {
    const qs = new URLSearchParams({ status, busca }).toString();
    return api.get(`/simulacoes?${qs}`);
  }

  async obterSimulacao(id) {
    return api.get(`/simulacoes/${id}`);
  }

  async criarSimulacao(dados) {
    return api.post('/simulacoes', dados);
  }

  async atualizarSimulacao(id, dados) {
    return api.put(`/simulacoes/${id}`, dados);
  }

  async vincularClienteSimulacao(id, clienteId) {
    return api.put(`/simulacoes/${id}/cliente`, { clienteId });
  }

  async arquivarSimulacao(id) {
    return api.del(`/simulacoes/${id}`);
  }

  async converterSimulacao(id, dados) {
    return api.post(`/simulacoes/${id}/converter`, dados);
  }

  // ===== Pagamentos =====
  // Aceita contrato legado (parcelaId + valorRecebido) OU multi:
  // itens: [{ parcelaId, valor }]. No modo demo ambos atualizam os saldos.
  async registrarPagamento({ clienteId, emprestimoId, parcelaId, itens, valorRecebido, data, forma, observacao, chaveIdempotencia }) {
    const listaItens = Array.isArray(itens) && itens.length
      ? itens
      : [{ parcelaId, valor: valorRecebido }];
    const total = listaItens.reduce((a, i) => a + i.valor, 0);
    if (this.demoAtivo) {
      const parcelas = this.demo.parcelasPorEmprestimo[emprestimoId] || [];
      for (const it of listaItens) {
        const parc = parcelas.find((p) => p.id === it.parcelaId);
        if (!parc) throw new Error('Parcela não encontrada.');
        parc.valorPago = (parc.valorPago || 0) + it.valor;
        if (parc.valorPago >= parc.valor) parc.status = 'pago';
      }
      const primeira = parcelas.find((p) => p.id === listaItens[0].parcelaId);
      const pagamento = {
        id: gerarId(), demo: true, clienteId, emprestimoId, parcelaId: listaItens.length === 1 ? listaItens[0].parcelaId : null,
        parcelaIds: listaItens.map((i) => i.parcelaId),
        itens: listaItens.map((i) => {
          const parc = parcelas.find((p) => p.id === i.parcelaId);
          return { parcelaId: i.parcelaId, numero: parc?.numero ?? null, valor: i.valor };
        }),
        valorEsperado: total, valorRecebido: total, data, forma, observacao: observacao || '',
        criadoEm: new Date().toISOString(),
      };
      void primeira;
      this.demo.pagamentos.unshift(pagamento);
      this.demo.movimentacoes.unshift({
        id: gerarId(), demo: true, tipo: 'entrada', categoria: 'Recebimento de parcela', clienteId, emprestimoId,
        valor: total, data, descricao: `Pagamento de ${listaItens.length} parcela(s)`,
      });
      this.emitir('mudou');
      return pagamento;
    }
    const corpo = {
      cliente_id: clienteId, emprestimo_id: emprestimoId, valor_recebido: total,
      data, forma, observacao, chave_idempotencia: chaveIdempotencia,
    };
    if (listaItens.length === 1 && parcelaId) corpo.parcela_id = parcelaId;
    else corpo.itens = listaItens.map((i) => ({ parcela_id: i.parcelaId, valor: i.valor }));
    const pagamento = await api.post('/pagamentos', corpo);
    this.emitir('mudou');
    return pagamento;
  }

  // ===== Arquivos do cliente =====
  async listarArquivos(clienteId) {
    if (this.demoAtivo) {
      return (this.demo.arquivos || []).filter((a) => a.clienteId === clienteId);
    }
    return api.get(`/clientes/${clienteId}/arquivos`);
  }

  async adicionarArquivo(clienteId, { nome, mime, dados }) {
    if (this.demoAtivo) {
      this.demo.arquivos = this.demo.arquivos || [];
      const novo = { id: gerarId(), demo: true, clienteId, nome, mime, tamanho: Math.round(dados.length * 3 / 4), criadoEm: new Date().toISOString(), dados };
      this.demo.arquivos.unshift(novo);
      this.emitir('mudou');
      return novo;
    }
    const novo = await api.post(`/clientes/${clienteId}/arquivos`, { nome, mime, dados });
    this.emitir('mudou');
    return novo;
  }

  async baixarArquivo(clienteId, arquivo) {
    if (this.demoAtivo && arquivo.dados) {
      return arquivoParaUrl(arquivo.dados, arquivo.mime);
    }
    const token = obterToken();
    const resposta = await fetch(`${api.base}/clientes/${clienteId}/arquivos/${arquivo.id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resposta.ok) throw new ErroAPI('Não foi possível baixar o arquivo.', resposta.status, null);
    const blob = await resposta.blob();
    return URL.createObjectURL(blob);
  }

  async excluirArquivo(clienteId, arquivoId) {
    if (this.demoAtivo) {
      this.demo.arquivos = (this.demo.arquivos || []).filter((a) => a.id !== arquivoId);
      this.emitir('mudou');
      return true;
    }
    await api.del(`/clientes/${clienteId}/arquivos/${arquivoId}`);
    this.emitir('mudou');
    return true;
  }

  async listarPagamentos({ clienteId, emprestimoId } = {}) {
    if (this.demoAtivo) {
      let lista = this.demo.pagamentos;
      if (clienteId) lista = lista.filter((p) => p.clienteId === clienteId);
      if (emprestimoId) lista = lista.filter((p) => p.emprestimoId === emprestimoId);
      return lista;
    }
    const qs = new URLSearchParams({ ...(clienteId ? { cliente_id: clienteId } : {}), ...(emprestimoId ? { emprestimo_id: emprestimoId } : {}) }).toString();
    return api.get(`/pagamentos?${qs}`);
  }

  // ===== Financeiro =====
  async listarMovimentacoes({ tipo = 'todos', categoria = '' } = {}) {
    if (this.demoAtivo) {
      let lista = this.demo.movimentacoes;
      if (tipo !== 'todos') lista = lista.filter((m) => m.tipo === tipo);
      if (categoria) lista = lista.filter((m) => m.categoria === categoria);
      return lista.map((m) => ({ ...m, cliente: this.demo.clientes.find((c) => c.id === m.clienteId) }));
    }
    const qs = new URLSearchParams({ tipo, categoria }).toString();
    return api.get(`/financeiro/movimentacoes?${qs}`);
  }

  async criarMovimentacao(dados) {
    if (this.demoAtivo) {
      const nova = { id: gerarId(), demo: true, ...dados };
      this.demo.movimentacoes.unshift(nova);
      this.emitir('mudou');
      return nova;
    }
    const nova = await api.post('/financeiro/movimentacoes', dados);
    this.emitir('mudou');
    return nova;
  }

  // ===== Cobranças (derivadas das parcelas) =====
  async listarCobrancas({ filtro = 'todas' } = {}) {
    if (this.demoAtivo) {
      const linhas = [];
      for (const emp of this.demo.emprestimos) {
        if (emp.status === 'cancelado') continue;
        const cliente = this.demo.clientes.find((c) => c.id === emp.clienteId);
        for (const p of this.demo.parcelasPorEmprestimo[emp.id] || []) {
          const restante = p.valor - p.valorPago;
          if (restante <= 0) continue;
          const dias = diasEntre(new Date(p.vencimento), hoje());
          linhas.push({ ...p, cliente, emprestimoId: emp.id, diasAtraso: dias > 0 ? dias : 0, statusCalc: statusParcela(p) });
        }
      }
      return this._filtrarCobrancas(linhas, filtro);
    }
    const qs = new URLSearchParams({ filtro }).toString();
    return api.get(`/cobrancas?${qs}`);
  }

  _filtrarCobrancas(linhas, filtro) {
    const d0 = hoje();
    return linhas.filter((l) => {
      const dias = diasEntre(d0, new Date(l.vencimento));
      if (filtro === 'hoje') return dias === 0;
      if (filtro === 'amanha') return dias === 1;
      if (filtro === '7dias') return dias >= 0 && dias <= 7;
      if (filtro === '30dias') return dias >= 0 && dias <= 30;
      if (filtro === 'atrasadas') return dias < 0;
      return true;
    }).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  }

  async listarAtrasos() {
    const cobrancas = await this.listarCobrancas({ filtro: 'atrasadas' });
    const porCliente = new Map();
    for (const c of cobrancas) {
      const key = c.cliente?.id;
      if (!key) continue;
      if (!porCliente.has(key)) porCliente.set(key, { cliente: c.cliente, totalVencido: 0, qtdParcelas: 0, maiorAtraso: 0 });
      const item = porCliente.get(key);
      item.totalVencido += c.valor - c.valorPago;
      item.qtdParcelas += 1;
      item.maiorAtraso = Math.max(item.maiorAtraso, c.diasAtraso);
    }
    return [...porCliente.values()];
  }

  // ===== Lembretes =====
  async listarLembretes() {
    if (this.demoAtivo) return this.demo.lembretes.map((l) => ({ ...l, cliente: this.demo.clientes.find((c) => c.id === l.clienteId) }));
    return api.get('/lembretes');
  }
  async criarLembrete(dados) {
    if (this.demoAtivo) {
      const novo = { id: gerarId(), demo: true, concluido: false, ...dados };
      this.demo.lembretes.unshift(novo);
      this.emitir('mudou');
      return novo;
    }
    const novo = await api.post('/lembretes', dados);
    this.emitir('mudou');
    return novo;
  }
  async concluirLembrete(id) {
    if (this.demoAtivo) {
      const l = this.demo.lembretes.find((x) => x.id === id);
      if (l) l.concluido = true;
      this.emitir('mudou');
      return true;
    }
    await api.put(`/lembretes/${id}`, { concluido: true });
    this.emitir('mudou');
    return true;
  }
  async excluirLembrete(id) {
    if (this.demoAtivo) {
      this.demo.lembretes = this.demo.lembretes.filter((l) => l.id !== id);
      this.emitir('mudou');
      return true;
    }
    await api.del(`/lembretes/${id}`);
    this.emitir('mudou');
    return true;
  }

  // ===== Notificações =====
  async listarNotificacoes() {
    if (this.demoAtivo) return [...this.demo.notificacoes].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    return api.get('/notificacoes');
  }
  async criarNotificacao(dados) {
    if (this.demoAtivo) {
      const nova = { id: gerarId(), demo: true, lida: false, criadoEm: new Date().toISOString(), ...dados };
      this.demo.notificacoes.unshift(nova);
      this.emitir('mudou');
      return nova;
    }
    const nova = await api.post('/notificacoes', dados);
    this.emitir('mudou');
    return nova;
  }
  async marcarNotificacaoLida(id) {
    if (this.demoAtivo) {
      const n = this.demo.notificacoes.find((x) => x.id === id);
      if (n) n.lida = true;
      this.emitir('mudou');
      return true;
    }
    await api.put(`/notificacoes/${id}`, { lida: true });
    this.emitir('mudou');
    return true;
  }

  // ===== Metas =====
  async listarMetas() {
    if (this.demoAtivo) return this.demo.metas;
    return api.get('/metas');
  }
  async criarMeta(dados) {
    if (this.demoAtivo) {
      const nova = { id: gerarId(), demo: true, ...dados };
      this.demo.metas.unshift(nova);
      this.emitir('mudou');
      return nova;
    }
    const nova = await api.post('/metas', dados);
    this.emitir('mudou');
    return nova;
  }
  async excluirMeta(id) {
    if (this.demoAtivo) {
      this.demo.metas = this.demo.metas.filter((m) => m.id !== id);
      this.emitir('mudou');
      return true;
    }
    await api.del(`/metas/${id}`);
    this.emitir('mudou');
    return true;
  }
  async calcularProgressoMeta(meta) {
    if (this.demoAtivo) {
      const dentro = (data) => data >= meta.dataInicio && data <= meta.dataFim;
      if (meta.tipo === 'ganho') {
        const realizado = this.demo.pagamentos.filter((p) => dentro(p.data)).reduce((acc, p) => {
          const emp = this.demo.emprestimos.find((e) => e.id === p.emprestimoId);
          if (!emp) return acc;
          const proporcao = emp.ganhoPrevisto / emp.total;
          return acc + Math.round(p.valorRecebido * proporcao);
        }, 0);
        return realizado;
      }
      if (meta.tipo === 'capital_emprestado') {
        return this.demo.emprestimos.filter((e) => dentro(e.dataOperacao)).reduce((acc, e) => acc + e.capital, 0);
      }
      if (meta.tipo === 'recebimentos') {
        return this.demo.pagamentos.filter((p) => dentro(p.data)).reduce((acc, p) => acc + p.valorRecebido, 0);
      }
      if (meta.tipo === 'quantidade_operacoes') {
        return this.demo.emprestimos.filter((e) => dentro(e.dataOperacao)).length;
      }
      return 0;
    }
    return api.get(`/metas/${meta.id}/progresso`).then((r) => r.realizado);
  }

  // ===== Notas =====
  async listarNotas() {
    if (this.demoAtivo) return this.demo.notas.map((n) => ({ ...n, cliente: this.demo.clientes.find((c) => c.id === n.clienteId) })).sort((a, b) => (b.fixado - a.fixado) || b.criadoEm.localeCompare(a.criadoEm));
    return api.get('/notas');
  }
  async criarNota(dados) {
    if (this.demoAtivo) {
      const nova = { id: gerarId(), demo: true, criadoEm: new Date().toISOString().slice(0, 10), fixado: false, ...dados };
      this.demo.notas.unshift(nova);
      this.emitir('mudou');
      return nova;
    }
    const nova = await api.post('/notas', dados);
    this.emitir('mudou');
    return nova;
  }
  async atualizarNota(id, dados) {
    if (this.demoAtivo) {
      const i = this.demo.notas.findIndex((n) => n.id === id);
      if (i >= 0) this.demo.notas[i] = { ...this.demo.notas[i], ...dados };
      this.emitir('mudou');
      return true;
    }
    await api.put(`/notas/${id}`, dados);
    this.emitir('mudou');
    return true;
  }
  async excluirNota(id) {
    if (this.demoAtivo) {
      this.demo.notas = this.demo.notas.filter((n) => n.id !== id);
      this.emitir('mudou');
      return true;
    }
    await api.del(`/notas/${id}`);
    this.emitir('mudou');
    return true;
  }

  // ===== Dashboard agregado =====
  async obterDashboard({ inicio, fim } = {}) {
    if (this.demoAtivo) {
      const emprestimos = this.demo.emprestimos.filter((e) => e.status !== 'cancelado');
      const totalEmprestado = emprestimos.reduce((acc, e) => acc + (this._resumoEmprestimo(e).saldoRestante > 0 || e.status === 'quitado' ? e.capital : 0), 0);
      const totalContratado = emprestimos.reduce((acc, e) => acc + e.total, 0);
      const ganhoPrevisto = emprestimos.reduce((acc, e) => acc + e.ganhoPrevisto, 0);
      const noPeriodo = (data) => (!inicio || data >= inicio) && (!fim || data <= fim);
      const pagamentosPeriodo = this.demo.pagamentos.filter((p) => noPeriodo(p.data));
      const jaRecebido = pagamentosPeriodo.reduce((acc, p) => acc + p.valorRecebido, 0);
      const ganhoRealizado = pagamentosPeriodo.reduce((acc, p) => {
        const emp = this.demo.emprestimos.find((e) => e.id === p.emprestimoId);
        if (!emp) return acc;
        return acc + Math.round(p.valorRecebido * (emp.ganhoPrevisto / emp.total));
      }, 0);
      const totalAReceber = emprestimos.reduce((acc, e) => acc + this._resumoEmprestimo(e).saldoRestante, 0);
      let emAtraso = 0, qtdProximas = 0;
      for (const emp of emprestimos) {
        for (const p of this.demo.parcelasPorEmprestimo[emp.id] || []) {
          const restante = p.valor - p.valorPago;
          if (restante <= 0) continue;
          const dias = diasEntre(new Date(p.vencimento), hoje());
          if (dias > 0) emAtraso += restante;
          if (dias >= 0 && dias <= 7) qtdProximas += 1;
        }
      }
      const entradas = this.demo.movimentacoes.filter((m) => m.tipo === 'entrada' && noPeriodo(m.data)).reduce((a, m) => a + m.valor, 0);
      const saidas = this.demo.movimentacoes.filter((m) => m.tipo === 'saida' && noPeriodo(m.data)).reduce((a, m) => a + m.valor, 0);
      const capitalDisponivel = Math.max(0, entradas - saidas + 2000000);
      return {
        capitalDisponivel, totalEmprestado, totalAReceber, jaRecebido, ganhoPrevisto, ganhoRealizado,
        emAtraso, qtdProximas, entradas, saidas,
        proximasCobrancas: await this.listarCobrancas({ filtro: '7dias' }),
        emprestimosAndamento: emprestimos.filter((e) => e.status !== 'quitado').map((e) => this._resumoEmprestimo(e)),
      };
    }
    const qs = new URLSearchParams({ ...(inicio ? { inicio } : {}), ...(fim ? { fim } : {}) }).toString();
    return api.get(`/dashboard?${qs}`);
  }

  // ===== Busca global =====
  async buscarGlobal(termo) {
    if (!termo) return [];
    if (this.demoAtivo) {
      const t = termo.toLowerCase();
      return this.demo.clientes.filter((c) => c.nome.toLowerCase().includes(t)).map((c) => this._resumoCliente(c));
    }
    return api.get(`/busca?q=${encodeURIComponent(termo)}`);
  }
}

const loja = new Loja();

  Object.assign(window.CP, { loja, ErroAPI });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { icone, iniciais } = window.CP;

const ITENS_NAV = [
  { rota: 'dashboard', label: 'Início', icone: 'dashboard' },
  { rota: 'clientes', label: 'Clientes', icone: 'clientes' },
  { rota: 'emprestimos', label: 'Empréstimos', icone: 'emprestimos' },
  { rota: 'financeiro', label: 'Financeiro', icone: 'financeiro' },
  { rota: 'cobrancas', label: 'Cobranças', icone: 'cobrancas' },
  { rota: 'atrasos', label: 'Central de atrasos', icone: 'atrasos' },
  { rota: 'lembretes', label: 'Lembretes', icone: 'lembretes' },
  { rota: 'metas', label: 'Metas', icone: 'metas' },
  { rota: 'simulador', label: 'Simulador', icone: 'simulador' },
  { rota: 'notas', label: 'Notas', icone: 'notas' },
  { rota: 'relatorios', label: 'Relatórios', icone: 'relatorios' },
  { rota: 'configuracoes', label: 'Configurações', icone: 'config' },
];

const ITENS_MAIS = ['cobrancas', 'atrasos', 'lembretes', 'metas', 'simulador', 'notas', 'relatorios', 'configuracoes'];
const ITENS_BOTTOM = ['dashboard', 'clientes', 'emprestimos', 'financeiro'];

function renderSidebar(rotaAtual, usuario) {
  const nomeCurto = usuario?.nome || 'Usuário';
  return `
  <aside class="sidebar">
    <div class="marca">
      <div class="marca-icone">${icone('grafico', 20, '#052e21')}</div>
      <span>CredPlus</span>
    </div>
    <nav class="nav-lista">
      ${ITENS_NAV.map((item) => `
        <a href="#/${item.rota}" class="nav-item ${rotaAtual === item.rota ? 'ativo' : ''}">
          ${icone(item.icone, 19)}<span>${item.label}</span>
        </a>`).join('')}
    </nav>
    <div class="sidebar-rodape">
      <a href="#/configuracoes" class="usuario-mini">
        ${usuario?.foto ? `<img class="avatar" src="${usuario.foto}" alt="">` : `<div class="avatar">${iniciais(nomeCurto)}</div>`}
        <div>
          <div class="nome">${nomeCurto}</div>
          <div class="email">${usuario?.email || ''}</div>
        </div>
      </a>
    </div>
  </aside>`;
}

function renderTopbar(usuario, contadorNaoLidas) {
  return `
  <header class="topbar">
    <div class="busca-global">
      ${icone('busca', 18)}
      <input class="input" id="input-busca-global" placeholder="Buscar cliente, operação..." autocomplete="off">
      <div id="busca-resultados" class="busca-resultados oculto"></div>
    </div>
    <div class="topbar-acoes" id="topbar-acoes">
      <div class="notificacoes-wrap" id="notificacoes-wrap">
        <button class="btn-icone sino-wrap" id="btn-notificacoes" title="Notificações">
          ${icone('sino', 19)}
          <span class="sino-contador ${contadorNaoLidas > 0 ? '' : 'oculto'}" id="sino-contador">${contadorNaoLidas > 99 ? '99+' : contadorNaoLidas}</span>
        </button>
      </div>
      <a href="#/configuracoes" style="display:flex;align-items:center">
        ${usuario?.foto ? `<img class="avatar" src="${usuario.foto}" alt="">` : `<div class="avatar">${iniciais(usuario?.nome)}</div>`}
      </a>
      <button class="btn-icone" id="btn-sair-topo" title="Sair da conta">
        ${icone('logout', 19)}
      </button>
      <div class="notificacoes-dropdown oculto" id="notificacoes-dropdown">
        <div class="notificacoes-cabecalho">Notificações</div>
        <div class="notificacoes-lista" id="notificacoes-lista">
          <div class="notificacoes-vazio">Nenhuma notificação por enquanto.</div>
        </div>
      </div>
    </div>
  </header>`;
}

function renderBottomNav(rotaAtual) {
  const rotasVisiveis = ITENS_NAV.filter((i) => ITENS_BOTTOM.includes(i.rota));
  const emMais = ITENS_MAIS.includes(rotaAtual);
  return `
  <nav class="bottom-nav">
    <div class="bottom-nav-lista">
      ${rotasVisiveis.map((item) => `
        <a href="#/${item.rota}" class="bottom-nav-item ${rotaAtual === item.rota ? 'ativo' : ''}">
          ${icone(item.icone, 21)}<span>${item.label}</span>
        </a>`).join('')}
      <button class="bottom-nav-item ${emMais ? 'ativo' : ''}" id="btn-abrir-mais">
        ${icone('mais', 21)}<span>Mais</span>
      </button>
    </div>
  </nav>
  <button class="fab" id="btn-fab">${icone('mais2', 26)}</button>`;
}

function renderFolhaMais() {
  const itens = {
    cobrancas: ['cobrancas', 'Cobranças'], atrasos: ['atrasos', 'Central de atrasos'], lembretes: ['lembretes', 'Lembretes'],
    metas: ['metas', 'Metas'], simulador: ['simulador', 'Simulador'], notas: ['notas', 'Notas'],
    relatorios: ['relatorios', 'Relatórios'], configuracoes: ['configuracoes', 'Configurações'],
  };
  return `
  <div class="folha-mais" id="folha-mais">
    <div class="folha-mais-fundo" id="folha-mais-fundo"></div>
    <div class="folha-mais-caixa">
      <div class="folha-mais-alca"></div>
      ${ITENS_MAIS.map((rota) => `
        <a href="#/${rota}" class="folha-mais-item">${icone(ITENS_NAV.find((i) => i.rota === rota).icone, 20)}<span>${itens[rota][1]}</span></a>`).join('')}
    </div>
  </div>`;
}

function renderFabMenu() {
  const opcoes = [
    { acao: 'novo-cliente', label: 'Novo cliente', icone: 'clientes' },
    { acao: 'novo-emprestimo', label: 'Novo empréstimo', icone: 'emprestimos' },
    { acao: 'registrar-pagamento', label: 'Registrar pagamento', icone: 'check' },
    { acao: 'nova-movimentacao', label: 'Nova movimentação', icone: 'financeiro' },
    { acao: 'nova-nota', label: 'Nova nota', icone: 'notas' },
  ];
  return `
  <div class="fab-menu oculto" id="fab-menu">
    ${opcoes.map((o) => `<button class="fab-menu-item" data-acao-fab="${o.acao}">${icone(o.icone, 18)}<span>${o.label}</span></button>`).join('')}
  </div>`;
}

let containerToast;
function toast(mensagem, tipo = 'info') {
  if (!containerToast) {
    containerToast = document.createElement('div');
    containerToast.className = 'toast-wrap';
    document.body.appendChild(containerToast);
  }
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  const iconeNome = tipo === 'sucesso' ? 'check' : tipo === 'erro' ? 'x' : 'info';
  el.innerHTML = `${icone(iconeNome, 16)}<span>${mensagem}</span>`;
  containerToast.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function abrirModal({ titulo, corpoHtml, rodapeHtml = '', tamanho = '' }) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `
    <div class="modal-caixa ${tamanho === 'lg' ? 'modal-lg' : ''}">
      <div class="modal-cabecalho">
        <h3>${titulo}</h3>
        <button class="btn-icone" id="fechar-modal">${icone('fechar', 18)}</button>
      </div>
      <div class="modal-corpo">${corpoHtml}</div>
      ${rodapeHtml ? `<div class="modal-rodape">${rodapeHtml}</div>` : ''}
    </div>`;
  document.body.appendChild(fundo);
  const fechar = () => fundo.remove();
  fundo.querySelector('#fechar-modal').addEventListener('click', fechar);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', onEsc); } });
  return { elemento: fundo, fechar };
}

function confirmarAcao({ titulo, mensagem, textoConfirmar = 'Confirmar', perigo = true }) {
  return new Promise((resolve) => {
    const { elemento, fechar } = abrirModal({
      titulo,
      corpoHtml: `<p style="color:var(--cinza-700);line-height:1.6">${mensagem}</p>`,
      rodapeHtml: `
        <button class="btn btn-secundario" id="btn-cancelar-confirm">Cancelar</button>
        <button class="btn ${perigo ? 'btn-perigo-solido' : 'btn-primario'}" id="btn-confirmar-confirm">${textoConfirmar}</button>`,
    });
    elemento.querySelector('#btn-cancelar-confirm').addEventListener('click', () => { fechar(); resolve(false); });
    elemento.querySelector('#btn-confirmar-confirm').addEventListener('click', () => { fechar(); resolve(true); });
  });
}

function badgeStatus(texto, cor) {
  return `<span class="badge badge-${cor}">${texto}</span>`;
}

function estadoVazio({ iconeNome = 'info', titulo, descricao, acaoHtml = '' }) {
  return `
  <div class="vazio-estado">
    <div class="icone-vazio">${icone(iconeNome, 28)}</div>
    <h3>${titulo}</h3>
    <p>${descricao}</p>
    ${acaoHtml}
  </div>`;
}

function estadoCarregando() {
  return `<div class="carregando"><div class="spinner"></div></div>`;
}

function faixaDemo() {
  return `
  <div class="faixa-demo" id="faixa-demo">
    <span>${icone('info', 15)} Você está no modo demonstração — estes dados são fictícios e não afetam sua conta real.</span>
    <button class="btn btn-sm btn-secundario" id="btn-sair-demo">Sair da demonstração</button>
  </div>`;
}

  Object.assign(window.CP, {
    ITENS_NAV, ITENS_MAIS, ITENS_BOTTOM, renderSidebar, renderTopbar, renderBottomNav, renderFolhaMais,
    renderFabMenu, toast, abrirModal, confirmarAcao, badgeStatus, estadoVazio, estadoCarregando, faixaDemo,
  });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { auth, salvarToken, ErroAPI, icone, toast, escapeHtml } = window.CP;

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function renderLogin(container, { aoAutenticar, irParaRegistro, aoEntrarDemo }) {
  container.innerHTML = `
  <div class="auth-tela">
    <div class="auth-painel-visual">
      <div class="marca"><div class="marca-icone">${icone('grafico', 20, '#052e21')}</div><span>CredPlus</span></div>
      <div>
        <h1 class="slogan-grande">Seu controle.<br>Mais resultados.</h1>
        <p class="slogan-sub">Gerencie clientes, empréstimos, cobranças e sua rentabilidade em um único lugar, com seus dados sempre sincronizados entre computador e celular.</p>
      </div>
      <div class="auth-rodape-visual">© ${new Date().getFullYear()} CredPlus — Gestão financeira privada</div>
    </div>
    <div class="auth-painel-form">
      <div class="auth-card">
        <h2 style="font-size:26px;margin-bottom:6px">Bem-vindo de volta</h2>
        <p class="texto-mudo" style="margin-bottom:26px">Entre com sua conta para continuar.</p>
        <div id="area-alerta-login"></div>
        <form id="form-login">
          <div class="campo">
            <label>E-mail</label>
            <input class="input" type="email" id="login-email" placeholder="voce@email.com" required autocomplete="username">
          </div>
          <div class="campo">
            <label>Senha</label>
            <div class="campo-input-wrap">
              <input class="input" type="password" id="login-senha" placeholder="Sua senha" required autocomplete="current-password">
              <button type="button" class="botao-olho" id="btn-olho-senha">${icone('olho', 19)}</button>
            </div>
          </div>
          <div class="flex justify-between items-center" style="margin-bottom:22px">
            <label class="checkbox-linha"><input type="checkbox" id="login-lembrar" checked> Lembrar acesso</label>
            <a href="#/esqueci-senha" class="link-verde texto-sm">Esqueci minha senha</a>
          </div>
          <button type="submit" class="btn btn-primario btn-bloco" id="btn-entrar">Entrar</button>
        </form>
        <button type="button" class="btn btn-secundario btn-bloco" id="btn-entrar-demo" style="margin-top:12px">${icone('grafico', 16)} Explorar em modo demonstração</button>
        <p style="text-align:center;margin-top:22px;font-size:13.5px" class="texto-mudo">
          Ainda não tem conta? <a href="#" id="link-registro" class="link-verde">Criar conta</a>
        </p>
      </div>
    </div>
  </div>`;

  const inputSenha = container.querySelector('#login-senha');
  container.querySelector('#btn-olho-senha').addEventListener('click', (e) => {
    const mostrando = inputSenha.type === 'text';
    inputSenha.type = mostrando ? 'password' : 'text';
    e.currentTarget.innerHTML = icone(mostrando ? 'olho' : 'olhoFechado', 19);
  });

  container.querySelector('#link-registro').addEventListener('click', (e) => { e.preventDefault(); irParaRegistro(); });
  container.querySelector('#btn-entrar-demo').addEventListener('click', () => aoEntrarDemo());

  container.querySelector('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = container.querySelector('#login-email').value.trim();
    const senha = container.querySelector('#login-senha').value;
    const lembrar = container.querySelector('#login-lembrar').checked;
    const areaAlerta = container.querySelector('#area-alerta-login');
    const btn = container.querySelector('#btn-entrar');
    areaAlerta.innerHTML = '';

    if (!validarEmail(email)) {
      areaAlerta.innerHTML = `<div class="alerta alerta-erro">${icone('info', 16)} Informe um e-mail válido.</div>`;
      return;
    }
    if (!senha) {
      areaAlerta.innerHTML = `<div class="alerta alerta-erro">${icone('info', 16)} Informe sua senha.</div>`;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      const resposta = await auth.login(email, senha);
      salvarToken(resposta.token, lembrar);
      aoAutenticar(resposta.usuario);
    } catch (err) {
      const msg = err instanceof ErroAPI && err.status === 401
        ? 'E-mail ou senha incorretos. Verifique e tente novamente.'
        : (err.message || 'Não foi possível entrar. Tente novamente em instantes.');
      areaAlerta.innerHTML = `<div class="alerta alerta-erro">${icone('info', 16)} ${msg}</div>`;
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
}

function renderRegistro(container, { aoRegistrar, irParaLogin }) {
  container.innerHTML = `
  <div class="auth-tela">
    <div class="auth-painel-visual">
      <div class="marca"><div class="marca-icone">${icone('grafico', 20, '#052e21')}</div><span>CredPlus</span></div>
      <div>
        <h1 class="slogan-grande">Organize sua carteira de clientes com clareza.</h1>
        <p class="slogan-sub">Crie sua conta e comece a controlar empréstimos, recebimentos e metas hoje mesmo.</p>
      </div>
      <div class="auth-rodape-visual">© ${new Date().getFullYear()} CredPlus — Gestão financeira privada</div>
    </div>
    <div class="auth-painel-form">
      <div class="auth-card">
        <h2 style="font-size:26px;margin-bottom:6px">Criar conta</h2>
        <p class="texto-mudo" style="margin-bottom:26px">Leva menos de um minuto.</p>
        <div id="area-alerta-registro"></div>
        <form id="form-registro">
          <div class="campo"><label>Nome completo</label><input class="input" id="reg-nome" required></div>
          <div class="campo"><label>E-mail</label><input class="input" type="email" id="reg-email" required></div>
          <div class="campo"><label>Senha</label><input class="input" type="password" id="reg-senha" required minlength="6"></div>
          <div class="campo"><label>Confirmar senha</label><input class="input" type="password" id="reg-confirmar" required minlength="6"></div>
          <div class="campo"><label>Pergunta de recuperação</label><select class="select" id="reg-pergunta" required></select></div>
          <div class="campo"><label>Resposta secreta</label><input class="input" id="reg-resposta" required minlength="3" autocomplete="off" placeholder="Usada para recuperar sua senha"><p class="texto-xs texto-mudo" style="margin-top:6px">Só você sabe — guardamos apenas uma versão protegida dela.</p></div>
          <button type="submit" class="btn btn-primario btn-bloco" id="btn-criar-conta">Criar conta</button>
        </form>
        <p style="text-align:center;margin-top:22px;font-size:13.5px" class="texto-mudo">
          Já tem conta? <a href="#" id="link-login" class="link-verde">Entrar</a>
        </p>
      </div>
    </div>
  </div>`;

  container.querySelector('#link-login').addEventListener('click', (e) => { e.preventDefault(); irParaLogin(); });
  container.querySelector('#reg-pergunta').innerHTML = window.CP.opcoesPerguntasQuestionario('');

  container.querySelector('#form-registro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = container.querySelector('#reg-nome').value.trim();
    const email = container.querySelector('#reg-email').value.trim();
    const senha = container.querySelector('#reg-senha').value;
    const confirmar = container.querySelector('#reg-confirmar').value;
    const pergunta = container.querySelector('#reg-pergunta').value;
    const resposta = container.querySelector('#reg-resposta').value;
    const areaAlerta = container.querySelector('#area-alerta-registro');
    areaAlerta.innerHTML = '';

    if (nome.length < 3) return areaAlerta.innerHTML = `<div class="alerta alerta-erro">Informe seu nome completo.</div>`;
    if (!validarEmail(email)) return areaAlerta.innerHTML = `<div class="alerta alerta-erro">Informe um e-mail válido.</div>`;
    if (senha.length < 6) return areaAlerta.innerHTML = `<div class="alerta alerta-erro">A senha deve ter ao menos 6 caracteres.</div>`;
    if (senha !== confirmar) return areaAlerta.innerHTML = `<div class="alerta alerta-erro">As senhas não coincidem.</div>`;
    if (!window.CP.PERGUNTAS_RECUPERACAO.includes(pergunta)) return areaAlerta.innerHTML = `<div class="alerta alerta-erro">Escolha uma pergunta de recuperação.</div>`;
    if (resposta.trim().length < 3) return areaAlerta.innerHTML = `<div class="alerta alerta-erro">A resposta secreta deve ter ao menos 3 caracteres.</div>`;

    const btn = container.querySelector('#btn-criar-conta');
    btn.disabled = true;
    btn.textContent = 'Criando conta...';
    try {
      const resposta2 = await auth.registrar(nome, email, senha, pergunta, resposta);
      if (resposta2?.token) {
        salvarToken(resposta2.token, true);
        aoRegistrar(resposta2.usuario);
      } else {
        toast('Conta criada! Faça login para continuar.', 'sucesso');
        irParaLogin();
      }
    } catch (err) {
      const msg = err instanceof ErroAPI && err.status === 404
        ? 'Cadastro de novas contas ainda não está disponível neste servidor.'
        : (err.message || 'Não foi possível criar a conta agora.');
      areaAlerta.innerHTML = `<div class="alerta alerta-erro">${msg}</div>`;
      btn.disabled = false;
      btn.textContent = 'Criar conta';
    }
  });
}

function renderEsqueciSenha(container, { irParaLogin }) {
  // Recuperação por pergunta secreta (sem e-mail): 3 etapas no mesmo cartão.
  // Etapa 1: e-mail -> Etapa 2: pergunta + resposta -> Etapa 3: nova senha.
  let etapa = 1;
  let emailRec = '';
  let perguntaRec = '';

  function moldura(titulo, subtitulo, corpoHtml) {
    container.innerHTML = `
    <div class="auth-tela">
      <div class="auth-painel-visual">
        <div class="marca"><div class="marca-icone">${icone('grafico', 20, '#052e21')}</div><span>CredPlus</span></div>
        <h1 class="slogan-grande">Vamos recuperar seu acesso.</h1>
      </div>
      <div class="auth-painel-form">
        <div class="auth-card">
          <div class="texto-sm texto-mudo" style="margin-bottom:8px">Etapa ${etapa} de 3</div>
          <h2 style="font-size:26px;margin-bottom:6px">${titulo}</h2>
          <p class="texto-mudo" style="margin-bottom:26px">${subtitulo}</p>
          <div id="area-alerta-recuperar"></div>
          ${corpoHtml}
          <p style="text-align:center;margin-top:22px;font-size:13.5px" class="texto-mudo">
            <a href="#" id="link-voltar-login" class="link-verde">Voltar para o login</a>
          </p>
        </div>
      </div>
    </div>`;
    container.querySelector('#link-voltar-login').addEventListener('click', (e) => { e.preventDefault(); irParaLogin(); });
  }

  function alerta(msg, tipo) {
    container.querySelector('#area-alerta-recuperar').innerHTML =
      `<div class="alerta alerta-${tipo || 'erro'}">${msg}</div>`;
  }

  function etapa1() {
    etapa = 1;
    moldura('Recuperar senha', 'Informe o e-mail da sua conta.', `
      <form id="form-recuperar">
        <div class="campo"><label>E-mail</label><input class="input" type="email" id="rec-email" required></div>
        <button type="submit" class="btn btn-primario btn-bloco" id="btn-rec-1">Continuar</button>
      </form>`);
    container.querySelector('#form-recuperar').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = container.querySelector('#rec-email').value.trim();
      if (!validarEmail(email)) { alerta('Informe um e-mail válido.'); return; }
      const btn = container.querySelector('#btn-rec-1');
      btn.disabled = true;
      btn.textContent = 'Verificando...';
      try {
        const r = await auth.recuperarPergunta(email);
        emailRec = email;
        perguntaRec = r.pergunta;
        etapa2();
      } catch (err) {
        alerta(err.message || 'Não foi possível continuar. Tente novamente.');
        btn.disabled = false;
        btn.textContent = 'Continuar';
      }
    });
  }

  function etapa2() {
    etapa = 2;
    moldura('Pergunta de segurança', 'Responda para confirmar que é você.', `
      <form id="form-recuperar">
        <div class="campo"><label>Sua pergunta</label><div class="input" style="background:var(--cinza-100)">${escapeHtml(perguntaRec)}</div></div>
        <div class="campo"><label>Resposta secreta</label><input class="input" id="rec-resposta" autocomplete="off" required></div>
        <button type="submit" class="btn btn-primario btn-bloco" id="btn-rec-2">Verificar resposta</button>
      </form>`);
    container.querySelector('#form-recuperar').addEventListener('submit', (e) => {
      e.preventDefault();
      const resposta = container.querySelector('#rec-resposta').value;
      if (!resposta.trim()) { alerta('Informe a resposta secreta.'); return; }
      container.querySelector('#form-recuperar').dataset.resposta = resposta;
      etapa3();
    });
  }

  function etapa3() {
    etapa = 3;
    const resposta = container.querySelector('#form-recuperar')?.dataset.resposta || '';
    moldura('Nova senha', 'Escolha uma senha nova para sua conta.', `
      <form id="form-recuperar">
        <div class="campo"><label>Nova senha</label><input class="input" type="password" id="rec-nova" minlength="6" required></div>
        <div class="campo"><label>Confirmar nova senha</label><input class="input" type="password" id="rec-confirmar" minlength="6" required></div>
        <button type="submit" class="btn btn-primario btn-bloco" id="btn-rec-3">Alterar senha</button>
      </form>`);
    container.querySelector('#form-recuperar').dataset.resposta = resposta;
    container.querySelector('#form-recuperar').addEventListener('submit', async (e) => {
      e.preventDefault();
      const resp = e.target.dataset.resposta || '';
      const nova = container.querySelector('#rec-nova').value;
      const confirmar = container.querySelector('#rec-confirmar').value;
      if (nova.length < 6) { alerta('A nova senha deve ter ao menos 6 caracteres.'); return; }
      if (nova !== confirmar) { alerta('As senhas não coincidem.'); return; }
      const btn = container.querySelector('#btn-rec-3');
      btn.disabled = true;
      btn.textContent = 'Alterando...';
      try {
        await auth.redefinirSenha(emailRec, resp, nova);
        etapa = 3;
        moldura('Senha alterada', 'Tudo certo! Entre com sua nova senha.', `
          <div class="alerta alerta-sucesso">Sua senha foi alterada com sucesso.</div>
          <button class="btn btn-primario btn-bloco" id="btn-ir-login">Ir para o login</button>`);
        container.querySelector('#btn-ir-login').addEventListener('click', () => irParaLogin());
      } catch (err) {
        alerta(err.message || 'Não foi possível alterar a senha.');
        btn.disabled = false;
        btn.textContent = 'Alterar senha';
      }
    });
  }

  etapa1();
}

  Object.assign(window.CP, { renderLogin, renderRegistro, renderEsqueciSenha });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarMoeda, formatarData, diasEntre, hoje, somarDias, dataParaISO, icone, estadoCarregando, estadoVazio, badgeStatus, toast } = window.CP;

const PERIODOS = [
  { id: 'hoje', label: 'Hoje' }, { id: '7dias', label: 'Últimos 7 dias' }, { id: '15dias', label: 'Últimos 15 dias' },
  { id: '30dias', label: 'Últimos 30 dias' }, { id: 'mes', label: 'Este mês' }, { id: 'ano', label: 'Este ano' },
];

function calcularIntervalo(periodo) {
  const fim = hoje();
  let inicio;
  if (periodo === 'hoje') inicio = fim;
  else if (periodo === '7dias') inicio = somarDias(fim, -6);
  else if (periodo === '15dias') inicio = somarDias(fim, -14);
  else if (periodo === '30dias') inicio = somarDias(fim, -29);
  else if (periodo === 'mes') inicio = new Date(fim.getFullYear(), fim.getMonth(), 1);
  else if (periodo === 'ano') inicio = new Date(fim.getFullYear(), 0, 1);
  else inicio = somarDias(fim, -29);
  return { inicio: dataParaISO(inicio), fim: dataParaISO(fim) };
}

function cardKpi({ titulo, valor, desc, iconeNome, cor, badge }) {
  return `
  <div class="card card-kpi">
    <div class="flex justify-between items-center">
      <div class="icone-kpi" style="background:var(--${cor}-bg,var(--verde-bg));color:var(--${cor},var(--verde-esmeralda))">${icone(iconeNome, 20)}</div>
      ${badge || ''}
    </div>
    <div class="card-titulo">${titulo}</div>
    <div class="valor">${valor}</div>
    <div class="desc">${desc}</div>
  </div>`;
}

// ═══ Melhoria visual/analítica do Dashboard — gráficos (Chart.js) ═══
// Não recalcula nenhuma métrica: consome exatamente os campos já
// aprovados na Etapa 9 (d.entradas/d.saidas/d.totalEmprestado/
// d.ganhoPrevisto/d.ganhoRealizado) mais os dois campos aditivos
// (d.fluxoSerie, d.carteira) que o backend passou a fornecer.
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function granularidadeSerie(serie) {
  if (!serie || serie.length < 2) return 'dia';
  const a = new Date(serie[0].data + 'T00:00:00Z').getTime();
  const b = new Date(serie[1].data + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000) > 1 ? 'mes' : 'dia';
}

function rotuloFluxo(dataISO, granularidade) {
  const partes = dataISO.split('-').map(Number);
  const y = partes[0], m = partes[1], d2 = partes[2];
  if (granularidade === 'mes') return MESES_ABREV[m - 1] + '/' + String(y).slice(2);
  return String(d2).padStart(2, '0') + '/' + String(m).padStart(2, '0');
}

function gradienteArea(context, rgb) {
  const chart = context.chart;
  const ctx = chart.ctx;
  const chartArea = chart.chartArea;
  if (!chartArea) return 'rgba(0,0,0,0)';
  const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, 'rgba(' + rgb + ',0.28)');
  g.addColorStop(1, 'rgba(' + rgb + ',0.02)');
  return g;
}

const pluginTextoCentralCarteira = {
  id: 'textoCentralCredPlus',
  afterDraw: function (chart) {
    const plugins = chart.config.options.plugins || {};
    const cfg = plugins.textoCentral;
    if (!cfg) return;
    const ctx = chart.ctx;
    const area = chart.chartArea;
    const cx = (area.left + area.right) / 2;
    const cy = (area.top + area.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = "800 17px 'Plus Jakarta Sans', sans-serif"; ctx.fillStyle = '#111614';
    ctx.fillText(cfg.texto, cx, cy - 9);
    ctx.font = "600 10.5px 'Plus Jakarta Sans', sans-serif"; ctx.fillStyle = '#78827e';
    ctx.fillText(cfg.sub, cx, cy + 11);
    ctx.restore();
  },
};

function montarGraficoFluxo(canvas, serie, fmtMoeda) {
  const granularidade = granularidadeSerie(serie);
  const labels = serie.map(function (p) { return rotuloFluxo(p.data, granularidade); });
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label: 'Entradas', data: serie.map(function (p) { return p.entradas; }), borderColor: '#10b981', backgroundColor: function (c) { return gradienteArea(c, '16,185,129'); }, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.5 },
        { label: 'Saídas', data: serie.map(function (p) { return p.saidas; }), borderColor: '#e2493d', backgroundColor: function (c) { return gradienteArea(c, '226,73,61'); }, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.5 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 450 },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { family: "'Plus Jakarta Sans'", size: 12 }, color: '#3f4744' } },
        tooltip: { backgroundColor: '#052e21', padding: 10, cornerRadius: 8, callbacks: { label: function (ctx) { return ctx.dataset.label + ': ' + fmtMoeda(ctx.raw); } } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#78827e', font: { size: 11 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 14 } },
        y: { grid: { color: '#eef1f0' }, ticks: { color: '#78827e', font: { size: 11 }, callback: function (v) { return fmtMoeda(v); } } },
      },
    },
  });
}

function montarGraficoCarteira(canvas, carteira, fmtMoeda) {
  return new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Recebido', 'A receber em dia', 'Em atraso'],
      datasets: [{ data: [carteira.recebido, carteira.aReceberEmDia, carteira.emAtraso], backgroundColor: ['#10b981', '#2f6fed', '#e2493d'], borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      animation: { duration: 450 },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11.5 }, color: '#3f4744' } },
        tooltip: {
          backgroundColor: '#052e21', padding: 10, cornerRadius: 8,
          callbacks: {
            label: function (ctx) {
              const pct = carteira.total > 0 ? Math.round((ctx.raw / carteira.total) * 100) : 0;
              return ctx.label + ': ' + fmtMoeda(ctx.raw) + ' (' + pct + '%)';
            },
          },
        },
        textoCentral: { texto: fmtMoeda(carteira.total), sub: 'Total contratado' },
      },
    },
    plugins: [pluginTextoCentralCarteira],
  });
}

function montarGraficoResultado(canvas, d, fmtMoeda) {
  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Capital emprestado', 'Ganho previsto', 'Ganho realizado'],
      datasets: [{ data: [d.totalEmprestado, d.ganhoPrevisto, d.ganhoRealizado], backgroundColor: ['#2f6fed', '#34d399', '#10b981'], borderRadius: 8, maxBarThickness: 64 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 450 },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#052e21', padding: 10, cornerRadius: 8, callbacks: { label: function (ctx) { return fmtMoeda(ctx.raw); } } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#3f4744', font: { size: 12, weight: '600' } } },
        y: { grid: { color: '#eef1f0' }, ticks: { color: '#78827e', font: { size: 11 }, callback: function (v) { return fmtMoeda(v); } } },
      },
    },
  });
}

async function renderDashboard(container, { usuario, navegar, abrirNovoCliente, abrirNovoEmprestimo, abrirRegistrarPagamento }) {
  container.innerHTML = estadoCarregando();
  let periodoAtual = 'mes';
  let chartFluxo = null, chartCarteira = null, chartResultado = null;

  async function carregar() {
    const { inicio, fim } = calcularIntervalo(periodoAtual);
    let dados;
    try {
      dados = await loja.obterDashboard({ inicio, fim });
    } catch (err) {
      if (err instanceof ErroAPI) {
        container.innerHTML = estadoVazio({
          iconeNome: 'dashboard',
          titulo: 'Ainda não há dados para exibir',
          descricao: err.status === 404
            ? 'O endpoint de dashboard ainda não existe no backend. Ative a demonstração para visualizar o painel com dados fictícios, ou aguarde a implementação do endpoint GET /api/dashboard.'
            : err.message,
          acaoHtml: `<button class="btn btn-primario" id="btn-ativar-demo-dash" style="margin-top:14px">Carregar dados de demonstração</button>`,
        });
        container.querySelector('#btn-ativar-demo-dash')?.addEventListener('click', () => {
          loja.ativarDemo();
          toast('Modo demonstração ativado.', 'sucesso');
          carregar();
        });
        return;
      }
      throw err;
    }
    const metas = await loja.listarMetas().catch(() => []);
    const metaPrincipal = metas[0];
    const progressoMeta = metaPrincipal ? await loja.calcularProgressoMeta(metaPrincipal) : 0;
    render(dados, metaPrincipal, progressoMeta);
  }

  function render(d, metaPrincipal, progressoMeta) {
    const temFluxo = d.entradas > 0 || d.saidas > 0;
    const temCarteira = !!(d.carteira && d.carteira.total > 0);
    const temResultado = (d.totalEmprestado + d.ganhoPrevisto + d.ganhoRealizado) > 0;
    container.innerHTML = `
    <div class="pagina-cabecalho">
      <div>
        <h1 class="pagina-titulo">Olá, ${usuario?.nome?.split(' ')[0] || ''}! 👋</h1>
        <p class="pagina-subtitulo">Aqui está o resumo do seu dia.</p>
      </div>
      <select class="select" id="seletor-periodo" style="max-width:210px">
        ${PERIODOS.map((p) => `<option value="${p.id}" ${p.id === periodoAtual ? 'selected' : ''}>${p.label}</option>`).join('')}
      </select>
    </div>

    <div class="grid grid-4" style="margin-bottom:20px">
      ${cardKpi({ titulo: 'CAPITAL DISPONÍVEL', valor: formatarMoeda(d.capitalDisponivel), desc: 'Dinheiro disponível para novas operações.', iconeNome: 'cifrao', cor: 'verde-esmeralda' })}
      ${cardKpi({ titulo: 'TOTAL EMPRESTADO', valor: formatarMoeda(d.totalEmprestado), desc: 'Capital atualmente aplicado em operações abertas.', iconeNome: 'emprestimos', cor: 'azul' })}
      ${cardKpi({ titulo: 'TOTAL A RECEBER', valor: formatarMoeda(d.totalAReceber), desc: 'Saldo contratual ainda pendente dos clientes.', iconeNome: 'relogio', cor: 'amarelo' })}
      ${cardKpi({ titulo: 'JÁ RECEBIDO', valor: formatarMoeda(d.jaRecebido), desc: 'Total efetivamente recebido no período.', iconeNome: 'check', cor: 'verde-esmeralda' })}
    </div>
    <div class="grid grid-4" style="margin-bottom:20px">
      ${cardKpi({ titulo: 'GANHO PREVISTO', valor: formatarMoeda(d.ganhoPrevisto), desc: 'Diferença entre capital emprestado e valor contratado.', iconeNome: 'grafico', cor: 'verde-esmeralda' })}
      ${cardKpi({ titulo: 'GANHO REALIZADO', valor: formatarMoeda(d.ganhoRealizado), desc: 'Parcela do ganho já efetivamente realizada.', iconeNome: 'estrela', cor: 'verde-esmeralda' })}
      ${cardKpi({ titulo: 'EM ATRASO', valor: formatarMoeda(d.emAtraso), desc: 'Valor de parcelas vencidas e não quitadas.', iconeNome: 'atrasos', cor: 'vermelho' })}
      ${cardKpi({ titulo: 'PRÓXIMAS COBRANÇAS', valor: String(d.qtdProximas), desc: 'Cobranças previstas para os próximos 7 dias.', iconeNome: 'cobrancas', cor: 'azul' })}
    </div>

    <div class="grid grid-3" style="margin-bottom:20px;align-items:stretch">
      <div class="card card-span2">
        <div class="card-titulo">Fluxo financeiro</div>
        <div class="flex gap-24 resumo-fluxo" style="margin:12px 0 14px">
          <div><div class="texto-xs texto-mudo">ENTRADAS</div><div style="font-size:19px;font-weight:800" class="texto-positivo">${formatarMoeda(d.entradas)}</div></div>
          <div><div class="texto-xs texto-mudo">SAÍDAS</div><div style="font-size:19px;font-weight:800" class="texto-negativo">${formatarMoeda(d.saidas)}</div></div>
          <div><div class="texto-xs texto-mudo">SALDO</div><div style="font-size:19px;font-weight:800">${formatarMoeda(d.entradas - d.saidas)}</div></div>
        </div>
        <div class="grafico-alto" id="wrap-grafico-fluxo">
          ${temFluxo ? '<canvas id="grafico-fluxo"></canvas>' : estadoVazio({ iconeNome: 'financeiro', titulo: 'Sem movimentações', descricao: 'Ainda não há movimentações neste período.' })}
        </div>
      </div>
      <div class="card">
        <div class="card-titulo" style="margin-bottom:6px">Carteira financeira</div>
        <div class="grafico-donut-wrap" id="wrap-grafico-carteira">
          ${temCarteira ? '<canvas id="grafico-carteira"></canvas>' : estadoVazio({ iconeNome: 'financeiro', titulo: 'Sem operações', descricao: 'Cadastre um empréstimo para ver a composição da carteira.' })}
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:20px;align-items:stretch">
      <div class="card">
        <div class="card-titulo" style="margin-bottom:10px">Resultado dos empréstimos</div>
        <div class="grafico-medio" id="wrap-grafico-resultado">
          ${temResultado ? '<canvas id="grafico-resultado"></canvas>' : estadoVazio({ iconeNome: 'grafico', titulo: 'Sem operações', descricao: 'Cadastre um empréstimo para ver o resultado.' })}
        </div>
      </div>
      <div class="card">
        <div class="flex justify-between items-center" style="margin-bottom:10px">
          <div class="card-titulo">Meta atual</div>
          <a href="#/metas" class="texto-sm link-verde">Ver todas</a>
        </div>
        ${metaPrincipal ? renderResumoMeta(metaPrincipal, progressoMeta) : `<p class="texto-mudo texto-sm">Nenhuma meta cadastrada ainda.</p><a href="#/metas" class="btn btn-sm btn-secundario" style="margin-top:10px">Criar meta</a>`}
      </div>
    </div>

    <div class="grid grid-2" style="align-items:start">
      <div class="card">
        <div class="flex justify-between items-center" style="margin-bottom:14px">
          <div class="card-titulo">Próximas cobranças</div>
          <a href="#/cobrancas" class="texto-sm link-verde">Ver todas</a>
        </div>
        ${d.proximasCobrancas?.length ? d.proximasCobrancas.slice(0, 5).map((c) => renderLinhaCobranca(c)).join('') : estadoVazio({ iconeNome: 'cobrancas', titulo: 'Sem cobranças próximas', descricao: 'Nenhuma parcela vence nos próximos dias.' })}
      </div>
      <div class="card">
        <div class="flex justify-between items-center" style="margin-bottom:14px">
          <div class="card-titulo">Empréstimos em andamento</div>
          <a href="#/emprestimos" class="texto-sm link-verde">Ver todos</a>
        </div>
        ${d.emprestimosAndamento?.length ? d.emprestimosAndamento.slice(0, 5).map((e) => renderLinhaEmprestimo(e)).join('') : estadoVazio({ iconeNome: 'emprestimos', titulo: 'Nenhum empréstimo em andamento', descricao: 'Cadastre sua primeira operação para começar.' })}
      </div>
    </div>`;

    container.querySelector('#seletor-periodo').addEventListener('change', (e) => { periodoAtual = e.target.value; carregar(); });
    montarGraficos(d, { temFluxo, temCarteira, temResultado });
  }

  function montarGraficos(d, flags) {
    if (chartFluxo) { chartFluxo.destroy(); chartFluxo = null; }
    if (chartCarteira) { chartCarteira.destroy(); chartCarteira = null; }
    if (chartResultado) { chartResultado.destroy(); chartResultado = null; }
    if (typeof Chart === 'undefined') return;
    if (flags.temFluxo) {
      const canvas = container.querySelector('#grafico-fluxo');
      if (canvas) chartFluxo = montarGraficoFluxo(canvas, d.fluxoSerie || [], formatarMoeda);
    }
    if (flags.temCarteira) {
      const canvas = container.querySelector('#grafico-carteira');
      if (canvas) chartCarteira = montarGraficoCarteira(canvas, d.carteira, formatarMoeda);
    }
    if (flags.temResultado) {
      const canvas = container.querySelector('#grafico-resultado');
      if (canvas) chartResultado = montarGraficoResultado(canvas, d, formatarMoeda);
    }
  }

  function renderResumoMeta(meta, realizado) {
    const pct = Math.min(100, Math.round((realizado / meta.valorAlvo) * 100));
    return `
    <div class="texto-sm" style="font-weight:700;margin-bottom:6px">${meta.titulo}</div>
    <div class="barra-progresso" style="margin-bottom:8px"><div class="barra-progresso-preenchida" style="width:${pct}%"></div></div>
    <div class="flex justify-between texto-xs texto-mudo">
      <span>Realizado: ${formatarMoeda(realizado)}</span><span>${pct}%</span>
    </div>
    <div class="texto-xs texto-mudo" style="margin-top:4px">Meta: ${formatarMoeda(meta.valorAlvo)} · Faltam ${formatarMoeda(Math.max(0, meta.valorAlvo - realizado))}</div>`;
  }

  function renderLinhaCobranca(c) {
    const dias = diasEntre(new Date(c.vencimento), hoje());
    const atrasado = dias < 0;
    return `
    <div class="pessoa-linha justify-between" style="padding:10px 0;border-top:1px solid var(--cinza-100)">
      <div class="pessoa-info">
        <div class="nome">${c.cliente?.nome || '—'}</div>
        <div class="sub">${formatarMoeda(c.valor - (c.valorPago || 0))} · vence ${formatarData(c.vencimento)}</div>
      </div>
      ${atrasado ? badgeStatus(`${Math.abs(dias)}d atraso`, 'vermelho') : badgeStatus(dias === 0 ? 'Hoje' : `Em ${dias}d`, dias === 0 ? 'amarelo' : 'cinza')}
    </div>`;
  }

  function renderLinhaEmprestimo(e) {
    return `
    <div style="padding:10px 0;border-top:1px solid var(--cinza-100)">
      <div class="flex justify-between items-center">
        <div class="nome" style="font-weight:700;font-size:14px">${e.cliente?.nome || '—'}</div>
        ${badgeStatus(e.statusCalculado === 'atraso' ? 'Em atraso' : 'Em dia', e.statusCalculado === 'atraso' ? 'vermelho' : 'verde')}
      </div>
      <div class="texto-xs texto-mudo" style="margin-top:4px">Saldo restante: ${formatarMoeda(e.saldoRestante)} · próxima cobrança ${formatarData(e.proximaCobranca)}</div>
    </div>`;
  }

  await carregar();
}

  Object.assign(window.CP, { renderDashboard });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarMoeda, formatarData, reaisParaCentavos, mascaraMoedaInput, iniciais, debounce, linkWhatsapp, normalizarTelefone, escapeHtml, icone, estadoCarregando, estadoVazio, badgeStatus, toast, abrirModal, confirmarAcao } = window.CP;

function abrirModalEditarCliente(cliente, { aoSalvar } = {}) {
  const { elemento, fechar } = abrirModal({
    titulo: 'Editar cliente',
    tamanho: 'lg',
    corpoHtml: `
      <form id="form-cliente">
        <div class="form-grid">
          <div class="campo form-full"><label>Nome completo *</label><input class="input" id="cli-nome" required value="${escapeHtml(cliente.nome || '')}"></div>
          <div class="campo"><label>Telefone</label><input class="input" id="cli-telefone" value="${escapeHtml(cliente.telefone || '')}"></div>
          <div class="campo"><label>WhatsApp</label><input class="input" id="cli-whatsapp" value="${escapeHtml(cliente.whatsapp || '')}"></div>
          <div class="campo"><label>E-mail</label><input class="input" type="email" id="cli-email" value="${escapeHtml(cliente.email || '')}"></div>
          <div class="campo"><label>CPF/documento</label><input class="input" id="cli-documento" value="${escapeHtml(cliente.documento || '')}"></div>
          <div class="campo form-full"><label>Endereço</label><input class="input" id="cli-endereco" value="${escapeHtml(cliente.endereco || '')}"></div>
          <div class="campo"><label>Complemento</label><input class="input" id="cli-complemento" value="${escapeHtml(cliente.complemento || '')}"></div>
          <div class="campo"><label>Cidade</label><input class="input" id="cli-cidade" value="${escapeHtml(cliente.cidade || '')}"></div>
          <div class="campo"><label>Estado</label><input class="input" id="cli-estado" maxlength="2" value="${escapeHtml(cliente.estado || '')}"></div>
          <div class="campo"><label>CEP</label><input class="input" id="cli-cep" value="${escapeHtml(cliente.cep || '')}"></div>
          <div class="campo form-full"><label>Link de localização</label><input class="input" id="cli-localizacao" value="${escapeHtml(cliente.localizacao || '')}"></div>
          <div class="campo form-full"><label>Observações</label><textarea class="input" id="cli-observacoes" rows="3">${escapeHtml(cliente.observacoes || '')}</textarea></div>
        </div>
      </form>`,
    rodapeHtml: `<button class="btn btn-secundario" id="btn-cancelar">Cancelar</button><button class="btn btn-primario" id="btn-salvar-cliente">Salvar alterações</button>`,
  });
  elemento.querySelector('#btn-cancelar').addEventListener('click', fechar);
  elemento.querySelector('#btn-salvar-cliente').addEventListener('click', async () => {
    const nome = elemento.querySelector('#cli-nome').value.trim();
    if (!nome) { toast('Informe o nome do cliente.', 'erro'); return; }
    const dados = {
      nome,
      telefone: normalizarTelefone(elemento.querySelector('#cli-telefone').value),
      whatsapp: normalizarTelefone(elemento.querySelector('#cli-whatsapp').value),
      email: elemento.querySelector('#cli-email').value.trim(),
      documento: elemento.querySelector('#cli-documento').value.trim(),
      endereco: elemento.querySelector('#cli-endereco').value.trim(),
      complemento: elemento.querySelector('#cli-complemento').value.trim(),
      cidade: elemento.querySelector('#cli-cidade').value.trim(),
      estado: elemento.querySelector('#cli-estado').value.trim().toUpperCase(),
      cep: elemento.querySelector('#cli-cep').value.trim(),
      localizacao: elemento.querySelector('#cli-localizacao').value.trim(),
      observacoes: elemento.querySelector('#cli-observacoes').value.trim(),
    };
    try {
      const atualizado = await loja.atualizarCliente(cliente.id, dados);
      toast('Cliente atualizado.', 'sucesso');
      fechar();
      aoSalvar?.(atualizado);
    } catch (err) {
      toast(err.message || 'Não foi possível salvar o cliente.', 'erro');
    }
  });
}
  // Lê um File, valida e envia como Base64 (teto de 3MB, igual ao backend).
  function enviarArquivoParaCliente(clienteId, arquivo) {
    return new Promise((resolve, reject) => {
      if (!arquivo) return reject(new Error('Nenhum arquivo selecionado.'));
      if (arquivo.size > 3 * 1024 * 1024) return reject(new Error(`"${arquivo.name}" excede 3MB.`));
      const leitor = new FileReader();
      leitor.onload = async () => {
        try {
          const dataUrl = String(leitor.result || '');
          const partes = dataUrl.split(',');
          if (partes.length !== 2) throw new Error('Não foi possível ler o arquivo.');
          const mime = (dataUrl.match(/^data:([^;]+);base64$/) || [])[1] || arquivo.type || 'application/octet-stream';
          const novo = await loja.adicionarArquivo(clienteId, { nome: arquivo.name, mime, dados: partes[1] });
          resolve(novo);
        } catch (err) {
          reject(err);
        }
      };
      leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
      leitor.readAsDataURL(arquivo);
    });
  }

function abrirModalNovoCliente({ aoSalvar } = {}) {
  const { elemento, fechar } = abrirModal({
    titulo: 'Novo cliente',
    tamanho: 'lg',
    corpoHtml: `
      <form id="form-cliente">
        <div class="form-grid">
          <div class="campo form-full"><label>Nome completo *</label><input class="input" id="cli-nome" required></div>
          <div class="campo"><label>Telefone</label><input class="input" id="cli-telefone" placeholder="(11) 99999-9999"></div>
          <div class="campo"><label>WhatsApp</label><input class="input" id="cli-whatsapp" placeholder="(11) 99999-9999"></div>
          <div class="campo"><label>E-mail</label><input class="input" type="email" id="cli-email"></div>
          <div class="campo"><label>CPF/documento</label><input class="input" id="cli-documento"></div>
          <div class="campo form-full"><label>Endereço</label><input class="input" id="cli-endereco"></div>
          <div class="campo"><label>Complemento</label><input class="input" id="cli-complemento"></div>
          <div class="campo"><label>Cidade</label><input class="input" id="cli-cidade"></div>
          <div class="campo"><label>Estado</label><input class="input" id="cli-estado" maxlength="2" placeholder="SP"></div>
          <div class="campo"><label>CEP</label><input class="input" id="cli-cep"></div>
          <div class="campo form-full"><label>Link de localização</label><input class="input" id="cli-localizacao" placeholder="https://maps.google.com/..."></div>
          <div class="campo form-full"><label>Observações</label><textarea class="input" id="cli-observacoes" rows="3"></textarea></div>
          <div class="campo form-full"><label>Anexar documentos (opcional)</label><input class="input" type="file" id="cli-arquivos" multiple accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"><p class="texto-xs texto-mudo" style="margin-top:6px">Até 3MB por arquivo. Serão vinculados ao cliente após salvar.</p></div>
        </div>
      </form>`,
    rodapeHtml: `<button class="btn btn-secundario" id="btn-cancelar">Cancelar</button><button class="btn btn-primario" id="btn-salvar-cliente">Salvar cliente</button>`,
  });
  elemento.querySelector('#btn-cancelar').addEventListener('click', fechar);
  elemento.querySelector('#btn-salvar-cliente').addEventListener('click', async () => {
    const nome = elemento.querySelector('#cli-nome').value.trim();
    if (!nome) { toast('Informe o nome do cliente.', 'erro'); return; }
    const btnSalvar = elemento.querySelector('#btn-salvar-cliente');
    btnSalvar.disabled = true;
    const dados = {
      nome,
      telefone: normalizarTelefone(elemento.querySelector('#cli-telefone').value),
      whatsapp: normalizarTelefone(elemento.querySelector('#cli-whatsapp').value),
      email: elemento.querySelector('#cli-email').value.trim(),
      documento: elemento.querySelector('#cli-documento').value.trim(),
      endereco: elemento.querySelector('#cli-endereco').value.trim(),
      complemento: elemento.querySelector('#cli-complemento').value.trim(),
      cidade: elemento.querySelector('#cli-cidade').value.trim(),
      estado: elemento.querySelector('#cli-estado').value.trim().toUpperCase(),
      cep: elemento.querySelector('#cli-cep').value.trim(),
      localizacao: elemento.querySelector('#cli-localizacao').value.trim(),
      observacoes: elemento.querySelector('#cli-observacoes').value.trim(),
    };
    try {
      const criado = await loja.criarCliente(dados);
      const arqs = elemento.querySelector('#cli-arquivos')?.files || [];
      let anexados = 0, falhas = 0;
      for (const arq of arqs) {
        try {
          await enviarArquivoParaCliente(criado.id, arq);
          anexados += 1;
        } catch {
          falhas += 1;
        }
      }
      toast(falhas ? `Cliente salvo. ${anexados} arquivo(s) anexado(s), ${falhas} falharam.` : 'Cliente cadastrado com sucesso.', falhas ? 'aviso' : 'sucesso');
      fechar();
      aoSalvar?.(criado);
    } catch (err) {
      toast(err.message || 'Não foi possível salvar o cliente.', 'erro');
      btnSalvar.disabled = false;
    }
  });
}

async function renderClientes(container, { navegarClienteDetalhe }) {
  let busca = '';
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let lista;
    try {
      lista = await loja.listarClientes({ busca });
    } catch (err) {
      container.innerHTML = mensagemErroLista(err);
      return;
    }
    render(lista);
  }

  function mensagemErroLista(err) {
    return `<div class="pagina-cabecalho"><div><h1 class="pagina-titulo">Clientes</h1></div></div>` + estadoVazio({
      iconeNome: 'clientes', titulo: 'Não foi possível carregar os clientes',
      descricao: err instanceof ErroAPI && err.status === 404
        ? 'O endpoint GET /api/clientes ainda não existe no backend. Ative a demonstração para visualizar a tela com dados fictícios.'
        : (err.message || 'Tente novamente em instantes.'),
      acaoHtml: `<button class="btn btn-primario" id="btn-demo-clientes" style="margin-top:14px">Carregar dados de demonstração</button>`,
    });
  }

  function render(lista) {
    container.innerHTML = `
    <div class="pagina-cabecalho">
      <div><h1 class="pagina-titulo">Clientes</h1><p class="pagina-subtitulo">${lista.length} cliente${lista.length === 1 ? '' : 's'} cadastrado${lista.length === 1 ? '' : 's'}.</p></div>
      <button class="btn btn-primario" id="btn-novo-cliente">${icone('mais2', 17)} Novo cliente</button>
    </div>
    <div class="card" style="padding:14px 18px;margin-bottom:18px">
      <div class="campo" style="margin:0"><div class="campo-input-wrap">${icone('busca', 17)}<input class="input" style="padding-left:38px" id="input-busca-clientes" placeholder="Buscar por nome..." value="${escapeHtml(busca)}"></div></div>
    </div>
    <div id="lista-clientes"></div>`;

    const alvo = container.querySelector('#lista-clientes');
    if (!lista.length) {
      alvo.innerHTML = estadoVazio({
        iconeNome: 'clientes', titulo: busca ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado ainda',
        descricao: busca ? 'Tente buscar com outro termo.' : 'Cadastre seu primeiro cliente para começar a controlar operações.',
      });
    } else {
      alvo.innerHTML = `
      <div class="tabela-wrap card" style="padding:0">
        <table class="tabela">
          <thead><tr><th>Cliente</th><th>Operações</th><th>Saldo pendente</th><th>Próxima cobrança</th><th></th></tr></thead>
          <tbody>
            ${lista.map((c) => `
            <tr class="linha-cliente" data-id="${c.id}" style="cursor:pointer">
              <td>
                <div class="pessoa-linha">
                  ${c.foto ? `<img class="avatar" src="${c.foto}">` : `<div class="avatar">${iniciais(c.nome)}</div>`}
                  <div class="pessoa-info"><div class="nome">${escapeHtml(c.nome)}</div><div class="sub">${c.telefone ? formatarTelefoneExibicao(c.telefone) : 'sem telefone'}</div></div>
                </div>
              </td>
              <td>${c.operacoes ?? 0}</td>
              <td style="font-weight:700">${formatarMoeda(c.saldoPendente || 0)}</td>
              <td>${c.proximaCobranca ? formatarData(c.proximaCobranca) : '—'}</td>
              <td style="text-align:right">${icone('seta', 16)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
      alvo.querySelectorAll('.linha-cliente').forEach((tr) => tr.addEventListener('click', () => navegarClienteDetalhe(tr.dataset.id)));
    }

    container.querySelector('#btn-novo-cliente').addEventListener('click', () => abrirModalNovoCliente({ aoSalvar: () => carregar() }));
    container.querySelector('#input-busca-clientes').addEventListener('input', debounce((e) => { busca = e.target.value; carregar(); }, 300));
    container.querySelector('#btn-demo-clientes')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
  }

  await carregar();
}

function formatarTelefoneExibicao(tel) {
  const d = String(tel).replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}

function rotuloStatusParc(s) {
  return { pago: 'Paga', pendente: 'Pendente', parcial: 'Parcial', atrasado: 'Atrasada', 'atrasado-parcial': 'Atrasada (parcial)', 'vence-hoje': 'Vence hoje', cancelado: 'Cancelada' }[s] || s;
}

function rotuloFormaPg(f) {
  return { pix: 'PIX', dinheiro: 'Dinheiro', transferencia: 'Transferência', cartao: 'Cartão', outro: 'Outro' }[f] || f;
}

function formatarTamanho(bytes) {
  const v = Number(bytes) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

// Detalhe de um recebimento: data/hora, valor, forma, empréstimo e as
// parcelas quitadas por ele (uma ou várias — ex.: 3,4,5,6,7 de uma vez).
function abrirModalDetalhePagamento(pagamento, emprestimos) {
  const hora = pagamento.criadoEm && String(pagamento.criadoEm).length >= 16
    ? String(pagamento.criadoEm).slice(11, 16).replace('T', '')
    : null;
  const emp = (emprestimos || []).find((e) => String(e.id) === String(pagamento.emprestimoId));
  const itens = pagamento.itens && pagamento.itens.length
    ? pagamento.itens
    : (pagamento.parcelaId != null ? [{ parcelaId: pagamento.parcelaId, numero: null, valor: pagamento.valorRecebido }] : []);
  const { elemento, fechar } = abrirModal({
    titulo: 'Detalhe do pagamento',
    corpoHtml: `
      <div class="calc-resultado" style="margin-bottom:18px">
        <div class="item"><div class="rotulo">Data</div><div class="valor">${formatarData(pagamento.data)}${hora ? ` · ${hora}` : ''}</div></div>
        <div class="item"><div class="rotulo">Valor recebido</div><div class="valor texto-positivo">${formatarMoeda(pagamento.valorRecebido)}</div></div>
        <div class="item"><div class="rotulo">Forma</div><div class="valor">${rotuloFormaPg(pagamento.forma)}</div></div>
        <div class="item"><div class="rotulo">Situação</div><div class="valor">Confirmado</div></div>
        <div class="item"><div class="rotulo">Empréstimo</div><div class="valor">${emp ? `${formatarMoeda(emp.capital)} → ${formatarMoeda(emp.total)}` : `#${pagamento.emprestimoId ?? '—'}`}</div></div>
        <div class="item"><div class="rotulo">Parcelas</div><div class="valor">${itens.map((i) => i.numero ?? '?').join(', ') || '—'}</div></div>
      </div>
      ${itens.length > 1 ? `<div class="tabela-wrap" style="margin-bottom:14px"><table class="tabela"><thead><tr><th>Parcela</th><th>Valor abatido</th></tr></thead><tbody>
        ${itens.map((i) => `<tr><td>${i.numero ?? '?'}</td><td>${formatarMoeda(i.valor)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${pagamento.observacao ? `<p class="texto-sm texto-mudo">Obs.: ${escapeHtml(pagamento.observacao)}</p>` : ''}`,
    rodapeHtml: `<button class="btn btn-secundario" id="fechar-pg">Fechar</button>`,
  });
  elemento.querySelector('#fechar-pg').addEventListener('click', fechar);
}

// Ficha completa de um empréstimo: valores, parcelas uma a uma e histórico.
// Abre da ficha do cliente (empréstimo clicável) — só leitura + ações.
async function abrirModalDetalheEmprestimo(emprestimoId, { aoAtualizar } = {}) {
  const { elemento, fechar } = abrirModal({
    titulo: 'Detalhe do empréstimo',
    tamanho: 'lg',
    corpoHtml: `<div class="carregando"><div class="spinner"></div></div>`,
    rodapeHtml: `<button class="btn btn-secundario" id="fechar-detalhe">Fechar</button>`,
  });
  elemento.querySelector('#fechar-detalhe').addEventListener('click', fechar);
  let emp;
  let historico = [];
  try {
    [emp, historico] = await Promise.all([
      loja.obterEmprestimo(emprestimoId),
      loja.listarPagamentos({ emprestimoId }).catch(() => []),
    ]);
  } catch (err) {
    elemento.querySelector('.modal-corpo') && (elemento.querySelector('.modal-corpo').innerHTML =
      `<div class="alerta alerta-erro">${escapeHtml(err.message || 'Não foi possível carregar.')}</div>`);
    return;
  }
  if (!emp) return fechar();
  const taxa = emp.capital > 0 ? ((emp.total - emp.capital) / emp.capital) * 100 : 0;
  const parcelas = emp.parcelas || [];
  const pagas = parcelas.filter((p) => (p.valor - p.valorPago) <= 0).length;
  const pendentes = parcelas.filter((p) => (p.valor - p.valorPago) > 0 && !(p.statusCalc || '').startsWith('atrasado')).length;
  const atrasadas = parcelas.filter((p) => (p.statusCalc || '').startsWith('atrasado')).length;
  const recebido = historico.reduce((a, p) => a + (p.valorRecebido || 0), 0);
  const corpo = elemento.querySelector('.modal-corpo') || elemento;
  corpo.innerHTML = `
    <div class="calc-resultado" style="margin-bottom:18px">
      <div class="item"><div class="rotulo">Valor emprestado</div><div class="valor">${formatarMoeda(emp.capital)}</div></div>
      <div class="item"><div class="rotulo">Total contratado</div><div class="valor">${formatarMoeda(emp.total)}</div></div>
      <div class="item"><div class="rotulo">Taxa/acréscimo</div><div class="valor">${taxa.toFixed(2)}%</div></div>
      <div class="item"><div class="rotulo">Situação</div><div class="valor">${escapeHtml(emp.statusCalculado || emp.status)}</div></div>
      <div class="item"><div class="rotulo">Operação</div><div class="valor">${formatarData(emp.dataOperacao)}</div></div>
      <div class="item"><div class="rotulo">Parcelas</div><div class="valor">${emp.qtdParcelas} × ${formatarMoeda(parcelas[0]?.valor || 0)}</div></div>
      <div class="item"><div class="rotulo">Pagas / pendentes / atrasadas</div><div class="valor">${pagas} / ${pendentes} / ${atrasadas}</div></div>
      <div class="item"><div class="rotulo">Total recebido</div><div class="valor texto-positivo">${formatarMoeda(recebido)}</div></div>
      <div class="item"><div class="rotulo">Saldo restante</div><div class="valor">${formatarMoeda(emp.saldoRestante)}</div></div>
    </div>
    <div class="card-titulo" style="margin-bottom:10px">Parcelas</div>
    <div class="tabela-wrap" style="margin-bottom:18px"><table class="tabela"><thead><tr><th>Nº</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Situação</th></tr></thead><tbody>
      ${parcelas.map((p) => `<tr><td>${p.numero}</td><td>${formatarData(p.vencimento)}</td><td>${formatarMoeda(p.valor)}</td><td>${formatarMoeda(p.valorPago || 0)}</td><td>${rotuloStatusParc(p.statusCalc || p.status)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="card-titulo" style="margin-bottom:10px">Histórico de pagamentos (${historico.length})</div>
    ${!historico.length ? '<p class="texto-sm texto-mudo">Nenhum pagamento registrado.</p>' :
      `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Data</th><th>Parcelas</th><th>Forma</th><th>Recebido</th></tr></thead><tbody>
      ${historico.map((p) => `<tr><td>${formatarData(p.data)}</td><td>${(p.itens || []).map((i) => i.numero ?? '?').join(', ') || (p.parcelaId ?? '—')}</td><td>${rotuloFormaPg(p.forma)}</td><td class="texto-positivo" style="font-weight:700">${formatarMoeda(p.valorRecebido)}</td></tr>`).join('')}
      </tbody></table></div>`}
    ${emp.observacoes ? `<p class="texto-sm texto-mudo" style="margin-top:12px">Obs.: ${escapeHtml(emp.observacoes)}</p>` : ''}
    <div class="flex gap-8" style="margin-top:18px;flex-wrap:wrap">
      <button class="btn btn-primario btn-sm" id="btn-pagar-emp">Registrar pagamento</button>
      <button class="btn btn-secundario btn-sm" id="btn-editar-emp">Editar empréstimo</button>
    </div>`;
  elemento.querySelector('#btn-pagar-emp')?.addEventListener('click', () => {
    fechar();
    // Acesso tardio de propósito: este IIFE avalia antes do IIFE de
    // Empréstimos registrar a função em window.CP (mesma causa do
    // "abrirModalRegistrarPagamento is not a function" já corrigido aqui).
    window.CP.abrirModalRegistrarPagamento({ clienteId: emp.clienteId, emprestimoId: emp.id, parcelas: parcelas.filter((p) => (p.valor - (p.valorPago || 0)) > 0), aoSalvar: () => { aoAtualizar?.(); } });
  });
  elemento.querySelector('#btn-editar-emp')?.addEventListener('click', () => {
    fechar();
    abrirModalEditarEmprestimo(emp, { aoSalvar: () => { aoAtualizar?.(); } });
  });
}

// Edição completa espelhando o formulário de criação (mesmos campos e
// mesma estrutura visual). Trava por campo, nunca genérica:
//   * capital e cliente: nunca (capital já liberado);
//   * parcela com recebimento: valor e vencimento travados;
//   * quantidade de parcelas: nunca (cancele e recrie para isso);
//   * total/valores/vencimentos de parcelas sem pagamento: livres, desde
//     que soma(pago) + soma(novo) == total > capital (o backend revalida).
async function abrirModalEditarEmprestimo(emp, { aoSalvar } = {}) {
  const parcelasAtuais = (emp.parcelas || []).map((p) => ({
    numero: p.numero, valor: p.valor, vencimento: p.vencimento,
    pago: (p.valorPago || 0) > 0, valorPago: p.valorPago || 0,
  }));
  const temPagamentos = parcelasAtuais.some((p) => p.pago);
  const { elemento, fechar } = abrirModal({
    titulo: 'Editar empréstimo',
    tamanho: 'lg',
    corpoHtml: `
      <div class="texto-sm texto-mudo" style="margin-bottom:6px">Cliente: <strong>${escapeHtml(emp.cliente?.nome || '')}</strong></div>
      ${temPagamentos ? '<div class="alerta alerta-aviso" style="margin-bottom:16px">Esta operação já possui recebimentos: parcelas pagas ficam travadas e o histórico nunca é alterado. Só o futuro pode ser ajustado.</div>' : ''}
      <div class="form-grid">
        <div class="campo"><label>Valor emprestado (R$)</label><input class="input" value="${(emp.capital / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}" disabled><p class="texto-xs texto-mudo" style="margin-top:4px">Não editável — valor já liberado.</p></div>
        <div class="campo"><label>Valor total a receber (R$) *</label><input class="input" id="empedit-total" value="${(emp.total / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}"></div>
        <div class="campo"><label>Frequência</label>
          <select class="select" id="empedit-frequencia">
            ${['diario', 'semanal', 'quinzenal', 'mensal', 'personalizado'].map((f) => `<option value="${f}"${emp.frequencia === f ? ' selected' : ''}>${{ diario: 'Diário', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', personalizado: 'Personalizado' }[f]}</option>`).join('')}
          </select>
        </div>
        <div class="campo"><label>Data da operação</label><input class="input" type="date" id="empedit-data" value="${escapeHtml(emp.dataOperacao || '')}"></div>
      </div>
      <div class="calc-resultado" style="margin-bottom:18px">
        <div class="item"><div class="rotulo">Taxa/acréscimo</div><div class="valor" id="empedit-taxa">—</div></div>
        <div class="item"><div class="rotulo">Já recebido (travado)</div><div class="valor" id="empedit-pago">—</div></div>
      </div>
      <div class="card-titulo" style="margin:14px 0 8px">Parcelas (mesma quantidade — ${parcelasAtuais.length})</div>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nº</th><th>Vencimento</th><th>Valor (R$)</th><th>Situação</th></tr></thead><tbody>
        ${parcelasAtuais.map((p, i) => `
        <tr><td>${p.numero}</td>
          <td>${p.pago ? formatarData(p.vencimento) : `<input class="input" style="max-width:150px" type="date" data-ed-venc="${i}" value="${escapeHtml(p.vencimento || '')}">`}</td>
          <td>${p.pago ? `${formatarMoeda(p.valor)} <span class="texto-xs texto-mudo">🔒 pago</span>` : `<input class="input" style="max-width:130px" data-ed-valor="${i}" value="${(p.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}">`}</td>
          <td class="texto-xs texto-mudo">${p.pago ? `Recebido ${formatarMoeda(p.valorPago)}` : 'Pendente'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="texto-xs texto-mudo" style="margin-top:6px" id="empedit-soma">—</div>
      <div class="campo form-full" style="margin-top:12px"><label>Observações</label><textarea class="input" id="empedit-obs" rows="2">${escapeHtml(emp.observacoes || '')}</textarea></div>`,
    rodapeHtml: `<button class="btn btn-secundario" id="cancelar-edemp">Cancelar</button><button class="btn btn-primario" id="salvar-edemp">Salvar alterações</button>`,
  });
  mascaraMoedaInput(elemento.querySelector('#empedit-total'));
  elemento.querySelectorAll('[data-ed-valor]').forEach((inp) => mascaraMoedaInput(inp));
  elemento.querySelector('#cancelar-edemp').addEventListener('click', fechar);

  function lerParcelas() {
    return parcelasAtuais.map((p, i) => {
      if (p.pago) return { numero: p.numero, valor: p.valor, vencimento: p.vencimento };
      const vEl = elemento.querySelector(`[data-ed-valor="${i}"]`);
      const dEl = elemento.querySelector(`[data-ed-venc="${i}"]`);
      return { numero: p.numero, valor: reaisParaCentavos(vEl.value), vencimento: dEl.value };
    });
  }
  function recalcular() {
    const total = reaisParaCentavos(elemento.querySelector('#empedit-total').value);
    const taxa = emp.capital > 0 && total > 0 ? ((total - emp.capital) / emp.capital) * 100 : 0;
    elemento.querySelector('#empedit-taxa').textContent = `${taxa.toFixed(2)}%`;
    const pago = parcelasAtuais.filter((p) => p.pago).reduce((a, p) => a + p.valorPago, 0);
    elemento.querySelector('#empedit-pago').textContent = formatarMoeda(pago);
    const soma = lerParcelas().reduce((a, p) => a + (Number.isFinite(p.valor) ? p.valor : 0), 0);
    elemento.querySelector('#empedit-soma').innerHTML = `Soma das parcelas: ${formatarMoeda(soma)}` +
      (soma !== total ? ` <span class="texto-negativo">(diferente do total: ${formatarMoeda(total)})</span>` : '');
  }
  elemento.querySelector('#empedit-total').addEventListener('input', recalcular);
  elemento.querySelectorAll('[data-ed-valor]').forEach((inp) => inp.addEventListener('input', recalcular));
  recalcular();

  elemento.querySelector('#salvar-edemp').addEventListener('click', async () => {
    const btn = elemento.querySelector('#salvar-edemp');
    if (btn.disabled) return;
    const total = reaisParaCentavos(elemento.querySelector('#empedit-total').value);
    if (total <= emp.capital) return toast('O total deve ser maior que o valor emprestado.', 'erro');
    const parcelas = lerParcelas();
    btn.disabled = true;
    try {
      await loja.atualizarEmprestimo(emp.id, {
        total,
        frequencia: elemento.querySelector('#empedit-frequencia').value,
        dataOperacao: elemento.querySelector('#empedit-data').value,
        observacoes: elemento.querySelector('#empedit-obs').value.trim(),
        parcelas,
      });
      toast('Empréstimo atualizado.', 'sucesso');
      fechar();
      aoSalvar?.();
    } catch (err) {
      toast(err.message || 'Não foi possível salvar.', 'erro');
      btn.disabled = false;
    }
  });
}

async function renderClienteDetalhe(container, { clienteId, navegarClientes, abrirNovoEmprestimo, abrirRegistrarPagamento }) {  container.innerHTML = estadoCarregando();
  let abaAtual = 'resumo';
  let cliente, emprestimos = [], pagamentos = [], notas = [];

  async function carregar() {
    try {
      cliente = await loja.obterCliente(clienteId);
      if (!cliente) { container.innerHTML = estadoVazio({ iconeNome: 'clientes', titulo: 'Cliente não encontrado', descricao: 'Ele pode ter sido removido.' }); return; }
      [emprestimos, pagamentos, notas] = await Promise.all([
        loja.listarEmprestimos({ clienteId }),
        loja.listarPagamentos({ clienteId }),
        // Anotações EXCLUSIVAS deste cliente (comparação por string: o id da
        // rota chega como texto e o da API como número).
        loja.listarNotas().then((n) => n.filter((x) => x.clienteId != null && String(x.clienteId) === String(clienteId))),
      ]);
    } catch (err) {
      container.innerHTML = estadoVazio({ iconeNome: 'clientes', titulo: 'Não foi possível carregar o cliente', descricao: err.message });
      return;
    }
    render();
  }

  function render() {
    const totalEmprestado = emprestimos.reduce((a, e) => a + e.capital, 0);
    const totalContratado = emprestimos.reduce((a, e) => a + e.total, 0);
    const jaPago = pagamentos.reduce((a, p) => a + p.valorRecebido, 0);
    const faltaPagar = emprestimos.reduce((a, e) => a + e.saldoRestante, 0);
    const abertas = emprestimos.filter((e) => e.statusCalculado !== 'quitado' && e.statusCalculado !== 'cancelado').length;
    const concluidas = emprestimos.filter((e) => e.statusCalculado === 'quitado').length;
    const parcelasAtrasadas = emprestimos.flatMap((e) => e.parcelas || []).filter((p) => p.statusCalc?.startsWith('atrasado')).length;
    const proxima = emprestimos.map((e) => e.proximaCobranca).filter(Boolean).sort()[0];

    container.innerHTML = `
    <button class="btn btn-fantasma" id="btn-voltar-clientes" style="margin-bottom:10px">${icone('setaEsquerda', 16)} Voltar</button>
    <div class="pagina-cabecalho">
      <div class="pessoa-linha">
        ${cliente.foto ? `<img class="avatar" style="width:56px;height:56px" src="${cliente.foto}">` : `<div class="avatar" style="width:56px;height:56px;font-size:20px">${iniciais(cliente.nome)}</div>`}
        <div><h1 class="pagina-titulo">${escapeHtml(cliente.nome)}</h1><p class="pagina-subtitulo">Cliente desde ${formatarData(cliente.criadoEm)}</p></div>
      </div>
      <div class="flex gap-8" style="flex-wrap:wrap">
        <button class="btn btn-secundario btn-sm" id="btn-ligar">${icone('telefone', 15)} Ligar</button>
        <button class="btn btn-secundario btn-sm" id="btn-whatsapp">${icone('whatsapp', 15)} WhatsApp</button>
        ${cliente.email ? `<a class="btn btn-secundario btn-sm" href="mailto:${cliente.email}">${icone('email', 15)} E-mail</a>` : ''}
        ${cliente.localizacao ? `<a class="btn btn-secundario btn-sm" href="${cliente.localizacao}" target="_blank" rel="noopener">${icone('local', 15)} Localização</a>` : ''}
        <button class="btn btn-secundario btn-sm" id="btn-editar-cliente">${icone('editar', 15)} Editar cliente</button>
        <button class="btn btn-primario btn-sm" id="btn-novo-emp-cliente">${icone('mais2', 15)} Novo empréstimo</button>
      </div>
    </div>

    <div class="grid grid-4" style="margin-bottom:20px">
      ${kpiMini('Total emprestado', formatarMoeda(totalEmprestado))}
      ${kpiMini('Total contratado', formatarMoeda(totalContratado))}
      ${kpiMini('Já pago', formatarMoeda(jaPago))}
      ${kpiMini('Falta pagar', formatarMoeda(faltaPagar))}
    </div>
    <div class="grid grid-4" style="margin-bottom:20px">
      ${kpiMini('Operações abertas', String(abertas))}
      ${kpiMini('Operações concluídas', String(concluidas))}
      ${kpiMini('Parcelas atrasadas', String(parcelasAtrasadas))}
      ${kpiMini('Próxima cobrança', proxima ? formatarData(proxima) : '—')}
    </div>

    <div class="tabs">
      ${['resumo', 'emprestimos', 'pagamentos', 'anotacoes', 'arquivos'].map((a) => `<div class="tab-item ${abaAtual === a ? 'ativo' : ''}" data-aba="${a}">${rotuloAba(a)}</div>`).join('')}
    </div>
    <div id="conteudo-aba"></div>`;

    container.querySelectorAll('[data-aba]').forEach((el) => el.addEventListener('click', () => { abaAtual = el.dataset.aba; render(); }));
    container.querySelector('#btn-voltar-clientes').addEventListener('click', navegarClientes);
    container.querySelector('#btn-ligar').addEventListener('click', () => { window.location.href = `tel:${cliente.telefone}`; });
    container.querySelector('#btn-whatsapp').addEventListener('click', () => { window.open(linkWhatsapp(cliente.whatsapp || cliente.telefone, `Olá, ${cliente.nome.split(' ')[0]}!`), '_blank'); });
    container.querySelector('#btn-novo-emp-cliente').addEventListener('click', () => abrirNovoEmprestimo({ clientePreSelecionado: cliente, aoSalvar: carregar }));
    container.querySelector('#btn-editar-cliente').addEventListener('click', () => abrirModalEditarCliente(cliente, { aoSalvar: carregar }));

    renderAba();
  }

  function rotuloAba(a) {
    return { resumo: 'Resumo', emprestimos: 'Empréstimos', pagamentos: 'Pagamentos', anotacoes: 'Anotações', arquivos: 'Arquivos' }[a];
  }

  function renderAba() {
    const alvo = container.querySelector('#conteudo-aba');
    if (abaAtual === 'resumo') {
      alvo.innerHTML = `<div class="card"><div class="card-titulo" style="margin-bottom:10px">Observações</div><p class="texto-sm" style="line-height:1.6">${escapeHtml(cliente.observacoes) || '<span class="texto-mudo">Nenhuma observação registrada.</span>'}</p></div>`;
    } else if (abaAtual === 'emprestimos') {
      alvo.innerHTML = !emprestimos.length ? estadoVazio({ iconeNome: 'emprestimos', titulo: 'Nenhum empréstimo', descricao: 'Este cliente ainda não possui operações.' }) :
        emprestimos.map((e) => `
        <div class="lista-card" data-emp="${e.id}" style="cursor:pointer" title="Abrir detalhe">
          <div class="flex justify-between items-center">
            <div><div style="font-weight:700">${formatarMoeda(e.capital)} → ${formatarMoeda(e.total)}</div><div class="texto-xs texto-mudo">Operação em ${formatarData(e.dataOperacao)} · toque para detalhar</div></div>
            ${badgeStatus(rotuloStatusEmp(e.statusCalculado), corStatusEmp(e.statusCalculado))}
          </div>
        </div>`).join('');
      alvo.querySelectorAll('[data-emp]').forEach((el) => el.addEventListener('click', () => {
        abrirModalDetalheEmprestimo(el.dataset.emp, { aoAtualizar: carregar });
      }));
    } else if (abaAtual === 'pagamentos') {
      alvo.innerHTML = !pagamentos.length ? estadoVazio({ iconeNome: 'financeiro', titulo: 'Nenhum pagamento', descricao: 'Nenhum pagamento registrado ainda.' }) :
        `<div class="tabela-wrap card" style="padding:0"><table class="tabela"><thead><tr><th>Data</th><th>Forma</th><th>Esperado</th><th>Recebido</th></tr></thead><tbody>
        ${pagamentos.map((p) => `<tr data-pg="${p.id}" style="cursor:pointer" title="Abrir detalhe"><td>${formatarData(p.data)}</td><td>${rotuloForma(p.forma)}</td><td>${formatarMoeda(p.valorEsperado)}</td><td style="font-weight:700" class="texto-positivo">${formatarMoeda(p.valorRecebido)}</td></tr>`).join('')}
        </tbody></table></div>`;
      alvo.querySelectorAll('[data-pg]').forEach((el) => el.addEventListener('click', () => {
        const pg = pagamentos.find((x) => String(x.id) === el.dataset.pg);
        if (pg) abrirModalDetalhePagamento(pg, emprestimos);
      }));
    } else if (abaAtual === 'anotacoes') {
      alvo.innerHTML = `
        <button class="btn btn-secundario btn-sm" id="btn-nova-nota-cliente" style="margin-bottom:14px">${icone('mais2', 14)} Nova anotação</button>
        ${!notas.length ? estadoVazio({ iconeNome: 'notas', titulo: 'Nenhuma anotação', descricao: 'Registre observações importantes sobre este cliente.' }) :
          notas.map((n) => `<div class="lista-card"><div class="flex justify-between items-start"><div style="font-weight:700">${escapeHtml(n.titulo)}</div>
            <div class="flex gap-8"><button class="btn-icone" style="width:30px;height:30px" data-nota-editar="${n.id}" title="Editar">${icone('editar', 14)}</button>
            <button class="btn-icone" style="width:30px;height:30px" data-nota-excluir="${n.id}" title="Excluir">${icone('lixo', 14)}</button></div></div>
            <p class="texto-sm texto-mudo" style="margin-top:4px">${escapeHtml(n.conteudo)}</p>
            <div class="texto-xs texto-mudo" style="margin-top:8px">${formatarData((n.criadoEm || '').slice(0, 10))}</div></div>`).join('')}`;
      container.querySelector('#btn-nova-nota-cliente')?.addEventListener('click', async () => {
        const { elemento, fechar } = abrirModal({
          titulo: 'Nova anotação', corpoHtml: `<div class="campo"><label>Título</label><input class="input" id="nota-titulo-cli"></div><div class="campo"><label>Conteúdo</label><textarea class="input" id="nota-conteudo-cli" rows="4"></textarea></div>`,
          rodapeHtml: `<button class="btn btn-secundario" id="cancelar-nota">Cancelar</button><button class="btn btn-primario" id="salvar-nota-cli">Salvar</button>`,
        });
        elemento.querySelector('#cancelar-nota').addEventListener('click', fechar);
        elemento.querySelector('#salvar-nota-cli').addEventListener('click', async () => {
          const titulo = elemento.querySelector('#nota-titulo-cli').value.trim();
          const conteudo = elemento.querySelector('#nota-conteudo-cli').value.trim();
          if (!titulo) return toast('Informe um título.', 'erro');
          await loja.criarNota({ titulo, conteudo, categoria: 'cliente', clienteId });
          fechar(); toast('Anotação salva.', 'sucesso'); carregar();
        });
      });
      container.querySelectorAll('[data-nota-editar]').forEach((b) => b.addEventListener('click', () => {
        const n = notas.find((x) => String(x.id) === b.dataset.notaEditar);
        if (!n) return;
        const { elemento, fechar } = abrirModal({
          titulo: 'Editar anotação', corpoHtml: `<div class="campo"><label>Título</label><input class="input" id="nota-titulo-cli" value="${escapeHtml(n.titulo || '')}"></div><div class="campo"><label>Conteúdo</label><textarea class="input" id="nota-conteudo-cli" rows="4">${escapeHtml(n.conteudo || '')}</textarea></div>`,
          rodapeHtml: `<button class="btn btn-secundario" id="cancelar-nota">Cancelar</button><button class="btn btn-primario" id="salvar-nota-cli">Salvar</button>`,
        });
        elemento.querySelector('#cancelar-nota').addEventListener('click', fechar);
        elemento.querySelector('#salvar-nota-cli').addEventListener('click', async () => {
          const titulo = elemento.querySelector('#nota-titulo-cli').value.trim();
          const conteudo = elemento.querySelector('#nota-conteudo-cli').value.trim();
          if (!titulo) return toast('Informe um título.', 'erro');
          try {
            await loja.atualizarNota(n.id, { titulo, conteudo });
            fechar(); toast('Anotação atualizada.', 'sucesso'); carregar();
          } catch (err) { toast(err.message || 'Não foi possível salvar.', 'erro'); }
        });
      }));
      container.querySelectorAll('[data-nota-excluir]').forEach((b) => b.addEventListener('click', async () => {
        const ok = await confirmarAcao({ titulo: 'Excluir anotação', mensagem: 'Deseja excluir esta anotação? Esta ação não pode ser desfeita.', textoConfirmar: 'Excluir', perigo: true });
        if (!ok) return;
        try {
          await loja.excluirNota(b.dataset.notaExcluir);
          toast('Anotação excluída.', 'sucesso'); carregar();
        } catch (err) { toast(err.message || 'Não foi possível excluir.', 'erro'); }
      }));
    } else if (abaAtual === 'arquivos') {
      alvo.innerHTML = `<div class="card"><div class="carregando"><div class="spinner"></div></div></div>`;
      (async () => {
        let arquivos = [];
        try {
          arquivos = await loja.listarArquivos(clienteId);
        } catch (err) {
          alvo.innerHTML = estadoVazio({ iconeNome: 'arquivo', titulo: 'Não foi possível carregar os arquivos', descricao: err.message });
          return;
        }
        alvo.innerHTML = `
        <div class="card" style="margin-bottom:14px">
          <div class="card-titulo" style="margin-bottom:10px">Anexar arquivo</div>
          <div class="flex gap-8" style="flex-wrap:wrap;align-items:flex-end">
            <div class="campo" style="flex:1;min-width:200px;margin-bottom:0"><input class="input" type="file" id="arq-input" accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"></div>
            <button class="btn btn-primario btn-sm" id="btn-enviar-arq">${icone('upload', 15)} Enviar</button>
          </div>
          <p class="texto-xs texto-mudo" style="margin-top:8px">Documentos, imagens, comprovantes e contratos. Até 3MB por arquivo.</p>
        </div>
        ${!arquivos.length ? estadoVazio({ iconeNome: 'arquivo', titulo: 'Nenhum arquivo', descricao: 'Anexe o primeiro documento deste cliente acima.' }) :
          `<div class="tabela-wrap card" style="padding:0"><table class="tabela"><thead><tr><th>Arquivo</th><th>Tamanho</th><th>Data</th><th></th></tr></thead><tbody>
          ${arquivos.map((a) => `<tr><td style="font-weight:600">${escapeHtml(a.nome)}</td><td class="texto-mudo">${formatarTamanho(a.tamanho)}</td><td class="texto-mudo">${formatarData((a.criadoEm || '').slice(0, 10))}</td>
            <td style="white-space:nowrap"><button class="btn btn-secundario btn-sm" data-arq-ver="${a.id}">${icone('olho', 14)} Ver</button>
            <button class="btn btn-secundario btn-sm" data-arq-baixar="${a.id}">${icone('download', 14)} Baixar</button>
            <button class="btn btn-secundario btn-sm" data-arq-del="${a.id}">${icone('lixo', 14)}</button></td></tr>`).join('')}
          </tbody></table></div>`}`;
        alvo.querySelector('#btn-enviar-arq').addEventListener('click', async () => {
          const input = alvo.querySelector('#arq-input');
          const arq = input.files && input.files[0];
          if (!arq) return toast('Selecione um arquivo.', 'erro');
          try {
            await enviarArquivoParaCliente(clienteId, arq);
            toast('Arquivo anexado.', 'sucesso');
            carregar();
          } catch (err) {
            toast(err.message || 'Não foi possível enviar.', 'erro');
          }
        });
        const porId = (id) => arquivos.find((x) => String(x.id) === String(id));
        alvo.querySelectorAll('[data-arq-ver]').forEach((b) => b.addEventListener('click', async () => {
          try {
            const url = await loja.baixarArquivo(clienteId, porId(b.dataset.arqVer));
            window.open(url, '_blank', 'noopener');
          } catch (err) { toast(err.message || 'Não foi possível abrir.', 'erro'); }
        }));
        alvo.querySelectorAll('[data-arq-baixar]').forEach((b) => b.addEventListener('click', async () => {
          try {
            const a = porId(b.dataset.arqBaixar);
            const url = await loja.baixarArquivo(clienteId, a);
            const link = document.createElement('a');
            link.href = url; link.download = a.nome; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
          } catch (err) { toast(err.message || 'Não foi possível baixar.', 'erro'); }
        }));
        alvo.querySelectorAll('[data-arq-del]').forEach((b) => b.addEventListener('click', async () => {
          const ok = await confirmarAcao({ titulo: 'Excluir arquivo', mensagem: 'Deseja excluir este arquivo? Esta ação não pode ser desfeita.', textoConfirmar: 'Excluir', perigo: true });
          if (!ok) return;
          try {
            await loja.excluirArquivo(clienteId, b.dataset.arqDel);
            toast('Arquivo excluído.', 'sucesso');
            carregar();
          } catch (err) { toast(err.message || 'Não foi possível excluir.', 'erro'); }
        }));
      })();
    }
  }

  function kpiMini(titulo, valor) {
    return `<div class="card"><div class="card-titulo">${titulo}</div><div style="font-size:20px;font-weight:800;margin-top:8px">${valor}</div></div>`;
  }
  function rotuloStatusEmp(s) { return { andamento: 'Em andamento', quitado: 'Quitado', atraso: 'Em atraso', cancelado: 'Cancelado' }[s] || s; }
  function corStatusEmp(s) { return { andamento: 'azul', quitado: 'verde', atraso: 'vermelho', cancelado: 'cinza' }[s] || 'cinza'; }
  function rotuloForma(f) { return { pix: 'PIX', dinheiro: 'Dinheiro', transferencia: 'Transferência', cartao: 'Cartão', outro: 'Outro' }[f] || f; }

  await carregar();
}

  Object.assign(window.CP, { abrirModalNovoCliente, abrirModalEditarCliente, renderClientes, renderClienteDetalhe, formatarTelefoneExibicao });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarMoeda, formatarData, reaisParaCentavos, mascaraMoedaInput, calcularPorValorFinal, calcularPorPercentual, gerarCronogramaParcelas, statusParcela, ROTULOS_STATUS_PARCELA, CORES_STATUS_PARCELA, dataParaISO, hoje, escapeHtml, icone, estadoCarregando, estadoVazio, badgeStatus, toast, abrirModal, confirmarAcao, gerarChaveIdempotencia, criarSeletorCliente } = window.CP;

const FILTROS = [
  { id: 'todos', label: 'Todos' }, { id: 'andamento', label: 'Em andamento' }, { id: 'quitado', label: 'Quitados' },
  { id: 'atraso', label: 'Em atraso' }, { id: 'cancelado', label: 'Cancelados' },
];

function abrirModalNovoEmprestimo({ clientePreSelecionado, valoresIniciais, aoSalvar } = {}) {
  let clienteSelecionado = clientePreSelecionado || null;
  let modo = 'valor-final';

  const { elemento, fechar } = abrirModal({
    titulo: 'Novo empréstimo', tamanho: 'lg',
    corpoHtml: `
      <div class="campo">
        <label>Cliente *</label>
        <div id="emp-cliente-wrap"></div>
      </div>

      <div class="tabs" style="margin-top:6px">
        <div class="tab-item ativo" data-modo="valor-final">Informar valor final</div>
        <div class="tab-item" data-modo="percentual">Informar percentual</div>
      </div>

      <div class="form-grid">
        <div class="campo"><label>Valor emprestado (R$) *</label><input class="input" id="emp-capital" placeholder="0,00"></div>
        <div class="campo" id="wrap-valor-final"><label>Valor total a receber (R$)</label><input class="input" id="emp-total" placeholder="0,00"></div>
        <div class="campo oculto" id="wrap-percentual"><label>Percentual de acréscimo (%)</label><input class="input" type="number" step="0.01" id="emp-percentual" placeholder="Ex: 50"></div>
        <div class="campo"><label>Data da operação</label><input class="input" type="date" id="emp-data-operacao" value="${dataParaISO(hoje())}"></div>
      </div>

      <div class="calc-resultado" id="emp-calc-resultado" style="margin-bottom:18px">
        <div class="item"><div class="rotulo">Ganho previsto</div><div class="valor" id="calc-ganho">R$ 0,00</div></div>
        <div class="item"><div class="rotulo">Percentual</div><div class="valor" id="calc-percentual">0%</div></div>
      </div>

      <div class="form-grid">
        <div class="campo"><label>Quantidade de parcelas</label><input class="input" type="number" min="1" id="emp-qtd-parcelas" value="1"></div>
        <div class="campo"><label>Frequência</label>
          <select class="select" id="emp-frequencia">
            <option value="diario">Diário</option><option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option>
            <option value="mensal" selected>Mensal</option><option value="personalizado">Personalizado</option>
          </select>
        </div>
        <div class="campo"><label>Data da 1ª cobrança</label><input class="input" type="date" id="emp-primeira-cobranca" value="${dataParaISO(hoje())}"></div>
        <div class="campo oculto" id="wrap-dias-personalizado"><label>Intervalo (dias)</label><input class="input" type="number" min="1" id="emp-dias-personalizado" value="30"></div>
      </div>
      <div class="campo form-full"><label>Observações</label><textarea class="input" id="emp-observacoes" rows="2"></textarea></div>

      <div id="emp-cronograma"></div>`,
    rodapeHtml: `<button class="btn btn-secundario" id="btn-cancelar-emp">Cancelar</button><button class="btn btn-primario" id="btn-salvar-emp">Salvar empréstimo</button>`,
  });

  const $ = (sel) => elemento.querySelector(sel);
  mascaraMoedaInput($('#emp-capital'));
  mascaraMoedaInput($('#emp-total'));
  const seletorClienteEmp = criarSeletorCliente({ montarEm: $('#emp-cliente-wrap'), clienteInicial: clienteSelecionado, aoSelecionar: () => {} });
  if (valoresIniciais) {
    $('#emp-capital').value = (valoresIniciais.capital / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    $('#emp-total').value = (valoresIniciais.total / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    $('#emp-qtd-parcelas').value = valoresIniciais.qtdParcelas;
    $('#emp-frequencia').value = valoresIniciais.frequencia;
    if (valoresIniciais.dataPrimeiraCobranca) $('#emp-primeira-cobranca').value = valoresIniciais.dataPrimeiraCobranca;
  }

  let cronogramaManual = null;

  function calcular() {
    const capital = reaisParaCentavos($('#emp-capital').value);
    let ganho = 0, total = 0, percentual = 0;
    if (modo === 'valor-final') {
      total = reaisParaCentavos($('#emp-total').value);
      ({ ganho, percentual } = calcularPorValorFinal(capital, total));
    } else {
      percentual = parseFloat($('#emp-percentual').value) || 0;
      ({ ganho, total } = calcularPorPercentual(capital, percentual));
    }
    $('#calc-ganho').textContent = formatarMoeda(ganho);
    $('#calc-percentual').textContent = `${percentual.toFixed(1).replace('.0', '')}%`;
    gerarCronograma(total);
    return { capital, total, ganho };
  }

  function gerarCronograma(total) {
    const qtd = Math.max(1, parseInt($('#emp-qtd-parcelas').value) || 1);
    const freq = $('#emp-frequencia').value;
    const dias = parseInt($('#emp-dias-personalizado').value) || 30;
    const primeira = $('#emp-primeira-cobranca').value || dataParaISO(hoje());
    cronogramaManual = gerarCronogramaParcelas({ totalCentavos: total, qtdParcelas: qtd, frequencia: freq, dataPrimeira: primeira, diasPersonalizado: dias });
    renderCronograma();
  }

  function renderCronograma() {
    const soma = cronogramaManual.reduce((a, p) => a + p.valor, 0);
    $('#emp-cronograma').innerHTML = `
      <div class="card-titulo" style="margin:14px 0 8px">Cronograma de parcelas</div>
      ${cronogramaManual.map((p, i) => `
      <div class="parcela-linha">
        <span style="font-weight:700;min-width:52px">${p.numero}/${p.total}</span>
        <input class="input" style="max-width:140px" data-parcela-valor="${i}" value="${(p.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}">
        <input class="input" type="date" style="max-width:160px" data-parcela-data="${i}" value="${p.vencimento}">
      </div>`).join('')}
      <div class="texto-xs texto-mudo" style="margin-top:6px">Soma das parcelas: ${formatarMoeda(soma)}</div>`;

    elemento.querySelectorAll('[data-parcela-valor]').forEach((inp) => {
      mascaraMoedaInput(inp);
      inp.addEventListener('input', () => {
        cronogramaManual[inp.dataset.parcelaValor].valor = reaisParaCentavos(inp.value);
        atualizarSomaParcelas();
      });
    });
    elemento.querySelectorAll('[data-parcela-data]').forEach((inp) => {
      inp.addEventListener('change', () => { cronogramaManual[inp.dataset.parcelaData].vencimento = inp.value; });
    });
  }

  function atualizarSomaParcelas() {
    const soma = cronogramaManual.reduce((a, p) => a + p.valor, 0);
    const total = reaisParaCentavos($('#emp-total').value) || cronogramaManual.reduce((a, p) => a + p.valor, 0);
    const elSoma = elemento.querySelector('.texto-xs.texto-mudo');
    if (elSoma) elSoma.innerHTML = `Soma das parcelas: ${formatarMoeda(soma)}` + (soma !== total && modo === 'valor-final' ? ` <span class="texto-negativo">(diferente do valor contratado: ${formatarMoeda(total)})</span>` : '');
  }

  elemento.querySelectorAll('[data-modo]').forEach((tab) => tab.addEventListener('click', () => {
    modo = tab.dataset.modo;
    elemento.querySelectorAll('[data-modo]').forEach((t) => t.classList.toggle('ativo', t === tab));
    $('#wrap-valor-final').classList.toggle('oculto', modo !== 'valor-final');
    $('#wrap-percentual').classList.toggle('oculto', modo !== 'percentual');
    calcular();
  }));

  ['#emp-capital', '#emp-total', '#emp-percentual', '#emp-qtd-parcelas', '#emp-frequencia', '#emp-primeira-cobranca', '#emp-dias-personalizado'].forEach((sel) => {
    $(sel).addEventListener('input', calcular);
    $(sel).addEventListener('change', calcular);
  });
  $('#emp-frequencia').addEventListener('change', () => $('#wrap-dias-personalizado').classList.toggle('oculto', $('#emp-frequencia').value !== 'personalizado'));

  calcular();
  $('#btn-cancelar-emp').addEventListener('click', fechar);
  $('#btn-salvar-emp').addEventListener('click', async () => {
    const btnSalvarEmp = $('#btn-salvar-emp');
    if (btnSalvarEmp.disabled) return; // trava de duplo clique
    const clienteId = seletorClienteEmp.obterClienteId();
    if (!clienteId) return toast('Selecione um cliente.', 'erro');
    const { capital, total } = calcular();
    if (capital <= 0) return toast('Informe o valor emprestado.', 'erro');
    if (total <= capital) return toast('O valor a receber deve ser maior que o capital emprestado.', 'erro');

    const chaveIdempotencia = gerarChaveIdempotencia();
    btnSalvarEmp.disabled = true;
    try {
      await loja.criarEmprestimo({
        clienteId, capital, total, frequencia: $('#emp-frequencia').value,
        dataOperacao: $('#emp-data-operacao').value, observacoes: $('#emp-observacoes').value.trim(),
        parcelas: cronogramaManual, chaveIdempotencia,
      });
      toast('Empréstimo cadastrado com sucesso.', 'sucesso');
      fechar();
      aoSalvar?.();
    } catch (err) {
      toast(err.message || 'Não foi possível salvar o empréstimo.', 'erro');
      btnSalvarEmp.disabled = false;
    }
  });
}

async function renderEmprestimos(container, { abrirRegistrarPagamento, navegarClienteDetalhe }) {
  let filtroAtivo = 'todos';
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let lista;
    try {
      lista = await loja.listarEmprestimos({ status: filtroAtivo });
    } catch (err) {
      container.innerHTML = `<div class="pagina-cabecalho"><h1 class="pagina-titulo">Empréstimos</h1></div>` + estadoVazio({
        iconeNome: 'emprestimos', titulo: 'Não foi possível carregar os empréstimos',
        descricao: err instanceof ErroAPI && err.status === 404 ? 'O endpoint GET /api/emprestimos ainda não existe no backend.' : err.message,
        acaoHtml: `<button class="btn btn-primario" id="btn-demo-emp" style="margin-top:14px">Carregar dados de demonstração</button>`,
      });
      container.querySelector('#btn-demo-emp')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
      return;
    }
    render(lista);
  }

  function render(lista) {
    container.innerHTML = `
    <div class="pagina-cabecalho">
      <div><h1 class="pagina-titulo">Empréstimos</h1><p class="pagina-subtitulo">${lista.length} operaç${lista.length === 1 ? 'ão' : 'ões'}.</p></div>
      <button class="btn btn-primario" id="btn-novo-emprestimo">${icone('mais2', 17)} Novo empréstimo</button>
    </div>
    <div class="filtros-linha">
      ${FILTROS.map((f) => `<button class="filtro-chip ${filtroAtivo === f.id ? 'ativo' : ''}" data-filtro="${f.id}">${f.label}</button>`).join('')}
    </div>
    <div id="lista-emp"></div>`;

    const alvo = container.querySelector('#lista-emp');
    alvo.innerHTML = !lista.length ? estadoVazio({ iconeNome: 'emprestimos', titulo: 'Nenhum empréstimo encontrado', descricao: 'Ajuste o filtro ou cadastre uma nova operação.' }) :
      lista.map((e) => `
      <div class="lista-card">
        <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
          <div class="pessoa-linha">
            <div class="avatar">${(e.cliente?.nome || '?').slice(0, 2).toUpperCase()}</div>
            <div class="pessoa-info">
              <div class="nome">${escapeHtml(e.cliente?.nome || 'Cliente removido')}</div>
              <div class="sub">${formatarMoeda(e.capital)} → ${formatarMoeda(e.total)} · ${e.qtdParcelas}x ${rotuloFreq(e.frequencia)}</div>
            </div>
          </div>
          <div class="flex items-center gap-8">
            ${badgeStatus(rotuloStatus(e.statusCalculado), corStatus(e.statusCalculado))}
          </div>
        </div>
        <div class="grid grid-4" style="margin-top:14px;gap:10px">
          ${miniInfo('Saldo restante', formatarMoeda(e.saldoRestante))}
          ${miniInfo('Próxima cobrança', e.proximaCobranca ? formatarData(e.proximaCobranca) : '—')}
          ${miniInfo('Ganho previsto', formatarMoeda(e.ganhoPrevisto))}
          ${miniInfo('Operação', formatarData(e.dataOperacao))}
        </div>
        <div class="flex gap-8" style="margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-secundario btn-sm" data-ver-cliente="${e.clienteId}">Ver cliente</button>
          <button class="btn btn-secundario btn-sm" data-ver-parcelas="${e.id}">Ver parcelas</button>
          ${e.statusCalculado !== 'quitado' && e.statusCalculado !== 'cancelado' ? `<button class="btn btn-perigo btn-sm" data-cancelar="${e.id}">Cancelar</button>` : ''}
        </div>
        <div class="parcelas-expansiveis oculto" id="parcelas-${e.id}"></div>
      </div>`).join('');

    alvo.querySelectorAll('[data-ver-cliente]').forEach((b) => b.addEventListener('click', () => navegarClienteDetalhe(b.dataset.verCliente)));
    alvo.querySelectorAll('[data-ver-parcelas]').forEach((b) => b.addEventListener('click', () => toggleParcelas(b.dataset.verParcelas, lista)));
    alvo.querySelectorAll('[data-cancelar]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmarAcao({ titulo: 'Cancelar empréstimo', mensagem: 'Esta operação será marcada como cancelada e sairá dos cálculos de dashboard. O histórico será preservado. Deseja continuar?', textoConfirmar: 'Cancelar empréstimo' });
      if (ok) { await loja.cancelarEmprestimo(b.dataset.cancelar); toast('Empréstimo cancelado.', 'sucesso'); carregar(); }
    }));

    container.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => { filtroAtivo = b.dataset.filtro; carregar(); }));
    container.querySelector('#btn-novo-emprestimo').addEventListener('click', () => abrirModalNovoEmprestimo({ aoSalvar: carregar }));
  }

  function toggleParcelas(empId, lista) {
    // mesma causa-raiz corrigida em Cobrancas: id real (SERIAL/int) x
    // dataset (sempre string) precisa de comparacao normalizada.
    const emp = lista.find((e) => String(e.id) === empId);
    const alvo = container.querySelector(`#parcelas-${empId}`);
    if (!emp) return toast('Não foi possível localizar este empréstimo. Atualize a página e tente novamente.', 'erro');
    const oculto = alvo.classList.contains('oculto');
    if (oculto) {
      alvo.innerHTML = (emp.parcelas || []).map((p) => `
        <div class="parcela-linha">
          <span style="font-weight:700;min-width:52px">${p.numero}/${p.total}</span>
          <span>${formatarMoeda(p.valor)}</span>
          <span class="texto-mudo texto-sm">vence ${formatarData(p.vencimento)}</span>
          ${badgeStatus(ROTULOS_STATUS_PARCELA[p.statusCalc], CORES_STATUS_PARCELA[p.statusCalc])}
          ${p.valor - p.valorPago > 0 ? `<button class="btn btn-primario btn-sm" data-registrar-pg="${p.id}" data-emp-id="${empId}" data-cliente-id="${emp.clienteId}">Registrar pagamento</button>` : ''}
        </div>`).join('');
      alvo.classList.remove('oculto');
      alvo.style.marginTop = '12px';
      alvo.querySelectorAll('[data-registrar-pg]').forEach((b) => b.addEventListener('click', () => {
        const parcela = emp.parcelas.find((p) => String(p.id) === b.dataset.registrarPg);
        if (!parcela) return toast('Não foi possível localizar esta parcela. Atualize a página e tente novamente.', 'erro');
        try {
          abrirRegistrarPagamento({
            clienteId: b.dataset.clienteId, emprestimoId: b.dataset.empId, parcelaId: b.dataset.registrarPg,
            parcela, aoSalvar: carregar,
          });
        } catch (err) {
          toast(err?.message || 'Não foi possível abrir o pagamento.', 'erro');
        }
      }));
    } else {
      alvo.classList.add('oculto');
    }
  }

  function miniInfo(rotulo, valor) {
    return `<div><div class="texto-xs texto-mudo">${rotulo}</div><div style="font-weight:700;font-size:14px">${valor}</div></div>`;
  }
  function rotuloFreq(f) { return { diario: 'diário', semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal', personalizado: 'personalizado' }[f] || f; }
  function rotuloStatus(s) { return { andamento: 'Em andamento', quitado: 'Quitado', atraso: 'Em atraso', cancelado: 'Cancelado' }[s] || s; }
  function corStatus(s) { return { andamento: 'azul', quitado: 'verde', atraso: 'vermelho', cancelado: 'cinza' }[s] || 'cinza'; }

  await carregar();
}

function abrirModalRegistrarPagamento({ clienteId, emprestimoId, parcelaId, parcela, parcelas, aoSalvar }) {
  // Aceita parcela única (legado: cobranças chamam com parcelaId+parcela) ou
  // lista de parcelas (ficha do empréstimo). Itens marcados compõem UM
  // recebimento; valores editáveis por parcela (parcial/antecipação).
  const { elemento, fechar } = abrirModal({
    titulo: 'Registrar pagamento',
    tamanho: 'lg',
    corpoHtml: `<div class="carregando"><div class="spinner"></div></div>`,
    rodapeHtml: `<button class="btn btn-secundario" id="cancelar-pg">Cancelar</button><button class="btn btn-primario" id="salvar-pg">Registrar</button>`,
  });
  elemento.querySelector('#cancelar-pg').addEventListener('click', fechar);

  (async () => {
    let lista = Array.isArray(parcelas) && parcelas.length ? parcelas.slice() : (parcela ? [parcela] : []);
    if (!lista.length && emprestimoId) {
      try {
        const emp = await loja.obterEmprestimo(emprestimoId);
        lista = (emp.parcelas || []).filter((p) => (p.valor - (p.valorPago || 0)) > 0);
      } catch (err) {
        elemento.querySelector('.modal-corpo').innerHTML = `<div class="alerta alerta-erro">${escapeHtml(err.message || 'Não foi possível carregar as parcelas.')}</div>`;
        return;
      }
    }
    lista = lista.filter((p) => (p.valor - (p.valorPago || 0)) > 0);
    if (!lista.length) {
      elemento.querySelector('.modal-corpo').innerHTML = `<div class="alerta alerta-aviso">Não há parcelas pendentes.</div>`;
      return;
    }
    const corpo = elemento.querySelector('.modal-corpo');
    corpo.innerHTML = `
      <div class="texto-sm texto-mudo" style="margin-bottom:10px">Marque as parcelas deste recebimento (uma ou várias) e ajuste os valores.</div>
      <div class="tabela-wrap" style="margin-bottom:14px"><table class="tabela"><thead><tr><th></th><th>Nº</th><th>Vencimento</th><th>Saldo</th><th>Valor</th></tr></thead><tbody>
        ${lista.map((p) => {
          const saldo = p.valor - (p.valorPago || 0);
          const marcado = !parcelaId || String(p.id) === String(parcelaId) ? ' checked' : '';
          return `<tr><td><input type="checkbox" data-pg-check="${p.id}"${marcado}></td>
            <td>${p.numero}</td><td>${formatarData(p.vencimento)}</td><td>${formatarMoeda(saldo)}</td>
            <td><input class="input" style="max-width:130px" data-pg-valor="${p.id}" value="${(saldo / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}"></td></tr>`;
        }).join('')}
      </tbody></table></div>
      <div class="calc-resultado" style="margin-bottom:18px">
        <div class="item"><div class="rotulo">Total do recebimento</div><div class="valor" id="pg-total">—</div></div>
      </div>
      <div class="form-grid">
        <div class="campo"><label>Data</label><input class="input" type="date" id="pg-data" value="${dataParaISO(hoje())}"></div>
        <div class="campo"><label>Forma</label>
          <select class="select" id="pg-forma"><option value="pix">PIX</option><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="cartao">Cartão</option><option value="outro">Outro</option></select>
        </div>
        <div class="campo form-full"><label>Observação</label><input class="input" id="pg-obs"></div>
      </div>`;
    const porId = new Map(lista.map((p) => [String(p.id), p]));
    function recalcular() {
      let total = 0;
      corpo.querySelectorAll('[data-pg-check]').forEach((chk) => {
        if (!chk.checked) return;
        const input = corpo.querySelector(`[data-pg-valor="${chk.dataset.pgCheck}"]`);
        const p = porId.get(String(chk.dataset.pgCheck));
        let v = reaisParaCentavos(input.value);
        const saldo = p.valor - (p.valorPago || 0);
        if (v > saldo) { v = saldo; input.value = (saldo / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }
        if (v < 0) { v = 0; input.value = '0,00'; }
        total += v;
      });
      corpo.querySelector('#pg-total').textContent = formatarMoeda(total);
      return total;
    }
    corpo.querySelectorAll('[data-pg-check],[data-pg-valor]').forEach((el) => {
      el.addEventListener('change', recalcular);
      el.addEventListener('input', () => { if (el.hasAttribute('data-pg-valor')) recalcular(); });
    });
    recalcular();

    elemento.querySelector('#salvar-pg').addEventListener('click', async () => {
      const btnSalvar = elemento.querySelector('#salvar-pg');
      if (btnSalvar.disabled) return;
      const itens = [];
      corpo.querySelectorAll('[data-pg-check]').forEach((chk) => {
        if (!chk.checked) return;
        const input = corpo.querySelector(`[data-pg-valor="${chk.dataset.pgCheck}"]`);
        const v = reaisParaCentavos(input.value);
        if (v > 0) itens.push({ parcelaId: chk.dataset.pgCheck, valor: v });
      });
      if (!itens.length) return toast('Marque ao menos uma parcela com valor.', 'erro');
      const total = itens.reduce((a, i) => a + i.valor, 0);
      const chaveIdempotencia = gerarChaveIdempotencia();
      btnSalvar.disabled = true;
      try {
        await loja.registrarPagamento({
          clienteId, emprestimoId, itens, valorRecebido: total,
          data: corpo.querySelector('#pg-data').value, forma: corpo.querySelector('#pg-forma').value,
          observacao: corpo.querySelector('#pg-obs').value.trim(),
          chaveIdempotencia,
        });
        toast(`Recebimento registrado: ${formatarMoeda(total)} em ${itens.length} parcela(s).`, 'sucesso');
        fechar();
        aoSalvar?.();
      } catch (err) {
        toast(err.message || 'Não foi possível registrar o pagamento.', 'erro');
        btnSalvar.disabled = false;
      }
    });
  })();
}

  Object.assign(window.CP, { abrirModalNovoEmprestimo, renderEmprestimos, abrirModalRegistrarPagamento });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarMoeda, formatarData, reaisParaCentavos, mascaraMoedaInput, dataParaISO, hoje, escapeHtml, icone, estadoCarregando, estadoVazio, toast, abrirModal } = window.CP;

function abrirModalNovaMovimentacao({ aoSalvar } = {}) {
  const { elemento, fechar } = abrirModal({
    titulo: 'Nova movimentação',
    corpoHtml: `
      <div class="tabs"><div class="tab-item ativo" data-tipo="entrada">Entrada</div><div class="tab-item" data-tipo="saida">Saída</div></div>
      <div class="form-grid">
        <div class="campo form-full"><label>Descrição *</label><input class="input" id="mv-descricao"></div>
        <div class="campo"><label>Valor (R$) *</label><input class="input" id="mv-valor" placeholder="0,00"></div>
        <div class="campo"><label>Data</label><input class="input" type="date" id="mv-data" value="${dataParaISO(hoje())}"></div>
        <div class="campo form-full"><label>Categoria</label><input class="input" id="mv-categoria" placeholder="Ex: Despesa, Taxa, Retirada..."></div>
        <div class="campo form-full"><label>Observação</label><input class="input" id="mv-obs"></div>
      </div>`,
    rodapeHtml: `<button class="btn btn-secundario" id="cancelar-mv">Cancelar</button><button class="btn btn-primario" id="salvar-mv">Salvar</button>`,
  });
  let tipo = 'entrada';
  mascaraMoedaInput(elemento.querySelector('#mv-valor'));
  elemento.querySelectorAll('[data-tipo]').forEach((t) => t.addEventListener('click', () => {
    tipo = t.dataset.tipo;
    elemento.querySelectorAll('[data-tipo]').forEach((x) => x.classList.toggle('ativo', x === t));
  }));
  elemento.querySelector('#cancelar-mv').addEventListener('click', fechar);
  elemento.querySelector('#salvar-mv').addEventListener('click', async () => {
    const descricao = elemento.querySelector('#mv-descricao').value.trim();
    const valor = reaisParaCentavos(elemento.querySelector('#mv-valor').value);
    if (!descricao) return toast('Informe uma descrição.', 'erro');
    if (valor <= 0) return toast('Informe um valor válido.', 'erro');
    try {
      await loja.criarMovimentacao({
        tipo, descricao, valor, data: elemento.querySelector('#mv-data').value,
        categoria: elemento.querySelector('#mv-categoria').value.trim() || 'Geral',
        observacao: elemento.querySelector('#mv-obs').value.trim(), clienteId: null, emprestimoId: null,
      });
      toast('Movimentação registrada.', 'sucesso');
      fechar(); aoSalvar?.();
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'erro'); }
  });
}

async function renderFinanceiro(container) {
  let abaAtual = 'geral';
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let movimentacoes;
    try {
      movimentacoes = await loja.listarMovimentacoes({});
    } catch (err) {
      container.innerHTML = `<div class="pagina-cabecalho"><h1 class="pagina-titulo">Financeiro</h1></div>` + estadoVazio({
        iconeNome: 'financeiro', titulo: 'Não foi possível carregar o financeiro',
        descricao: err instanceof ErroAPI && err.status === 404 ? 'O endpoint GET /api/financeiro/movimentacoes ainda não existe no backend.' : err.message,
        acaoHtml: `<button class="btn btn-primario" id="btn-demo-fin" style="margin-top:14px">Carregar dados de demonstração</button>`,
      });
      container.querySelector('#btn-demo-fin')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
      return;
    }
    render(movimentacoes);
  }

  function render(movs) {
    const entradas = movs.filter((m) => m.tipo === 'entrada');
    const saidas = movs.filter((m) => m.tipo === 'saida');
    const totalEntradas = entradas.reduce((a, m) => a + m.valor, 0);
    const totalSaidas = saidas.reduce((a, m) => a + m.valor, 0);

    container.innerHTML = `
    <div class="pagina-cabecalho">
      <div><h1 class="pagina-titulo">Financeiro</h1><p class="pagina-subtitulo">Entradas, saídas e movimentações da sua carteira.</p></div>
      <button class="btn btn-primario" id="btn-nova-mov">${icone('mais2', 17)} Nova movimentação</button>
    </div>
    <div class="grid grid-3" style="margin-bottom:20px">
      <div class="card"><div class="card-titulo">Entradas</div><div style="font-size:22px;font-weight:800;margin-top:8px" class="texto-positivo">${formatarMoeda(totalEntradas)}</div></div>
      <div class="card"><div class="card-titulo">Saídas</div><div style="font-size:22px;font-weight:800;margin-top:8px" class="texto-negativo">${formatarMoeda(totalSaidas)}</div></div>
      <div class="card"><div class="card-titulo">Saldo</div><div style="font-size:22px;font-weight:800;margin-top:8px">${formatarMoeda(totalEntradas - totalSaidas)}</div></div>
    </div>
    <div class="tabs">
      ${['geral', 'entradas', 'saidas', 'movimentacoes'].map((a) => `<div class="tab-item ${abaAtual === a ? 'ativo' : ''}" data-aba="${a}">${rotulo(a)}</div>`).join('')}
    </div>
    <div id="conteudo-fin"></div>`;

    container.querySelectorAll('[data-aba]').forEach((t) => t.addEventListener('click', () => { abaAtual = t.dataset.aba; render(movs); }));
    container.querySelector('#btn-nova-mov').addEventListener('click', () => abrirModalNovaMovimentacao({ aoSalvar: carregar }));

    const alvo = container.querySelector('#conteudo-fin');
    const lista = abaAtual === 'entradas' ? entradas : abaAtual === 'saidas' ? saidas : movs;
    if (abaAtual === 'geral') {
      alvo.innerHTML = `
      <div class="grid grid-2">
        <div class="card"><div class="card-titulo" style="margin-bottom:10px">Por categoria (entradas)</div>${renderCategorias(entradas)}</div>
        <div class="card"><div class="card-titulo" style="margin-bottom:10px">Por categoria (saídas)</div>${renderCategorias(saidas)}</div>
      </div>`;
    } else {
      alvo.innerHTML = !lista.length ? estadoVazio({ iconeNome: 'financeiro', titulo: 'Nenhuma movimentação', descricao: 'Nenhum registro encontrado nesta visão.' }) :
        `<div class="tabela-wrap card" style="padding:0"><table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Cliente</th><th>Tipo</th><th>Valor</th></tr></thead><tbody>
        ${lista.map((m) => `<tr>
          <td>${formatarData(m.data)}</td><td>${escapeHtml(m.descricao)}</td><td>${escapeHtml(m.categoria)}</td>
          <td>${escapeHtml(m.cliente?.nome || '—')}</td>
          <td>${m.tipo === 'entrada' ? '<span class="texto-positivo">Entrada</span>' : '<span class="texto-negativo">Saída</span>'}</td>
          <td style="font-weight:700">${formatarMoeda(m.valor)}</td>
        </tr>`).join('')}
        </tbody></table></div>`;
    }
  }

  function renderCategorias(lista) {
    const mapa = new Map();
    for (const m of lista) mapa.set(m.categoria, (mapa.get(m.categoria) || 0) + m.valor);
    const total = [...mapa.values()].reduce((a, v) => a + v, 0) || 1;
    if (!mapa.size) return `<p class="texto-mudo texto-sm">Sem registros.</p>`;
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]).map(([cat, valor]) => `
      <div style="margin-bottom:12px">
        <div class="flex justify-between texto-sm" style="margin-bottom:5px"><span>${escapeHtml(cat)}</span><span style="font-weight:700">${formatarMoeda(valor)}</span></div>
        <div class="barra-progresso"><div class="barra-progresso-preenchida" style="width:${(valor / total) * 100}%"></div></div>
      </div>`).join('');
  }

  function rotulo(a) { return { geral: 'Visão geral', entradas: 'Entradas', saidas: 'Saídas', movimentacoes: 'Movimentações' }[a]; }

  await carregar();
}

  Object.assign(window.CP, { abrirModalNovaMovimentacao, renderFinanceiro });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarMoeda, formatarData, linkWhatsapp, somarDias, dataParaISO, escapeHtml, icone, estadoCarregando, estadoVazio, badgeStatus, toast } = window.CP;

const FILTROS = [
  { id: 'hoje', label: 'Hoje' }, { id: 'amanha', label: 'Amanhã' }, { id: '7dias', label: 'Próximos 7 dias' },
  { id: '30dias', label: 'Próximos 30 dias' }, { id: 'atrasadas', label: 'Atrasadas' }, { id: 'todas', label: 'Todas' },
];

async function renderCobrancas(container, { abrirRegistrarPagamento, navegarClienteDetalhe }) {
  let filtroAtivo = 'hoje';
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let lista;
    try {
      lista = await loja.listarCobrancas({ filtro: filtroAtivo });
    } catch (err) {
      container.innerHTML = `<div class="pagina-cabecalho"><h1 class="pagina-titulo">Cobranças</h1></div>` + estadoVazio({
        iconeNome: 'cobrancas', titulo: 'Não foi possível carregar as cobranças',
        descricao: err instanceof ErroAPI && err.status === 404 ? 'O endpoint GET /api/cobrancas ainda não existe no backend (derivado das parcelas).' : err.message,
        acaoHtml: `<button class="btn btn-primario" id="btn-demo-cob" style="margin-top:14px">Carregar dados de demonstração</button>`,
      });
      container.querySelector('#btn-demo-cob')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
      return;
    }
    render(lista);
  }

  function render(lista) {
    container.innerHTML = `
    <div class="pagina-cabecalho"><div><h1 class="pagina-titulo">Cobranças</h1><p class="pagina-subtitulo">${lista.length} parcela${lista.length === 1 ? '' : 's'} nesta visão.</p></div></div>
    <div class="filtros-linha">${FILTROS.map((f) => `<button class="filtro-chip ${filtroAtivo === f.id ? 'ativo' : ''}" data-filtro="${f.id}">${f.label}</button>`).join('')}</div>
    <div id="lista-cob"></div>`;

    const alvo = container.querySelector('#lista-cob');
    alvo.innerHTML = !lista.length ? estadoVazio({ iconeNome: 'cobrancas', titulo: 'Nenhuma cobrança nesta visão', descricao: 'Tente outro filtro.' }) :
      lista.map((c) => {
        const restante = c.valor - c.valorPago;
        const msg = `Olá, ${c.cliente?.nome?.split(' ')[0] || ''}. Passando para lembrar sobre o pagamento de ${formatarMoeda(restante)} com vencimento em ${formatarData(c.vencimento)}.`;
        return `
        <div class="lista-card">
          <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
            <div class="pessoa-linha">
              <div class="avatar">${(c.cliente?.nome || '?').slice(0, 2).toUpperCase()}</div>
              <div class="pessoa-info"><div class="nome">${escapeHtml(c.cliente?.nome || '—')}</div><div class="sub">Parcela ${c.numero}/${c.total} · ${formatarMoeda(restante)}</div></div>
            </div>
            ${c.diasAtraso > 0 ? badgeStatus(`${c.diasAtraso}d de atraso`, 'vermelho') : badgeStatus(`vence ${formatarData(c.vencimento)}`, 'cinza')}
          </div>
          <div class="flex gap-8" style="margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-primario btn-sm" data-pagar="${c.id}">Registrar pagamento</button>
            <button class="btn btn-secundario btn-sm" data-wpp="${encodeURIComponent(msg)}" data-tel="${c.cliente?.whatsapp || c.cliente?.telefone || ''}">${icone('whatsapp', 14)} WhatsApp</button>
            <button class="btn btn-secundario btn-sm" data-ver="${c.cliente?.id || ''}">Ver cliente</button>
            <button class="btn btn-secundario btn-sm" data-adiar="${c.id}">Adiar lembrete</button>
          </div>
        </div>`;
      }).join('');

    alvo.querySelectorAll('[data-pagar]').forEach((b) => b.addEventListener('click', () => {
      // id real (SERIAL/int) x dataset (sempre string): comparar como string evita
      // que a busca sempre falhe em producao (so funcionava por acidente no modo demo,
      // onde gerarId() ja produz strings).
      const c = lista.find((x) => String(x.id) === b.dataset.pagar);
      if (!c) return toast('Não foi possível localizar esta cobrança. Atualize a página e tente novamente.', 'erro');
      try {
        abrirRegistrarPagamento({ clienteId: c.cliente?.id, emprestimoId: c.emprestimoId, parcelaId: c.id, parcela: c, aoSalvar: carregar });
      } catch (err) {
        toast(err?.message || 'Não foi possível abrir o pagamento.', 'erro');
      }
    }));
    alvo.querySelectorAll('[data-wpp]').forEach((b) => b.addEventListener('click', () => window.open(linkWhatsapp(b.dataset.tel, decodeURIComponent(b.dataset.wpp)), '_blank')));
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.dataset.ver && b.addEventListener('click', () => navegarClienteDetalhe(b.dataset.ver)));
    alvo.querySelectorAll('[data-adiar]').forEach((b) => b.addEventListener('click', async () => {
      const c = lista.find((x) => String(x.id) === b.dataset.adiar);
      if (!c) return toast('Não foi possível localizar esta cobrança. Atualize a página e tente novamente.', 'erro');
      try {
        await loja.ajustarParcela(c.id, { vencimento: dataParaISO(somarDias(new Date(c.vencimento), 1)) });
        toast('Cobrança adiada em 1 dia.', 'sucesso');
        carregar();
      } catch (err) {
        toast(err?.message || 'Não foi possível adiar a cobrança.', 'erro');
      }
    }));

    container.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => { filtroAtivo = b.dataset.filtro; carregar(); }));
  }

  await carregar();
}

  Object.assign(window.CP, { renderCobrancas });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarMoeda, linkWhatsapp, escapeHtml, icone, estadoCarregando, estadoVazio, badgeStatus, toast } = window.CP;

async function renderAtrasos(container, { navegarClienteDetalhe, abrirRegistrarPagamento }) {
  let ordenacao = 'valor';
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let lista;
    try {
      lista = await loja.listarAtrasos();
    } catch (err) {
      container.innerHTML = `<div class="pagina-cabecalho"><h1 class="pagina-titulo">Central de atrasos</h1></div>` + estadoVazio({
        iconeNome: 'atrasos', titulo: 'Não foi possível carregar os atrasos',
        descricao: err instanceof ErroAPI ? err.message : 'Tente novamente em instantes.',
        acaoHtml: `<button class="btn btn-primario" id="btn-demo-atr" style="margin-top:14px">Carregar dados de demonstração</button>`,
      });
      container.querySelector('#btn-demo-atr')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
      return;
    }
    render(lista);
  }

  function render(lista) {
    const ordenada = [...lista].sort((a, b) => {
      if (ordenacao === 'valor') return b.totalVencido - a.totalVencido;
      if (ordenacao === 'atraso') return b.maiorAtraso - a.maiorAtraso;
      if (ordenacao === 'cliente') return (a.cliente?.nome || '').localeCompare(b.cliente?.nome || '');
      return 0;
    });
    const totalVencido = lista.reduce((a, i) => a + i.totalVencido, 0);
    const qtdParcelas = lista.reduce((a, i) => a + i.qtdParcelas, 0);
    const maiorAtraso = lista.reduce((a, i) => Math.max(a, i.maiorAtraso), 0);
    const mediaAtraso = lista.length ? Math.round(lista.reduce((a, i) => a + i.maiorAtraso, 0) / lista.length) : 0;

    container.innerHTML = `
    <div class="pagina-cabecalho"><div><h1 class="pagina-titulo">Central de atrasos</h1><p class="pagina-subtitulo">Acompanhe clientes com parcelas vencidas.</p></div></div>
    <div class="grid grid-4" style="margin-bottom:20px">
      ${kpi('Clientes em atraso', String(lista.length))}
      ${kpi('Total vencido', formatarMoeda(totalVencido))}
      ${kpi('Parcelas vencidas', String(qtdParcelas))}
      ${kpi('Maior atraso', `${maiorAtraso} dias`)}
    </div>
    <div class="flex justify-between items-center" style="margin-bottom:14px">
      <span class="texto-sm texto-mudo">Atraso médio: ${mediaAtraso} dias</span>
      <select class="select" id="sel-ordenacao" style="max-width:220px">
        <option value="valor">Ordenar por maior valor</option>
        <option value="atraso">Ordenar por maior atraso</option>
        <option value="cliente">Ordenar por cliente</option>
      </select>
    </div>
    <div id="lista-atrasos"></div>`;

    container.querySelector('#sel-ordenacao').value = ordenacao;
    container.querySelector('#sel-ordenacao').addEventListener('change', (e) => { ordenacao = e.target.value; render(lista); });

    const alvo = container.querySelector('#lista-atrasos');
    alvo.innerHTML = !ordenada.length ? estadoVazio({ iconeNome: 'check', titulo: 'Nenhum cliente em atraso', descricao: 'Parabéns! Todas as parcelas estão em dia.' }) :
      ordenada.map((item) => `
      <div class="lista-card">
        <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
          <div class="pessoa-linha">
            <div class="avatar">${(item.cliente?.nome || '?').slice(0, 2).toUpperCase()}</div>
            <div class="pessoa-info"><div class="nome">${escapeHtml(item.cliente?.nome || '—')}</div><div class="sub">${item.qtdParcelas} parcela(s) vencida(s)</div></div>
          </div>
          ${badgeStatus(`${item.maiorAtraso}d de atraso`, 'vermelho')}
        </div>
        <div class="grid grid-2" style="margin-top:12px;gap:10px">
          <div><div class="texto-xs texto-mudo">Total vencido</div><div style="font-weight:800;font-size:16px" class="texto-negativo">${formatarMoeda(item.totalVencido)}</div></div>
          <div><div class="texto-xs texto-mudo">Maior atraso</div><div style="font-weight:700">${item.maiorAtraso} dias</div></div>
        </div>
        <div class="flex gap-8" style="margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-secundario btn-sm" data-wpp="${item.cliente?.id}">${icone('whatsapp', 14)} WhatsApp</button>
          <button class="btn btn-secundario btn-sm" data-ver="${item.cliente?.id}">Ver cliente</button>
        </div>
      </div>`).join('');

    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => navegarClienteDetalhe(b.dataset.ver)));
    alvo.querySelectorAll('[data-wpp]').forEach((b) => b.addEventListener('click', () => {
      const item = ordenada.find((x) => x.cliente?.id === b.dataset.wpp);
      const msg = `Olá, ${item.cliente?.nome?.split(' ')[0] || ''}. Notamos um valor em aberto de ${formatarMoeda(item.totalVencido)}. Podemos combinar o pagamento?`;
      window.open(linkWhatsapp(item.cliente?.whatsapp || item.cliente?.telefone, msg), '_blank');
    }));
  }

  function kpi(titulo, valor) {
    return `<div class="card"><div class="card-titulo">${titulo}</div><div style="font-size:21px;font-weight:800;margin-top:8px">${valor}</div></div>`;
  }

  await carregar();
}

  Object.assign(window.CP, { renderAtrasos });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarData, dataParaISO, hoje, escapeHtml, icone, estadoCarregando, estadoVazio, badgeStatus, toast, abrirModal, confirmarAcao } = window.CP;

const TIPOS = { cobranca: 'Cobrança', cliente: 'Cliente', operacao: 'Operação', reuniao: 'Reunião', pessoal: 'Lembrete pessoal' };
const PRIORIDADES = { alta: 'vermelho', media: 'amarelo', baixa: 'cinza' };

function abrirModalNovoLembrete({ aoSalvar } = {}) {
  const { elemento, fechar } = abrirModal({
    titulo: 'Novo lembrete',
    corpoHtml: `
      <div class="form-grid">
        <div class="campo form-full"><label>Descrição *</label><input class="input" id="lb-desc"></div>
        <div class="campo"><label>Tipo</label><select class="select" id="lb-tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo"><label>Prioridade</label><select class="select" id="lb-prioridade"><option value="alta">Alta</option><option value="media" selected>Média</option><option value="baixa">Baixa</option></select></div>
        <div class="campo"><label>Data</label><input class="input" type="date" id="lb-data" value="${dataParaISO(hoje())}"></div>
        <div class="campo"><label>Horário</label><input class="input" type="time" id="lb-hora" value="09:00"></div>
        <div class="campo form-full"><label>Alerta</label><select class="select" id="lb-alerta"><option value="no-dia">No dia</option><option value="1-dia">1 dia antes</option><option value="3-dias">3 dias antes</option><option value="personalizado">Personalizado</option></select></div>
      </div>`,
    rodapeHtml: `<button class="btn btn-secundario" id="cancelar-lb">Cancelar</button><button class="btn btn-primario" id="salvar-lb">Salvar</button>`,
  });
  elemento.querySelector('#cancelar-lb').addEventListener('click', fechar);
  elemento.querySelector('#salvar-lb').addEventListener('click', async () => {
    const descricao = elemento.querySelector('#lb-desc').value.trim();
    if (!descricao) return toast('Informe a descrição do lembrete.', 'erro');
    try {
      await loja.criarLembrete({
        descricao, tipo: elemento.querySelector('#lb-tipo').value, prioridade: elemento.querySelector('#lb-prioridade').value,
        data: elemento.querySelector('#lb-data').value, hora: elemento.querySelector('#lb-hora').value,
        alerta: elemento.querySelector('#lb-alerta').value, clienteId: null,
      });
      toast('Lembrete criado.', 'sucesso');
      fechar(); aoSalvar?.();
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'erro'); }
  });
}

async function renderLembretes(container) {
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let lista;
    try {
      lista = await loja.listarLembretes();
    } catch (err) {
      container.innerHTML = `<div class="pagina-cabecalho"><h1 class="pagina-titulo">Lembretes</h1></div>` + estadoVazio({
        iconeNome: 'lembretes', titulo: 'Não foi possível carregar os lembretes',
        descricao: err instanceof ErroAPI && err.status === 404 ? 'O endpoint GET /api/lembretes ainda não existe no backend.' : err.message,
        acaoHtml: `<button class="btn btn-primario" id="btn-demo-lb" style="margin-top:14px">Carregar dados de demonstração</button>`,
      });
      container.querySelector('#btn-demo-lb')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
      return;
    }
    render(lista);
  }

  function render(lista) {
    const pendentes = lista.filter((l) => !l.concluido).sort((a, b) => a.data.localeCompare(b.data));
    const concluidos = lista.filter((l) => l.concluido);
    container.innerHTML = `
    <div class="pagina-cabecalho">
      <div><h1 class="pagina-titulo">Lembretes</h1><p class="pagina-subtitulo">${pendentes.length} pendente${pendentes.length === 1 ? '' : 's'}.</p></div>
      <button class="btn btn-primario" id="btn-novo-lembrete">${icone('mais2', 17)} Novo lembrete</button>
    </div>
    <div id="lista-lembretes"></div>
    ${concluidos.length ? `<div class="card-titulo" style="margin:22px 0 10px">Concluídos</div><div id="lista-concluidos"></div>` : ''}`;

    const alvo = container.querySelector('#lista-lembretes');
    alvo.innerHTML = !pendentes.length ? estadoVazio({ iconeNome: 'lembretes', titulo: 'Nenhum lembrete pendente', descricao: 'Crie um lembrete para cobranças, reuniões ou tarefas pessoais.' }) :
      pendentes.map((l) => linhaLembrete(l)).join('');
    vincularAcoes(alvo);

    if (concluidos.length) {
      const alvoC = container.querySelector('#lista-concluidos');
      alvoC.innerHTML = concluidos.map((l) => linhaLembrete(l)).join('');
    }

    container.querySelector('#btn-novo-lembrete').addEventListener('click', () => abrirModalNovoLembrete({ aoSalvar: carregar }));
  }

  function linhaLembrete(l) {
    return `
    <div class="lista-card">
      <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-weight:700;${l.concluido ? 'text-decoration:line-through;color:var(--cinza-500)' : ''}">${escapeHtml(l.descricao)}</div>
          <div class="texto-xs texto-mudo" style="margin-top:4px">${TIPOS[l.tipo] || l.tipo} · ${formatarData(l.data)} ${l.hora || ''} ${l.cliente ? `· ${escapeHtml(l.cliente.nome)}` : ''}</div>
        </div>
        ${badgeStatus(l.prioridade === 'alta' ? 'Alta' : l.prioridade === 'media' ? 'Média' : 'Baixa', PRIORIDADES[l.prioridade] || 'cinza')}
      </div>
      ${!l.concluido ? `<div class="flex gap-8" style="margin-top:10px"><button class="btn btn-secundario btn-sm" data-concluir="${l.id}">${icone('check', 14)} Concluir</button><button class="btn btn-perigo btn-sm" data-excluir="${l.id}">Excluir</button></div>` : ''}
    </div>`;
  }

  function vincularAcoes(alvo) {
    alvo.querySelectorAll('[data-concluir]').forEach((b) => b.addEventListener('click', async () => { await loja.concluirLembrete(b.dataset.concluir); toast('Lembrete concluído.', 'sucesso'); carregar(); }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmarAcao({ titulo: 'Excluir lembrete', mensagem: 'Deseja realmente excluir este lembrete?', textoConfirmar: 'Excluir' });
      if (ok) { await loja.excluirLembrete(b.dataset.excluir); toast('Lembrete excluído.', 'sucesso'); carregar(); }
    }));
  }

  await carregar();
}

  Object.assign(window.CP, { abrirModalNovoLembrete, renderLembretes });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarMoeda, formatarData, reaisParaCentavos, mascaraMoedaInput, dataParaISO, hoje, somarMeses, escapeHtml, icone, estadoCarregando, estadoVazio, toast, abrirModal, confirmarAcao } = window.CP;

const TIPOS = { capital_emprestado: 'Capital emprestado', recebimentos: 'Recebimentos', ganho: 'Ganho', quantidade_operacoes: 'Quantidade de operações' };

function abrirModalNovaMeta({ aoSalvar } = {}) {
  const { elemento, fechar } = abrirModal({
    titulo: 'Nova meta',
    corpoHtml: `
      <div class="form-grid">
        <div class="campo form-full"><label>Título *</label><input class="input" id="mt-titulo"></div>
        <div class="campo"><label>Tipo</label><select class="select" id="mt-tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo"><label>Período</label><select class="select" id="mt-periodo"><option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option><option value="personalizado">Personalizado</option></select></div>
        <div class="campo" id="wrap-valor-alvo"><label>Valor alvo (R$)</label><input class="input" id="mt-valor" placeholder="0,00"></div>
        <div class="campo" id="wrap-qtd-alvo"><label>Quantidade alvo</label><input class="input" type="number" id="mt-qtd" min="1"></div>
        <div class="campo"><label>Início</label><input class="input" type="date" id="mt-inicio" value="${dataParaISO(hoje())}"></div>
        <div class="campo"><label>Fim</label><input class="input" type="date" id="mt-fim" value="${dataParaISO(somarMeses(hoje(), 1))}"></div>
      </div>`,
    rodapeHtml: `<button class="btn btn-secundario" id="cancelar-mt">Cancelar</button><button class="btn btn-primario" id="salvar-mt">Salvar</button>`,
  });
  const $ = (s) => elemento.querySelector(s);
  mascaraMoedaInput($('#mt-valor'));
  function atualizarCampos() {
    const eQtd = $('#mt-tipo').value === 'quantidade_operacoes';
    $('#wrap-valor-alvo').classList.toggle('oculto', eQtd);
    $('#wrap-qtd-alvo').classList.toggle('oculto', !eQtd);
  }
  $('#mt-tipo').addEventListener('change', atualizarCampos);
  atualizarCampos();

  $('#cancelar-mt').addEventListener('click', fechar);
  $('#salvar-mt').addEventListener('click', async () => {
    const titulo = $('#mt-titulo').value.trim();
    if (!titulo) return toast('Informe um título para a meta.', 'erro');
    const tipo = $('#mt-tipo').value;
    const valorAlvo = tipo === 'quantidade_operacoes' ? (parseInt($('#mt-qtd').value) || 0) : reaisParaCentavos($('#mt-valor').value);
    if (valorAlvo <= 0) return toast('Informe um valor alvo válido.', 'erro');
    try {
      await loja.criarMeta({ titulo, tipo, periodo: $('#mt-periodo').value, valorAlvo, dataInicio: $('#mt-inicio').value, dataFim: $('#mt-fim').value });
      toast('Meta criada.', 'sucesso');
      fechar(); aoSalvar?.();
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'erro'); }
  });
}

async function renderMetas(container) {
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let metas;
    try {
      metas = await loja.listarMetas();
    } catch (err) {
      container.innerHTML = `<div class="pagina-cabecalho"><h1 class="pagina-titulo">Metas</h1></div>` + estadoVazio({
        iconeNome: 'metas', titulo: 'Não foi possível carregar as metas',
        descricao: err instanceof ErroAPI && err.status === 404 ? 'O endpoint GET /api/metas ainda não existe no backend.' : err.message,
        acaoHtml: `<button class="btn btn-primario" id="btn-demo-mt" style="margin-top:14px">Carregar dados de demonstração</button>`,
      });
      container.querySelector('#btn-demo-mt')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
      return;
    }
    const comProgresso = await Promise.all(metas.map(async (m) => ({ ...m, realizado: await loja.calcularProgressoMeta(m) })));
    render(comProgresso);
  }

  function render(metas) {
    container.innerHTML = `
    <div class="pagina-cabecalho">
      <div><h1 class="pagina-titulo">Metas</h1><p class="pagina-subtitulo">Acompanhe seu progresso.</p></div>
      <button class="btn btn-primario" id="btn-nova-meta">${icone('mais2', 17)} Nova meta</button>
    </div>
    <div id="lista-metas" class="grid grid-2"></div>`;

    const alvo = container.querySelector('#lista-metas');
    alvo.innerHTML = !metas.length ? estadoVazio({ iconeNome: 'metas', titulo: 'Nenhuma meta cadastrada', descricao: 'Defina metas de capital, recebimento, ganho ou operações.' }) :
      metas.map((m) => {
        const ehQtd = m.tipo === 'quantidade_operacoes';
        const pct = Math.min(100, Math.round((m.realizado / m.valorAlvo) * 100)) || 0;
        const faltam = Math.max(0, m.valorAlvo - m.realizado);
        return `
        <div class="card">
          <div class="flex justify-between items-start">
            <div><div style="font-weight:700">${escapeHtml(m.titulo)}</div><div class="texto-xs texto-mudo" style="margin-top:2px">${TIPOS[m.tipo]} · ${formatarData(m.dataInicio)} a ${formatarData(m.dataFim)}</div></div>
            <button class="btn-icone" data-excluir-meta="${m.id}">${icone('lixo', 16)}</button>
          </div>
          <div class="barra-progresso" style="margin:16px 0 8px"><div class="barra-progresso-preenchida" style="width:${pct}%"></div></div>
          <div class="flex justify-between texto-sm">
            <span>Realizado: <strong>${ehQtd ? m.realizado : formatarMoeda(m.realizado)}</strong></span>
            <span class="texto-mudo">${pct}%</span>
          </div>
          <div class="texto-xs texto-mudo" style="margin-top:6px">Meta: ${ehQtd ? m.valorAlvo : formatarMoeda(m.valorAlvo)} · Faltam ${ehQtd ? faltam : formatarMoeda(faltam)}</div>
        </div>`;
      }).join('');

    alvo.querySelectorAll('[data-excluir-meta]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmarAcao({ titulo: 'Excluir meta', mensagem: 'Deseja realmente excluir esta meta?', textoConfirmar: 'Excluir' });
      if (ok) { await loja.excluirMeta(b.dataset.excluirMeta); toast('Meta excluída.', 'sucesso'); carregar(); }
    }));
    container.querySelector('#btn-nova-meta').addEventListener('click', () => abrirModalNovaMeta({ aoSalvar: carregar }));
  }

  await carregar();
}

  Object.assign(window.CP, { abrirModalNovaMeta, renderMetas });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const {
    formatarMoeda, reaisParaCentavos, mascaraMoedaInput, calcularPorValorFinal, calcularPorPercentual,
    dataParaISO, hoje, icone, abrirModalNovoEmprestimo, gerarCronogramaParcelas, escapeHtml, toast,
    abrirModal, loja, gerarChaveIdempotencia, linkWhatsapp, criarSeletorCliente, formatarData,
    estadoVazio, badgeStatus,
  } = window.CP;

function rotuloFreqSim(f) {
  return { diario: 'diário', semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal', personalizado: 'personalizado' }[f] || f;
}

function rotuloCorStatusSim(status) {
  return { em_aberto: ['Em aberto', 'azul'], convertida: ['Convertida', 'verde'], arquivada: ['Arquivada', 'cinza'] }[status] || [status, 'cinza'];
}

function nomeSimulacaoPadrao(cliente) {
  if (cliente) return `Simulação - ${cliente.nome}`;
  return `Simulação ${formatarData(dataParaISO(hoje()))}`;
}

// Texto voltado ao cliente (Copiar simulação / WhatsApp): sem lucro, percentual ou marca.
function textoSimulacao(sim) {
  const linhas = [];
  linhas.push('SIMULAÇÃO DE EMPRÉSTIMO');
  linhas.push('');
  if (sim.cliente) linhas.push(`Cliente: ${sim.cliente.nome}`);
  linhas.push(`Valor do empréstimo: ${formatarMoeda(sim.capital)}`);
  linhas.push(`Quantidade: ${sim.parcelas.length} parcelas`);
  linhas.push(`Frequência: ${rotuloFreqSim(sim.frequencia)}`);
  linhas.push('');
  linhas.push('VENCIMENTOS');
  linhas.push('');
  sim.parcelas.forEach((p, i) => { linhas.push(`${i + 1}ª parcela — ${formatarData(p.vencimento)} — ${formatarMoeda(p.valor)}`); });
  linhas.push('');
  linhas.push(`Início: ${formatarData(sim.parcelas[0].vencimento)}`);
  linhas.push(`Término: ${formatarData(sim.parcelas[sim.parcelas.length - 1].vencimento)}`);
  return linhas.join('\n');
}

async function copiarSimulacao(sim) {
  if (!sim.parcelas || !sim.parcelas.length) return toast('Gere um cronograma antes de copiar.', 'erro');
  try {
    await navigator.clipboard.writeText(textoSimulacao(sim));
    toast('Simulação copiada.', 'sucesso');
  } catch (err) {
    toast('Não foi possível copiar. Copie manualmente.', 'erro');
  }
}

function whatsappSimulacao(sim) {
  if (!sim.parcelas || !sim.parcelas.length) return toast('Gere um cronograma antes de compartilhar.', 'erro');
  const texto = textoSimulacao(sim);
  const tel = sim.cliente ? (sim.cliente.whatsapp || sim.cliente.telefone || '') : '';
  window.open(linkWhatsapp(tel, texto), '_blank');
}

function nomeArquivoPdf(sim) {
  const base = sim.cliente ? sim.cliente.nome : 'sem-cliente';
  const slug = base.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `simulacao-emprestimo-${slug}-${dd}-${mm}-${d.getFullYear()}.pdf`;
}

// PDF voltado ao cliente: sem marca CredPlus, ganho, percentual ou total a receber.
function gerarPdfSimulacao(sim) {
  if (!sim.parcelas || !sim.parcelas.length) return toast('Gere um cronograma antes de gerar o PDF.', 'erro');
  if (typeof window.jspdf === 'undefined') { toast('Biblioteca de PDF não carregada.', 'erro'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const corVerde = [5, 46, 33];
  const corVerdeClaro = [22, 101, 52];

  doc.setFillColor(corVerde[0], corVerde[1], corVerde[2]);
  doc.rect(0, 0, 595, 60, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Simulação de empréstimo', 40, 36);

  let y = 92;
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.text(`Data da simulação: ${formatarData(dataParaISO(hoje()))}`, 40, y);
  y += 18;
  if (sim.cliente) { doc.text(`Cliente: ${sim.cliente.nome}`, 40, y); y += 18; }

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(corVerdeClaro[0], corVerdeClaro[1], corVerdeClaro[2]);
  doc.text('RESUMO', 40, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  const resumo = [
    `Valor do empréstimo: ${formatarMoeda(sim.capital)}`,
    `Quantidade de parcelas: ${sim.parcelas.length} parcelas`,
    `Frequência: ${rotuloFreqSim(sim.frequencia)}`,
    `Início dos pagamentos: ${formatarData(sim.parcelas[0].vencimento)}`,
    `Término dos pagamentos: ${formatarData(sim.parcelas[sim.parcelas.length - 1].vencimento)}`,
  ];
  resumo.forEach((linha) => { doc.text(linha, 40, y); y += 15; });

  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(corVerdeClaro[0], corVerdeClaro[1], corVerdeClaro[2]);
  doc.text('CRONOGRAMA DE PAGAMENTOS', 40, y);
  y += 8;

  const linhasTabela = sim.parcelas.map((p, i) => [String(i + 1).padStart(2, '0'), formatarData(p.vencimento), formatarMoeda(p.valor)]);
  doc.autoTable({
    startY: y, head: [['Nº', 'Vencimento', 'Valor da parcela']], body: linhasTabela,
    theme: 'striped', headStyles: { fillColor: corVerde, textColor: 255 },
    styles: { fontSize: 9 }, margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const alturaPagina = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text('Esta simulação tem caráter informativo. Em caso de dúvidas, entre em contato.', 40, alturaPagina - 24);
    },
  });

  doc.save(nomeArquivoPdf(sim));
}

function renderSimulador(container) {
  let modo = 'valor-final';
  let clienteSelecionado = null;
  let cronogramaAtual = [];
  let simulacaoAtualId = null;
  let statusFiltroSalvas = 'todas';
  let buscaSalvas = '';
  let seletorClientePrincipal = null;

  container.innerHTML = `
  <div class="pagina-cabecalho"><div><h1 class="pagina-titulo">Simulador de operação</h1><p class="pagina-subtitulo">Calcule uma operação antes de cadastrá-la.</p></div></div>
  <div class="grid grid-2" style="align-items:start">
    <div class="card">
      <div class="tabs"><div class="tab-item ativo" data-modo="valor-final">Valor final</div><div class="tab-item" data-modo="percentual">Percentual</div></div>
      <div class="campo"><label>Valor a emprestar (R$)</label><input class="input" id="sim-capital" placeholder="0,00"></div>
      <div class="campo" id="sim-wrap-total"><label>Valor total a receber (R$)</label><input class="input" id="sim-total" placeholder="0,00"></div>
      <div class="campo oculto" id="sim-wrap-percentual"><label>Percentual (%)</label><input class="input" type="number" step="0.01" id="sim-percentual" placeholder="Ex: 50"></div>
      <div class="form-grid">
        <div class="campo"><label>Quantidade de parcelas</label><input class="input" type="number" min="1" value="1" id="sim-qtd"></div>
        <div class="campo"><label>Frequência</label>
          <select class="select" id="sim-freq">
            <option value="diario">Diário</option><option value="semanal">Semanal</option><option value="quinzenal">Quinzenal</option>
            <option value="mensal" selected>Mensal</option><option value="personalizado">Personalizado</option>
          </select>
        </div>
        <div class="campo"><label>Data da 1ª cobrança</label><input class="input" type="date" id="sim-primeira-cobranca" value="${dataParaISO(hoje())}"></div>
        <div class="campo oculto" id="sim-wrap-dias-personalizado"><label>Intervalo (dias)</label><input class="input" type="number" min="1" id="sim-dias-personalizado" value="30"></div>
      </div>
      <div class="campo" style="margin-top:4px"><label>Cliente (opcional)</label><div id="sim-cliente-wrap"></div></div>
    </div>
    <div class="card">
      <div class="card-titulo" style="margin-bottom:16px">Resultado</div>
      <div class="calc-resultado" style="grid-template-columns:1fr 1fr;margin-bottom:16px">
        <div class="item"><div class="rotulo">Capital</div><div class="valor" id="res-capital">R$ 0,00</div></div>
        <div class="item"><div class="rotulo">Ganho previsto</div><div class="valor" id="res-ganho">R$ 0,00</div></div>
        <div class="item"><div class="rotulo">Total a receber</div><div class="valor" id="res-total">R$ 0,00</div></div>
        <div class="item"><div class="rotulo">Percentual</div><div class="valor" id="res-percentual">0%</div></div>
      </div>
      <div id="sim-cronograma"></div>
      <div class="flex gap-8" style="margin-top:18px;flex-wrap:wrap">
        <button class="btn btn-primario" id="btn-salvar-sim">${icone('check', 16)} Salvar simulação</button>
        <button class="btn btn-secundario" id="btn-copiar-sim">Copiar simulação</button>
        <button class="btn btn-secundario" id="btn-whatsapp-sim">WhatsApp</button>
        <button class="btn btn-secundario" id="btn-pdf-sim">Gerar PDF</button>
        <button class="btn btn-secundario" id="btn-transformar-sim">${icone('emprestimos', 17)} Transformar em empréstimo</button>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:20px">
    <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:10px;margin-bottom:14px">
      <div class="card-titulo" style="margin:0">Simulações salvas</div>
      <input class="input" id="sim-busca-salvas" placeholder="Buscar por nome ou cliente..." style="max-width:260px">
    </div>
    <div class="filtros-linha" style="margin-bottom:14px">
      <button class="filtro-chip ativo" data-status-sim="todas">Todas</button>
      <button class="filtro-chip" data-status-sim="em_aberto">Em aberto</button>
      <button class="filtro-chip" data-status-sim="convertida">Convertidas</button>
      <button class="filtro-chip" data-status-sim="arquivada">Arquivadas</button>
    </div>
    <div id="sim-salvas-lista"></div>
  </div>`;

  const $ = (s) => container.querySelector(s);
  mascaraMoedaInput($('#sim-capital'));
  mascaraMoedaInput($('#sim-total'));

  seletorClientePrincipal = criarSeletorCliente({
    montarEm: $('#sim-cliente-wrap'),
    aoSelecionar: (c) => { clienteSelecionado = c; },
  });

  function calcular() {
    const capital = reaisParaCentavos($('#sim-capital').value);
    let ganho = 0, total = 0, percentual = 0;
    if (modo === 'valor-final') {
      total = reaisParaCentavos($('#sim-total').value);
      ({ ganho, percentual } = calcularPorValorFinal(capital, total));
    } else {
      percentual = parseFloat($('#sim-percentual').value) || 0;
      ({ ganho, total } = calcularPorPercentual(capital, percentual));
    }
    $('#res-capital').textContent = formatarMoeda(capital);
    $('#res-ganho').textContent = formatarMoeda(ganho);
    $('#res-total').textContent = formatarMoeda(total);
    $('#res-percentual').textContent = `${percentual.toFixed(1).replace('.0', '')}%`;

    const qtd = Math.max(1, parseInt($('#sim-qtd').value) || 1);
    const freq = $('#sim-freq').value;
    const dias = parseInt($('#sim-dias-personalizado').value) || 30;
    const primeira = $('#sim-primeira-cobranca').value || dataParaISO(hoje());
    cronogramaAtual = (capital > 0 && total > capital) ? gerarCronogramaParcelas({ totalCentavos: total, qtdParcelas: qtd, frequencia: freq, dataPrimeira: primeira, diasPersonalizado: dias }) : [];
    renderCronograma();
    return { capital, total, ganho, percentual };
  }

  function renderCronograma() {
    const alvo = $('#sim-cronograma');
    if (!cronogramaAtual.length) { alvo.innerHTML = ''; return; }
    const inicio = cronogramaAtual[0].vencimento;
    const fim = cronogramaAtual[cronogramaAtual.length - 1].vencimento;
    const total = cronogramaAtual.reduce((a, p) => a + p.valor, 0);
    alvo.innerHTML = `
      <div class="card-titulo" style="margin:18px 0 10px">Cronograma da simulação</div>
      <div style="max-height:260px;overflow-y:auto">
        ${cronogramaAtual.map((p) => `
        <div class="parcela-linha">
          <span style="font-weight:700;min-width:76px">Parcela ${String(p.numero).padStart(2, '0')}</span>
          <span class="texto-mudo">${formatarData(p.vencimento)}</span>
          <span style="font-weight:600;margin-left:auto">${formatarMoeda(p.valor)}</span>
        </div>`).join('')}
      </div>
      <div class="texto-xs texto-mudo" style="margin-top:10px;line-height:1.7">
        Início dos pagamentos: ${formatarData(inicio)}<br>
        Última parcela: ${formatarData(fim)}<br>
        Quantidade: ${cronogramaAtual.length} parcelas<br>
        Frequência: ${rotuloFreqSim($('#sim-freq').value)}<br>
        Valor total: ${formatarMoeda(total)}
      </div>`;
  }

  function obterSimulacaoAtual() {
    const { capital, total, percentual } = calcular();
    return {
      cliente: clienteSelecionado, capital, total, modo, percentual,
      qtdParcelas: cronogramaAtual.length, frequencia: $('#sim-freq').value,
      diasPersonalizado: $('#sim-freq').value === 'personalizado' ? (parseInt($('#sim-dias-personalizado').value) || 30) : null,
      dataPrimeiraCobranca: $('#sim-primeira-cobranca').value,
      parcelas: cronogramaAtual,
    };
  }

  container.querySelectorAll('[data-modo]').forEach((t) => t.addEventListener('click', () => {
    modo = t.dataset.modo;
    container.querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('ativo', x === t));
    $('#sim-wrap-total').classList.toggle('oculto', modo !== 'valor-final');
    $('#sim-wrap-percentual').classList.toggle('oculto', modo !== 'percentual');
    calcular();
  }));
  ['#sim-capital', '#sim-total', '#sim-percentual', '#sim-qtd', '#sim-freq', '#sim-primeira-cobranca', '#sim-dias-personalizado'].forEach((s) => $(s).addEventListener('input', calcular));
  $('#sim-freq').addEventListener('change', () => { $('#sim-wrap-dias-personalizado').classList.toggle('oculto', $('#sim-freq').value !== 'personalizado'); calcular(); });

  $('#btn-copiar-sim').addEventListener('click', () => copiarSimulacao(obterSimulacaoAtual()));
  $('#btn-whatsapp-sim').addEventListener('click', () => whatsappSimulacao(obterSimulacaoAtual()));
  $('#btn-pdf-sim').addEventListener('click', () => gerarPdfSimulacao(obterSimulacaoAtual()));

  $('#btn-transformar-sim').addEventListener('click', () => {
    const { capital, total } = calcular();
    if (capital <= 0 || total <= capital) return toast('Preencha capital e total corretamente.', 'erro');
    abrirModalNovoEmprestimo({
      clientePreSelecionado: clienteSelecionado,
      valoresIniciais: { capital, total, qtdParcelas: cronogramaAtual.length, frequencia: $('#sim-freq').value, dataPrimeiraCobranca: $('#sim-primeira-cobranca').value },
    });
  });

  function abrirPromptNomeSimulacao(nomePadrao, aoConfirmar) {
    const { elemento, fechar } = abrirModal({
      titulo: 'Salvar simulação',
      corpoHtml: `<div class="campo"><label>Nome da simulação</label><input class="input" id="prompt-nome-sim" value="${escapeHtml(nomePadrao)}"></div>`,
      rodapeHtml: `<button class="btn btn-secundario" id="prompt-cancelar-sim">Cancelar</button><button class="btn btn-primario" id="prompt-confirmar-sim">Salvar</button>`,
    });
    elemento.querySelector('#prompt-cancelar-sim').addEventListener('click', fechar);
    elemento.querySelector('#prompt-confirmar-sim').addEventListener('click', () => {
      const nome = elemento.querySelector('#prompt-nome-sim').value.trim();
      if (!nome) return toast('Informe um nome.', 'erro');
      fechar();
      aoConfirmar(nome);
    });
  }

  $('#btn-salvar-sim').addEventListener('click', () => {
    const dados = obterSimulacaoAtual();
    if (dados.capital <= 0 || dados.total <= dados.capital) return toast('Preencha capital e total corretamente.', 'erro');
    if (!dados.parcelas.length) return toast('Gere um cronograma antes de salvar.', 'erro');
    abrirPromptNomeSimulacao(nomeSimulacaoPadrao(dados.cliente), async (nome) => {
      const payload = {
        clienteId: dados.cliente?.id || null, nome,
        capital: dados.capital, total: dados.total, modo,
        percentual: modo === 'percentual' ? dados.percentual : null,
        qtdParcelas: dados.parcelas.length, frequencia: dados.frequencia,
        diasPersonalizado: dados.diasPersonalizado, dataPrimeiraCobranca: dados.dataPrimeiraCobranca,
        parcelas: dados.parcelas.map((p) => ({ numero: p.numero, valor: p.valor, vencimento: p.vencimento })),
      };
      try {
        if (simulacaoAtualId) {
          await loja.atualizarSimulacao(simulacaoAtualId, payload);
          toast('Simulação atualizada.', 'sucesso');
        } else {
          const criada = await loja.criarSimulacao(payload);
          simulacaoAtualId = criada.id;
          toast('Simulação salva.', 'sucesso');
        }
        carregarSalvas();
      } catch (err) {
        toast(err.message || 'Não foi possível salvar a simulação.', 'erro');
      }
    });
  });

  function preencherFormularioComSimulacao(sim) {
    simulacaoAtualId = sim.id;
    modo = sim.modo;
    container.querySelectorAll('[data-modo]').forEach((t) => t.classList.toggle('ativo', t.dataset.modo === modo));
    $('#sim-wrap-total').classList.toggle('oculto', modo !== 'valor-final');
    $('#sim-wrap-percentual').classList.toggle('oculto', modo !== 'percentual');
    $('#sim-capital').value = (sim.capital / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    if (modo === 'valor-final') $('#sim-total').value = (sim.total / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    else $('#sim-percentual').value = sim.percentual ?? '';
    $('#sim-qtd').value = sim.qtdParcelas;
    $('#sim-freq').value = sim.frequencia;
    $('#sim-wrap-dias-personalizado').classList.toggle('oculto', sim.frequencia !== 'personalizado');
    if (sim.diasPersonalizado) $('#sim-dias-personalizado').value = sim.diasPersonalizado;
    $('#sim-primeira-cobranca').value = sim.parcelas[0]?.vencimento || dataParaISO(hoje());
    clienteSelecionado = sim.cliente || null;
    seletorClientePrincipal.definirCliente(sim.cliente || null);
    calcular();
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Simulação carregada para edição.', 'info');
  }

  function montarModalSimulacao(sim) {
    const inicio = sim.parcelas[0]?.vencimento;
    const fim = sim.parcelas[sim.parcelas.length - 1]?.vencimento;
    const [rotuloSt, corSt] = rotuloCorStatusSim(sim.status);
    const podeEditar = sim.status === 'em_aberto';
    const jaConvertida = sim.status === 'convertida';

    const { elemento, fechar } = abrirModal({
      titulo: sim.nome, tamanho: 'lg',
      corpoHtml: `
        <div style="margin-bottom:14px">${badgeStatus(rotuloSt, corSt)}</div>
        <div class="campo" style="margin-bottom:14px">
          <label>Cliente</label>
          ${sim.cliente ? `<div style="font-weight:600;padding-top:4px">${escapeHtml(sim.cliente.nome)}</div>` : `<div id="sim-modal-seletor-cliente"></div>`}
        </div>
        <div class="calc-resultado" style="grid-template-columns:1fr 1fr;margin-bottom:16px">
          <div class="item"><div class="rotulo">Capital</div><div class="valor">${formatarMoeda(sim.capital)}</div></div>
          <div class="item"><div class="rotulo">Ganho previsto</div><div class="valor">${formatarMoeda(sim.ganhoPrevisto)}</div></div>
          <div class="item"><div class="rotulo">Total a receber</div><div class="valor">${formatarMoeda(sim.total)}</div></div>
          <div class="item"><div class="rotulo">Percentual</div><div class="valor">${sim.percentual != null ? sim.percentual + '%' : '—'}</div></div>
        </div>
        <div class="texto-xs texto-mudo" style="margin-bottom:14px;line-height:1.7">
          Quantidade: ${sim.qtdParcelas} parcelas · Frequência: ${rotuloFreqSim(sim.frequencia)}<br>
          Primeiro vencimento: ${formatarData(inicio)} · Último vencimento: ${formatarData(fim)}
          ${jaConvertida ? '<br>Esta simulação já foi convertida em empréstimo.' : ''}
        </div>
        <div class="card-titulo" style="margin-bottom:8px">Cronograma</div>
        <div style="max-height:220px;overflow-y:auto;margin-bottom:10px">
          ${sim.parcelas.map((p) => `
          <div class="parcela-linha">
            <span style="font-weight:700;min-width:76px">Parcela ${String(p.numero).padStart(2, '0')}</span>
            <span class="texto-mudo">${formatarData(p.vencimento)}</span>
            <span style="font-weight:600;margin-left:auto">${formatarMoeda(p.valor)}</span>
          </div>`).join('')}
        </div>
        ${!jaConvertida ? `
        <div style="margin-top:14px">
          <div class="form-grid">
            <div class="campo"><label>Data da operação</label><input class="input" type="date" id="sim-modal-data-operacao" value="${dataParaISO(hoje())}"></div>
            <div class="campo form-full"><label>Observações</label><input class="input" id="sim-modal-observacoes"></div>
          </div>
        </div>` : ''}`,
      rodapeHtml: `
        <div class="rodape-sim">
          <div class="rodape-sim-secundarios">
            <button class="btn btn-secundario" id="sim-modal-copiar">Copiar</button>
            <button class="btn btn-secundario" id="sim-modal-whatsapp">WhatsApp</button>
            <button class="btn btn-secundario" id="sim-modal-pdf">Gerar PDF</button>
            ${podeEditar ? '<button class="btn btn-secundario" id="sim-modal-arquivar">Arquivar</button>' : ''}
            ${podeEditar ? '<button class="btn btn-secundario" id="sim-modal-editar">Editar simulação</button>' : ''}
          </div>
          ${!jaConvertida ? '<button class="btn btn-primario btn-bloco" id="sim-modal-converter">Transformar em empréstimo</button>' : '<a class="btn btn-primario btn-bloco" href="#/emprestimos">Ver empréstimos</a>'}
        </div>
      `,
    });

    let clienteEscolhidoNoModal = sim.cliente;
    if (!sim.cliente) {
      criarSeletorCliente({
        montarEm: elemento.querySelector('#sim-modal-seletor-cliente'),
        aoSelecionar: async (c) => {
          clienteEscolhidoNoModal = c;
          try {
            await loja.vincularClienteSimulacao(sim.id, c.id);
            toast('Cliente vinculado.', 'sucesso');
          } catch (err) { toast(err.message || 'Não foi possível vincular o cliente.', 'erro'); }
        },
      });
    }

    function simComoObjeto() {
      return { cliente: clienteEscolhidoNoModal, capital: sim.capital, total: sim.total, modo: sim.modo, percentual: sim.percentual, frequencia: sim.frequencia, parcelas: sim.parcelas };
    }

    elemento.querySelector('#sim-modal-copiar').addEventListener('click', () => copiarSimulacao(simComoObjeto()));
    elemento.querySelector('#sim-modal-whatsapp').addEventListener('click', () => whatsappSimulacao(simComoObjeto()));
    elemento.querySelector('#sim-modal-pdf').addEventListener('click', () => gerarPdfSimulacao(simComoObjeto()));

    elemento.querySelector('#sim-modal-arquivar')?.addEventListener('click', async () => {
      try {
        await loja.arquivarSimulacao(sim.id);
        toast('Simulação arquivada.', 'sucesso');
        fechar();
        carregarSalvas();
      } catch (err) { toast(err.message || 'Não foi possível arquivar.', 'erro'); }
    });

    elemento.querySelector('#sim-modal-editar')?.addEventListener('click', () => {
      fechar();
      preencherFormularioComSimulacao(sim);
    });

    elemento.querySelector('#sim-modal-converter')?.addEventListener('click', async () => {
      const btn = elemento.querySelector('#sim-modal-converter');
      if (btn.disabled) return;
      if (!clienteEscolhidoNoModal) return toast('Selecione um cliente antes de converter.', 'erro');
      const dataOperacao = elemento.querySelector('#sim-modal-data-operacao').value;
      const observacoes = elemento.querySelector('#sim-modal-observacoes').value.trim();
      const chaveIdempotencia = gerarChaveIdempotencia();
      btn.disabled = true;
      try {
        const resultado = await loja.converterSimulacao(sim.id, { dataOperacao, observacoes, chaveIdempotencia });
        toast(resultado.jaConvertida ? 'Esta simulação já havia sido convertida.' : 'Empréstimo criado com sucesso.', 'sucesso');
        fechar();
        carregarSalvas();
      } catch (err) {
        toast(err.message || 'Não foi possível converter a simulação.', 'erro');
        btn.disabled = false;
      }
    });
  }

  async function abrirVisualizacaoSimulacao(id) {
    let sim;
    try { sim = await loja.obterSimulacao(id); } catch (err) { toast(err.message || 'Não foi possível carregar a simulação.', 'erro'); return; }
    montarModalSimulacao(sim);
  }

  function renderSalvas(lista) {
    const alvo = $('#sim-salvas-lista');
    alvo.innerHTML = !lista.length ? estadoVazio({ iconeNome: 'simulador', titulo: 'Nenhuma simulação salva', descricao: 'Salve uma simulação para consultar depois.' }) :
      lista.map((s) => {
        const [rotuloSt, corSt] = rotuloCorStatusSim(s.status);
        return `
        <div class="lista-card">
          <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
            <div>
              <div style="font-weight:700">${escapeHtml(s.nome)}</div>
              <div class="texto-xs texto-mudo">${s.cliente ? escapeHtml(s.cliente.nome) : 'Sem cliente'} · ${formatarMoeda(s.capital)} → ${formatarMoeda(s.total)} · ${s.qtdParcelas}x · ${formatarData(s.criadoEm)}</div>
            </div>
            ${badgeStatus(rotuloSt, corSt)}
          </div>
          <div class="flex gap-8" style="margin-top:12px">
            <button class="btn btn-secundario btn-sm" data-ver-sim="${s.id}">Ver simulação</button>
          </div>
        </div>`;
      }).join('');
    alvo.querySelectorAll('[data-ver-sim]').forEach((b) => b.addEventListener('click', () => abrirVisualizacaoSimulacao(b.dataset.verSim)));
  }

  async function carregarSalvas() {
    const lista = await loja.listarSimulacoes({ status: statusFiltroSalvas, busca: buscaSalvas }).catch(() => []);
    renderSalvas(lista);
  }

  container.querySelectorAll('[data-status-sim]').forEach((b) => b.addEventListener('click', () => {
    statusFiltroSalvas = b.dataset.statusSim;
    container.querySelectorAll('[data-status-sim]').forEach((x) => x.classList.toggle('ativo', x === b));
    carregarSalvas();
  }));
  let debounceBuscaSim;
  $('#sim-busca-salvas').addEventListener('input', (e) => {
    clearTimeout(debounceBuscaSim);
    debounceBuscaSim = setTimeout(() => { buscaSalvas = e.target.value; carregarSalvas(); }, 300);
  });

  calcular();
  carregarSalvas();
}

  Object.assign(window.CP, { renderSimulador });
})();

window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarData, escapeHtml, debounce, icone, estadoCarregando, estadoVazio, badgeStatus, toast, abrirModal, confirmarAcao } = window.CP;

const CATEGORIAS = { geral: 'Geral', cliente: 'Cliente', lembrete: 'Lembrete', reuniao: 'Reunião', oportunidade: 'Oportunidade', ideia: 'Ideia' };
const CORES_CAT = { geral: 'cinza', cliente: 'azul', lembrete: 'amarelo', reuniao: 'roxo', oportunidade: 'verde', ideia: 'verde' };

function abrirModalNovaNota({ aoSalvar } = {}) {
  const { elemento, fechar } = abrirModal({
    titulo: 'Nova nota',
    corpoHtml: `
      <div class="form-grid">
        <div class="campo form-full"><label>Título *</label><input class="input" id="nt-titulo"></div>
        <div class="campo form-full"><label>Conteúdo</label><textarea class="input" id="nt-conteudo" rows="4"></textarea></div>
        <div class="campo"><label>Categoria</label><select class="select" id="nt-categoria">${Object.entries(CATEGORIAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo"><label>Fixar nota</label><select class="select" id="nt-fixar"><option value="nao">Não</option><option value="sim">Sim</option></select></div>
      </div>`,
    rodapeHtml: `<button class="btn btn-secundario" id="cancelar-nt">Cancelar</button><button class="btn btn-primario" id="salvar-nt">Salvar</button>`,
  });
  elemento.querySelector('#cancelar-nt').addEventListener('click', fechar);
  elemento.querySelector('#salvar-nt').addEventListener('click', async () => {
    const titulo = elemento.querySelector('#nt-titulo').value.trim();
    if (!titulo) return toast('Informe um título.', 'erro');
    try {
      await loja.criarNota({
        titulo, conteudo: elemento.querySelector('#nt-conteudo').value.trim(),
        categoria: elemento.querySelector('#nt-categoria').value, clienteId: null,
        fixado: elemento.querySelector('#nt-fixar').value === 'sim',
      });
      toast('Nota criada.', 'sucesso');
      fechar(); aoSalvar?.();
    } catch (err) { toast(err.message || 'Não foi possível salvar.', 'erro'); }
  });
}

async function renderNotas(container) {
  let busca = '';
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let lista;
    try {
      lista = await loja.listarNotas();
    } catch (err) {
      container.innerHTML = `<div class="pagina-cabecalho"><h1 class="pagina-titulo">Notas</h1></div>` + estadoVazio({
        iconeNome: 'notas', titulo: 'Não foi possível carregar as notas',
        descricao: err instanceof ErroAPI && err.status === 404 ? 'O endpoint GET /api/notas ainda não existe no backend.' : err.message,
        acaoHtml: `<button class="btn btn-primario" id="btn-demo-nt" style="margin-top:14px">Carregar dados de demonstração</button>`,
      });
      container.querySelector('#btn-demo-nt')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
      return;
    }
    render(lista);
  }

  function render(lista) {
    // Notas GERAIS: só as sem vínculo com cliente. Anotações de cliente
    // vivem exclusivamente na aba Anotações da ficha de cada cliente.
    const gerais = lista.filter((n) => n.clienteId == null);
    const filtrada = busca ? gerais.filter((n) => n.titulo.toLowerCase().includes(busca.toLowerCase()) || n.conteudo?.toLowerCase().includes(busca.toLowerCase())) : gerais;
    container.innerHTML = `
    <div class="pagina-cabecalho">
      <div><h1 class="pagina-titulo">Notas</h1><p class="pagina-subtitulo">${filtrada.length} nota${filtrada.length === 1 ? '' : 's'}.</p></div>
      <button class="btn btn-primario" id="btn-nova-nota">${icone('mais2', 17)} Nova nota</button>
    </div>
    <div class="card" style="padding:14px 18px;margin-bottom:18px">
      <div class="campo-input-wrap">${icone('busca', 17)}<input class="input" style="padding-left:38px" id="busca-notas" placeholder="Buscar notas..." value="${escapeHtml(busca)}"></div>
    </div>
    <div class="grid grid-3" id="grade-notas"></div>`;

    const alvo = container.querySelector('#grade-notas');
    alvo.innerHTML = !filtrada.length ? estadoVazio({ iconeNome: 'notas', titulo: 'Nenhuma nota encontrada', descricao: 'Crie sua primeira nota.' }) :
      filtrada.map((n) => `
      <div class="card">
        <div class="flex justify-between items-start">
          <div class="flex items-center gap-8">${badgeStatus(CATEGORIAS[n.categoria] || n.categoria, CORES_CAT[n.categoria] || 'cinza')}${n.fixado ? icone('fixar', 15, '#e0a613') : ''}</div>
          <div class="flex gap-8">
            <button class="btn-icone" style="width:30px;height:30px" data-fixar="${n.id}">${icone('fixar', 14)}</button>
            <button class="btn-icone" style="width:30px;height:30px" data-excluir="${n.id}">${icone('lixo', 14)}</button>
          </div>
        </div>
        <div style="font-weight:700;margin-top:10px">${escapeHtml(n.titulo)}</div>
        <p class="texto-sm texto-mudo" style="margin-top:6px;line-height:1.5">${escapeHtml(n.conteudo)}</p>
        <div class="texto-xs texto-mudo" style="margin-top:12px">${formatarData(n.criadoEm)}${n.cliente ? ` · ${escapeHtml(n.cliente.nome)}` : ''}</div>
      </div>`).join('');

    alvo.querySelectorAll('[data-fixar]').forEach((b) => b.addEventListener('click', async () => {
      const n = filtrada.find((x) => x.id === b.dataset.fixar);
      await loja.atualizarNota(n.id, { fixado: !n.fixado });
      carregar();
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmarAcao({ titulo: 'Excluir nota', mensagem: 'Deseja realmente excluir esta nota?', textoConfirmar: 'Excluir' });
      if (ok) { await loja.excluirNota(b.dataset.excluir); toast('Nota excluída.', 'sucesso'); carregar(); }
    }));

    container.querySelector('#btn-nova-nota').addEventListener('click', () => abrirModalNovaNota({ aoSalvar: carregar }));
    container.querySelector('#busca-notas').addEventListener('input', debounce((e) => { busca = e.target.value; render(lista); }, 250));
  }

  await carregar();
}

  Object.assign(window.CP, { abrirModalNovaNota, renderNotas });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { loja, ErroAPI, formatarMoeda, dataParaISO, somarMeses, hoje, escapeHtml, icone, estadoCarregando, estadoVazio, toast } = window.CP;

async function renderRelatorios(container) {
  let inicio = dataParaISO(somarMeses(hoje(), -1));
  let fim = dataParaISO(hoje());
  let clienteFiltro = '';
  container.innerHTML = estadoCarregando();

  async function carregar() {
    let emprestimos, pagamentos, movimentacoes, clientes;
    try {
      [emprestimos, pagamentos, movimentacoes, clientes] = await Promise.all([
        loja.listarEmprestimos({}), loja.listarPagamentos({}), loja.listarMovimentacoes({}), loja.listarClientes({}),
      ]);
    } catch (err) {
      container.innerHTML = `<div class="pagina-cabecalho"><h1 class="pagina-titulo">Relatórios</h1></div>` + estadoVazio({
        iconeNome: 'relatorios', titulo: 'Não foi possível carregar os relatórios',
        descricao: err instanceof ErroAPI ? err.message : 'Tente novamente em instantes.',
        acaoHtml: `<button class="btn btn-primario" id="btn-demo-rel" style="margin-top:14px">Carregar dados de demonstração</button>`,
      });
      container.querySelector('#btn-demo-rel')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); carregar(); });
      return;
    }
    render(emprestimos, pagamentos, movimentacoes, clientes);
  }

  function render(emprestimos, pagamentos, movimentacoes, clientes) {
    const dentro = (d) => d >= inicio && d <= fim;
    const empFiltrados = emprestimos.filter((e) => dentro(e.dataOperacao) && (!clienteFiltro || e.clienteId === clienteFiltro));
    const pgFiltrados = pagamentos.filter((p) => dentro(p.data) && (!clienteFiltro || p.clienteId === clienteFiltro));
    const movFiltradas = movimentacoes.filter((m) => dentro(m.data) && (!clienteFiltro || m.clienteId === clienteFiltro));

    const capitalEmprestado = empFiltrados.reduce((a, e) => a + e.capital, 0);
    const valoresRecebidos = pgFiltrados.reduce((a, p) => a + p.valorRecebido, 0);
    const valoresPendentes = empFiltrados.reduce((a, e) => a + e.saldoRestante, 0);
    const ganhoPrevisto = empFiltrados.reduce((a, e) => a + e.ganhoPrevisto, 0);
    const ganhoRealizado = pgFiltrados.reduce((acc, p) => {
      const emp = emprestimos.find((e) => e.id === p.emprestimoId);
      return emp ? acc + Math.round(p.valorRecebido * (emp.ganhoPrevisto / emp.total)) : acc;
    }, 0);
    const entradas = movFiltradas.filter((m) => m.tipo === 'entrada').reduce((a, m) => a + m.valor, 0);
    const saidas = movFiltradas.filter((m) => m.tipo === 'saida').reduce((a, m) => a + m.valor, 0);
    const clientesComAtraso = new Set(empFiltrados.filter((e) => e.statusCalculado === 'atraso').map((e) => e.clienteId)).size;
    const valoresAtrasados = empFiltrados.flatMap((e) => e.parcelas || []).filter((p) => p.statusCalc?.startsWith('atrasado')).reduce((a, p) => a + (p.valor - p.valorPago), 0);

    container.innerHTML = `
    <div class="pagina-cabecalho">
      <div><h1 class="pagina-titulo">Relatórios</h1><p class="pagina-subtitulo">Filtre por período e cliente.</p></div>
      <button class="btn btn-secundario" id="btn-imprimir">${icone('arquivo', 16)} Imprimir / exportar</button>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="form-grid">
        <div class="campo"><label>Data inicial</label><input class="input" type="date" id="rel-inicio" value="${inicio}"></div>
        <div class="campo"><label>Data final</label><input class="input" type="date" id="rel-fim" value="${fim}"></div>
        <div class="campo form-full"><label>Cliente</label>
          <select class="select" id="rel-cliente"><option value="">Todos os clientes</option>${clientes.map((c) => `<option value="${c.id}" ${clienteFiltro === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}</select>
        </div>
      </div>
    </div>
    <div class="grid grid-3" style="margin-bottom:20px">
      ${kpi('Capital emprestado', formatarMoeda(capitalEmprestado))}
      ${kpi('Valores recebidos', formatarMoeda(valoresRecebidos))}
      ${kpi('Valores pendentes', formatarMoeda(valoresPendentes))}
      ${kpi('Valores atrasados', formatarMoeda(valoresAtrasados))}
      ${kpi('Ganho previsto', formatarMoeda(ganhoPrevisto))}
      ${kpi('Ganho realizado', formatarMoeda(ganhoRealizado))}
    </div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-titulo" style="margin-bottom:12px">Fluxo de caixa do período</div>
        <div class="flex gap-24" style="margin-bottom:10px">
          <div><div class="texto-xs texto-mudo">ENTRADAS</div><div style="font-weight:800" class="texto-positivo">${formatarMoeda(entradas)}</div></div>
          <div><div class="texto-xs texto-mudo">SAÍDAS</div><div style="font-weight:800" class="texto-negativo">${formatarMoeda(saidas)}</div></div>
          <div><div class="texto-xs texto-mudo">SALDO</div><div style="font-weight:800">${formatarMoeda(entradas - saidas)}</div></div>
        </div>
        <div class="barra-progresso" style="height:12px"><div class="barra-progresso-preenchida" style="width:${entradas + saidas > 0 ? (entradas / (entradas + saidas)) * 100 : 0}%"></div></div>
      </div>
      <div class="card">
        <div class="card-titulo" style="margin-bottom:12px">Inadimplência</div>
        <div class="flex justify-between texto-sm" style="margin-bottom:8px"><span>Clientes com atraso</span><strong>${clientesComAtraso}</strong></div>
        <div class="flex justify-between texto-sm"><span>Valor total atrasado</span><strong class="texto-negativo">${formatarMoeda(valoresAtrasados)}</strong></div>
      </div>
    </div>
    <div class="card" style="margin-top:20px">
      <div class="card-titulo" style="margin-bottom:12px">Operações por cliente</div>
      ${!empFiltrados.length ? estadoVazio({ iconeNome: 'relatorios', titulo: 'Nenhuma operação no período', descricao: 'Ajuste o filtro para visualizar dados.' }) :
        `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Cliente</th><th>Capital</th><th>Contratado</th><th>Saldo restante</th><th>Status</th></tr></thead><tbody>
        ${empFiltrados.map((e) => `<tr><td>${escapeHtml(e.cliente?.nome || '—')}</td><td>${formatarMoeda(e.capital)}</td><td>${formatarMoeda(e.total)}</td><td>${formatarMoeda(e.saldoRestante)}</td><td>${e.statusCalculado}</td></tr>`).join('')}
        </tbody></table></div>`}
    </div>`;

    container.querySelector('#rel-inicio').addEventListener('change', (e) => { inicio = e.target.value; carregar(); });
    container.querySelector('#rel-fim').addEventListener('change', (e) => { fim = e.target.value; carregar(); });
    container.querySelector('#rel-cliente').addEventListener('change', (e) => { clienteFiltro = e.target.value; carregar(); });
    container.querySelector('#btn-imprimir').addEventListener('click', () => window.print());
  }

  function kpi(titulo, valor) {
    return `<div class="card"><div class="card-titulo">${titulo}</div><div style="font-size:19px;font-weight:800;margin-top:8px">${valor}</div></div>`;
  }

  await carregar();
}

  Object.assign(window.CP, { renderRelatorios });
})();
window.CP = window.CP || {};
(function () {
  'use strict';
  const { api, ErroAPI, limparToken, loja, iniciais, escapeHtml, toast, confirmarAcao, estadoVazio, normalizarTelefone, formatarTelefoneExibicao } = window.CP;

async function renderConfiguracoes(container, { usuario, aoSair, aoAtualizarUsuario }) {
  let abaAtual = 'perfil';
  render();

  function render() {
    container.innerHTML = `
    <div class="pagina-cabecalho"><div><h1 class="pagina-titulo">Configurações</h1><p class="pagina-subtitulo">Gerencie sua conta e preferências.</p></div></div>
    <div class="tabs">
      ${['perfil', 'preferencias', 'notificacoes', 'seguranca', 'dados'].map((a) => `<div class="tab-item ${abaAtual === a ? 'ativo' : ''}" data-aba="${a}">${rotulo(a)}</div>`).join('')}
    </div>
    <div id="conteudo-config" style="max-width:640px"></div>`;

    container.querySelectorAll('[data-aba]').forEach((t) => t.addEventListener('click', () => { abaAtual = t.dataset.aba; render(); }));
    renderAba();
  }

  // Reduz a foto para no máximo 256px e devolve um JPEG leve (data-URL).
  // Evita Base64 pesado no banco: ~15-30KB em vez de megabytes do original.
  function processarFotoPerfil(arquivo) {
    return new Promise((resolve, reject) => {
      if (!arquivo || !arquivo.type.startsWith('image/')) return reject(new Error('Selecione um arquivo de imagem.'));
      if (arquivo.size > 8 * 1024 * 1024) return reject(new Error('Imagem muito grande (máximo 8MB).'));
      const url = URL.createObjectURL(arquivo);
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 256;
          const escala = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * escala));
          const h = Math.max(1, Math.round(img.height * escala));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
          if (dataUrl.length > 200 * 1024) return reject(new Error('Não foi possível reduzir a imagem o suficiente.'));
          resolve(dataUrl);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(new Error('Não foi possível processar a imagem.'));
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Arquivo de imagem inválido.')); };
      img.src = url;
    });
  }

  function rotulo(a) { return { perfil: 'Perfil', preferencias: 'Preferências', notificacoes: 'Notificações', seguranca: 'Segurança', dados: 'Dados' }[a]; }

  function renderAba() {
    const alvo = container.querySelector('#conteudo-config');
    if (abaAtual === 'perfil') {
      alvo.innerHTML = `
      <div class="card">
        <div class="pessoa-linha" style="margin-bottom:20px">
          <span id="cfg-foto-prev">
          ${usuario?.foto ? `<img class="avatar" style="width:64px;height:64px" src="${usuario.foto}">` : `<div class="avatar" style="width:64px;height:64px;font-size:22px">${iniciais(usuario?.nome)}</div>`}
          </span>
          <div><div style="font-weight:700;font-size:16px">${escapeHtml(usuario?.nome || '')}</div><div class="texto-sm texto-mudo">${escapeHtml(usuario?.email || '')}</div></div>
        </div>
        <div class="campo"><label>Foto de perfil</label><input class="input" type="file" id="cfg-foto" accept="image/jpeg,image/png,image/webp"><p class="texto-xs texto-mudo" style="margin-top:6px">A imagem é reduzida automaticamente (máx. 256px) antes de salvar.</p></div>
        <div class="campo"><label>Nome</label><input class="input" id="cfg-nome" value="${escapeHtml(usuario?.nome || '')}"></div>
        <div class="campo"><label>E-mail</label><input class="input" id="cfg-email" value="${escapeHtml(usuario?.email || '')}" disabled readonly></div>
        <div class="campo"><label>WhatsApp / Telefone</label><input class="input" id="cfg-telefone" inputmode="tel" placeholder="(11) 99999-9999" value="${escapeHtml(formatarTelefoneExibicao(usuario?.telefone || ''))}"><p class="texto-xs texto-mudo" style="margin-top:6px">Informe o número que você utiliza para atender e falar com seus clientes.</p></div>
        <button class="btn btn-primario" id="btn-salvar-perfil">Salvar alterações</button>
        <hr style="margin:22px 0;border:none;border-top:1px solid var(--cinza-100)">
        <button class="btn btn-secundario btn-bloco" id="btn-sair-conta">Sair da conta</button>
      </div>`;
      let fotoNova = null;
      alvo.querySelector('#cfg-foto').addEventListener('change', async (ev) => {
        const arq = ev.target.files && ev.target.files[0];
        if (!arq) return;
        try {
          fotoNova = await processarFotoPerfil(arq);
          alvo.querySelector('#cfg-foto-prev').innerHTML = `<img class="avatar" style="width:64px;height:64px" src="${fotoNova}">`;
        } catch (err) {
          toast(err.message || 'Não foi possível ler a imagem.', 'erro');
          ev.target.value = '';
        }
      });
      alvo.querySelector('#cfg-telefone').addEventListener('input', (ev) => {
        ev.target.value = formatarTelefoneExibicao(ev.target.value);
      });
      alvo.querySelector('#btn-salvar-perfil').addEventListener('click', async () => {
        try {
          const corpo = { nome: alvo.querySelector('#cfg-nome').value.trim(), telefone: normalizarTelefone(alvo.querySelector('#cfg-telefone').value) };
          if (fotoNova) corpo.foto = fotoNova;
          const atualizado = await api.put('/usuario/perfil', corpo);
          toast('Perfil atualizado.', 'sucesso');
          aoAtualizarUsuario?.(atualizado);
        } catch (err) {
          toast(err instanceof ErroAPI && err.status === 404 ? 'Endpoint PUT /api/usuario/perfil ainda não implementado no backend.' : (err.message || 'Erro ao salvar.'), 'erro');
        }
      });
      alvo.querySelector('#btn-sair-conta').addEventListener('click', async () => {
        const ok = await confirmarAcao({ titulo: 'Sair da conta', mensagem: 'Deseja realmente sair da sua conta?', textoConfirmar: 'Sair', perigo: false });
        if (ok) aoSair();
      });
    } else if (abaAtual === 'preferencias') {
      alvo.innerHTML = `
      <div class="card">
        <div class="campo"><label>Moeda</label><input class="input" value="Real brasileiro (R$)" disabled></div>
        <div class="campo"><label>Formato de data</label><input class="input" value="DD/MM/AAAA" disabled></div>
        <p class="texto-sm texto-mudo">O CredPlus utiliza o padrão brasileiro de moeda e datas em toda a aplicação.</p>
      </div>`;
    } else if (abaAtual === 'notificacoes') {
      alvo.innerHTML = `
      <div class="card">
        ${['Cobranças', 'Vencimentos', 'Atrasos', 'Metas'].map((n) => `
        <div class="flex justify-between items-center" style="padding:12px 0;border-top:1px solid var(--cinza-100)">
          <span class="texto-sm">${n}</span>
          <label class="checkbox-linha"><input type="checkbox" checked> Ativo</label>
        </div>`).join('')}
        <button class="btn btn-secundario btn-sm" id="btn-permitir-notif" style="margin-top:16px">Permitir notificações do navegador</button>
      </div>`;
      alvo.querySelector('#btn-permitir-notif').addEventListener('click', async () => {
        if (!('Notification' in window)) return toast('Seu navegador não suporta notificações.', 'erro');
        const permissao = await Notification.requestPermission();
        toast(permissao === 'granted' ? 'Notificações autorizadas.' : 'Permissão não concedida.', permissao === 'granted' ? 'sucesso' : 'info');
      });
    } else if (abaAtual === 'seguranca') {
      alvo.innerHTML = `
      <div class="card">
        <div class="card-titulo" style="margin-bottom:14px">Alterar senha</div>
        <div class="campo"><label>Senha atual</label><input class="input" type="password" id="cfg-senha-atual"></div>
        <div class="campo"><label>Nova senha</label><input class="input" type="password" id="cfg-senha-nova" minlength="6"></div>
        <div class="campo"><label>Confirmar nova senha</label><input class="input" type="password" id="cfg-senha-confirmar" minlength="6"></div>
        <button class="btn btn-primario" id="btn-alterar-senha">Alterar senha</button>
        <hr style="margin:22px 0;border:none;border-top:1px solid var(--cinza-100)">
        <div class="card-titulo" style="margin-bottom:10px">Pergunta de recuperação</div>
        <p class="texto-sm texto-mudo" style="margin-bottom:14px">Pergunta atual: <strong>${escapeHtml(usuario?.pergunta_recuperacao || 'Nenhuma pergunta de recuperação cadastrada')}</strong>${usuario?.pergunta_recuperacao ? '' : ' — cadastre uma abaixo para poder recuperar sua senha sem e-mail.'}</p>
        <div class="card-titulo" style="margin-bottom:10px;font-size:15px">Alterar pergunta de recuperação</div>
        <div class="campo"><label>Nova pergunta</label><select class="select" id="cfg-pergunta"></select></div>
        <div class="campo"><label>Nova resposta secreta</label><input class="input" id="cfg-resposta" autocomplete="off" minlength="3"></div>
        <div class="campo"><label>Senha atual</label><input class="input" type="password" id="cfg-rec-senha"></div>
        <button class="btn btn-secundario" id="btn-salvar-recuperacao">Salvar nova pergunta</button>
      </div>`;
      alvo.querySelector('#btn-alterar-senha').addEventListener('click', async () => {
        const atual = alvo.querySelector('#cfg-senha-atual').value;
        const nova = alvo.querySelector('#cfg-senha-nova').value;
        const confirmar = alvo.querySelector('#cfg-senha-confirmar').value;
        if (nova.length < 6) return toast('A nova senha deve ter ao menos 6 caracteres.', 'erro');
        if (nova !== confirmar) return toast('As senhas não coincidem.', 'erro');
        try {
          await api.put('/usuario/senha', { senha_atual: atual, senha_nova: nova });
          toast('Senha alterada com sucesso.', 'sucesso');
        } catch (err) {
          toast(err instanceof ErroAPI && err.status === 404 ? 'Endpoint PUT /api/usuario/senha ainda não implementado no backend.' : (err.message || 'Erro ao alterar senha.'), 'erro');
        }
      });
      alvo.querySelector('#cfg-pergunta').innerHTML = window.CP.opcoesPerguntasQuestionario(usuario?.pergunta_recuperacao || '');
      alvo.querySelector('#btn-salvar-recuperacao').addEventListener('click', async () => {
        const pergunta = alvo.querySelector('#cfg-pergunta').value;
        const resposta = alvo.querySelector('#cfg-resposta').value;
        const senhaAtual = alvo.querySelector('#cfg-rec-senha').value;
        if (!window.CP.PERGUNTAS_RECUPERACAO.includes(pergunta)) return toast('Escolha uma pergunta de recuperação.', 'erro');
        if (resposta.trim().length < 3) return toast('A resposta secreta deve ter ao menos 3 caracteres.', 'erro');
        if (!senhaAtual) return toast('Informe sua senha atual para confirmar.', 'erro');
        try {
          const atualizado = await api.put('/usuario/recuperacao', { pergunta, resposta, senha_atual: senhaAtual });
          toast('Pergunta de recuperação atualizada.', 'sucesso');
          aoAtualizarUsuario?.(atualizado);
        } catch (err) {
          toast(err.message || 'Erro ao salvar.', 'erro');
        }
      });
    } else if (abaAtual === 'dados') {
      alvo.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-titulo" style="margin-bottom:10px">Modo demonstração</div>
        <p class="texto-sm texto-mudo" style="margin-bottom:14px">Carregue dados fictícios para visualizar o CredPlus preenchido, ou remova-os para voltar aos seus dados reais.</p>
        ${loja.demoAtivo
          ? `<button class="btn btn-perigo" id="btn-remover-demo">Remover dados de demonstração</button>`
          : `<button class="btn btn-secundario" id="btn-carregar-demo">Carregar dados de demonstração</button>`}
      </div>
      <div class="card">
        <div class="card-titulo" style="margin-bottom:10px">Backup e exportação</div>
        <p class="texto-sm texto-mudo" style="margin-bottom:14px">Exporte seus dados (sem senhas, hashes ou segredos do servidor).</p>
        <button class="btn btn-secundario" id="btn-exportar">Exportar dados (JSON)</button>
      </div>`;
      alvo.querySelector('#btn-carregar-demo')?.addEventListener('click', () => { loja.ativarDemo(); toast('Modo demonstração ativado.', 'sucesso'); location.reload(); });
      alvo.querySelector('#btn-remover-demo')?.addEventListener('click', async () => {
        const ok = await confirmarAcao({ titulo: 'Remover demonstração', mensagem: 'Os dados fictícios serão removidos. Seus dados reais não são afetados.', textoConfirmar: 'Remover' });
        if (ok) { loja.desativarDemo(); toast('Demonstração removida.', 'sucesso'); location.reload(); }
      });
      alvo.querySelector('#btn-exportar').addEventListener('click', async () => {
        try {
          const dados = await api.get('/usuario/backup');
          baixarJson(dados);
        } catch (err) {
          if (err instanceof ErroAPI && err.status === 404) {
            toast('Endpoint GET /api/usuario/backup ainda não implementado no backend.', 'erro');
          } else toast(err.message || 'Erro ao exportar.', 'erro');
        }
      });
    }
  }

  function baixarJson(dados) {
    const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'credplus-backup.json'; a.click();
    URL.revokeObjectURL(url);
  }
}

  Object.assign(window.CP, { renderConfiguracoes });
})();
(function () {
  'use strict';
  const {
    auth, obterToken, limparToken, ErroAPI, loja,
    renderLogin, renderRegistro, renderEsqueciSenha, renderDashboard,
    renderClientes, renderClienteDetalhe, abrirModalNovoCliente, abrirModalEditarCliente,
    renderEmprestimos, abrirModalNovoEmprestimo, abrirModalRegistrarPagamento,
    renderFinanceiro, abrirModalNovaMovimentacao, renderCobrancas, renderAtrasos,
    renderLembretes, renderMetas, renderSimulador, renderNotas, abrirModalNovaNota,
    renderRelatorios, renderConfiguracoes,
    renderSidebar, renderTopbar, renderBottomNav, renderFolhaMais, renderFabMenu, toast, faixaDemo,
    escapeHtml, formatarMoeda, formatarData, confirmarAcao,
  } = window.CP;

const app = document.getElementById('app');
let usuarioAtual = null;
let notificacoes = [];
let timerNotificacoes = null;

function irPara(rota) { window.location.hash = `#/${rota}`; }

function navegarClienteDetalhe(id) { irPara(`clientes/${id}`); }
function navegarClientes() { irPara('clientes'); }

function abrirRegistrarPagamento(opcoes) {
  abrirModalRegistrarPagamento({ ...opcoes, aoSalvar: () => { opcoes.aoSalvar?.(); toast('Atualizando...', 'info'); rotearAtual(); } });
}
function abrirNovoEmprestimo(opcoes = {}) {
  abrirModalNovoEmprestimo({ ...opcoes, aoSalvar: () => { opcoes.aoSalvar?.(); rotearAtual(); } });
}
function abrirNovoCliente(opcoes = {}) {
  abrirModalNovoCliente({ ...opcoes, aoSalvar: (c) => { opcoes.aoSalvar?.(c); rotearAtual(); } });
}

function contextoComum() {
  return {
    usuario: usuarioAtual, navegar: irPara, navegarClienteDetalhe, navegarClientes,
    abrirNovoCliente, abrirNovoEmprestimo, abrirRegistrarPagamento,
  };
}

const ROTAS = {
  dashboard: (c) => renderDashboard(c, contextoComum()),
  clientes: (c) => renderClientes(c, contextoComum()),
  emprestimos: (c) => renderEmprestimos(c, contextoComum()),
  financeiro: (c) => renderFinanceiro(c),
  cobrancas: (c) => renderCobrancas(c, contextoComum()),
  atrasos: (c) => renderAtrasos(c, contextoComum()),
  lembretes: (c) => renderLembretes(c),
  metas: (c) => renderMetas(c),
  simulador: (c) => renderSimulador(c),
  notas: (c) => renderNotas(c),
  relatorios: (c) => renderRelatorios(c),
  configuracoes: (c) => renderConfiguracoes(c, {
    usuario: usuarioAtual,
    aoSair: encerrarSessao,
    aoAtualizarUsuario: (u) => { usuarioAtual = { ...usuarioAtual, ...u }; renderShell(); },
  }),
};

function analisarRota() {
  const hash = window.location.hash.replace(/^#\//, '') || 'dashboard';
  const partes = hash.split('/');
  return { base: partes[0] || 'dashboard', params: partes.slice(1) };
}

function ativarRotaAtiva(rotaBase) {
  return ['clientes'].includes(rotaBase) && window.location.hash.includes('/') && window.location.hash.split('/').length > 2 ? 'clientes' : rotaBase;
}

let cleanupBusca = null;
let cleanupSino = null;

function renderShell() {
  const { base } = analisarRota();
  const rotaAtiva = ativarRotaAtiva(base);
  document.getElementById('sidebar-slot').innerHTML = renderSidebar(rotaAtiva, usuarioAtual);
  document.getElementById('topbar-slot').innerHTML = renderTopbar(usuarioAtual, contarNaoLidas());
  document.getElementById('bottomnav-slot').innerHTML = renderBottomNav(rotaAtiva);
  document.getElementById('folhamais-slot').innerHTML = renderFolhaMais();
  document.getElementById('fabmenu-slot').innerHTML = renderFabMenu();
  document.getElementById('faixademo-slot').innerHTML = loja.demoAtivo ? faixaDemo() : '';

  document.getElementById('faixademo-slot').querySelector('#btn-sair-demo')?.addEventListener('click', () => { loja.desativarDemo(); toast('Demonstração removida.', 'sucesso'); location.reload(); });

  wireBusca();
  wireSino();
  wireSair();
  wireFab();
  wireFolhaMais();
}

function contarNaoLidas() {
  return notificacoes.filter((n) => !n.lida).length;
}

function atualizarBadgeNotificacoes() {
  const badge = document.getElementById('sino-contador');
  if (!badge) return;
  const qtd = contarNaoLidas();
  badge.textContent = qtd > 99 ? '99+' : String(qtd);
  badge.classList.toggle('oculto', qtd === 0);
}

async function atualizarNotificacoes() {
  try {
    notificacoes = await loja.listarNotificacoes();
  } catch (err) {
    // Endpoint pode ainda não existir no backend real, ou falha de rede: mantém o que já estava em memória.
  }
  atualizarBadgeNotificacoes();
  const dropdown = document.getElementById('notificacoes-dropdown');
  if (dropdown && !dropdown.classList.contains('oculto')) renderListaNotificacoes();
}

function renderListaNotificacoes() {
  const lista = document.getElementById('notificacoes-lista');
  if (!lista) return;
  if (!notificacoes.length) {
    lista.innerHTML = '<div class="notificacoes-vazio">Nenhuma notificação por enquanto.</div>';
    return;
  }
  lista.innerHTML = notificacoes.map((n) => `
    <button class="notificacao-item ${n.lida ? '' : 'nao-lida'}" data-notificacao-id="${n.id}">
      <div class="notificacao-titulo">${!n.lida ? '<span class="notificacao-ponto"></span>' : ''}<span>${escapeHtml(n.titulo)}</span></div>
      ${n.descricao ? `<div class="notificacao-descricao">${escapeHtml(n.descricao)}</div>` : ''}
      <div class="notificacao-data">${formatarData(n.criadoEm, true)}</div>
    </button>`).join('');
  lista.querySelectorAll('[data-notificacao-id]').forEach((el) => el.addEventListener('click', () => aoClicarNotificacao(el.dataset.notificacaoId)));
}

async function aoClicarNotificacao(id) {
  const n = notificacoes.find((x) => x.id === id);
  if (!n) return;
  document.getElementById('notificacoes-dropdown')?.classList.add('oculto');
  if (!n.lida) {
    n.lida = true;
    atualizarBadgeNotificacoes();
    try { await loja.marcarNotificacaoLida(id); } catch (err) { /* mantém marcado localmente mesmo se a sincronização falhar */ }
  }
  if (n.tipo === 'lembrete') irPara('lembretes');
}

// Normaliza data/hora do lembrete antes de comparar com "agora": o backend pode
// devolver a hora com segundos (coluna TIME do Postgres costuma serializar como
// "09:00:00") ou a data como timestamp completo — concatenar isso direto na string
// gerava um Date inválido (NaN) e o lembrete nunca era considerado vencido.
function dataHoraLembrete(l) {
  const dataParte = String(l.data || '').slice(0, 10);
  const horaParte = String(l.hora || '00:00').slice(0, 5);
  if (!dataParte) return null;
  const d = new Date(`${dataParte}T${horaParte}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

let audioCtxNotificacao = null;
function tocarSomNotificacao() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtxNotificacao) audioCtxNotificacao = new Ctx();
    if (audioCtxNotificacao.state === 'suspended') audioCtxNotificacao.resume().catch(() => {});
    const t0 = audioCtxNotificacao.currentTime;
    const osc = audioCtxNotificacao.createOscillator();
    const ganho = audioCtxNotificacao.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.09);
    ganho.gain.setValueAtTime(0.0001, t0);
    ganho.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    osc.connect(ganho);
    ganho.connect(audioCtxNotificacao.destination);
    osc.start(t0);
    osc.stop(t0 + 0.36);
  } catch (err) {
    // Áudio bloqueado pelo navegador (sem interação do usuário ainda) ou indisponível: ignora sem erro.
  }
}

async function verificarLembretesEGerarNotificacoes() {
  try {
    const lembretesLista = await loja.listarLembretes();
    await atualizarNotificacoes();
    const agora = new Date();
    const pendentesSemNotificacao = lembretesLista.filter((l) => {
      if (l.concluido) return false;
      const dataHora = dataHoraLembrete(l);
      if (!dataHora || dataHora > agora) return false;
      return !notificacoes.some((n) => n.origemTipo === 'lembrete' && n.origemId === l.id);
    });
    for (const l of pendentesSemNotificacao) {
      await loja.criarNotificacao({
        titulo: 'Lembrete', descricao: l.descricao, tipo: 'lembrete',
        origemTipo: 'lembrete', origemId: l.id, clienteId: l.clienteId || null,
      });
    }
    if (pendentesSemNotificacao.length) {
      await atualizarNotificacoes();
      tocarSomNotificacao();
    }
  } catch (err) {
    // Lembretes/Notificações podem ainda não existir no backend real: ignora silenciosamente.
  }
}

function iniciarCicloNotificacoes() {
  if (timerNotificacoes) clearInterval(timerNotificacoes);
  verificarLembretesEGerarNotificacoes();
  timerNotificacoes = setInterval(verificarLembretesEGerarNotificacoes, 20000);
}

function pararCicloNotificacoes() {
  if (timerNotificacoes) { clearInterval(timerNotificacoes); timerNotificacoes = null; }
  notificacoes = [];
}

function wireBusca() {
  const input = document.getElementById('input-busca-global');
  const resultados = document.getElementById('busca-resultados');
  if (!input) return;
  let timer;
  const onInput = () => {
    clearTimeout(timer);
    const termo = input.value.trim();
    if (!termo) { resultados.classList.add('oculto'); return; }
    timer = setTimeout(async () => {
      const lista = await loja.buscarGlobal(termo).catch(() => []);
      resultados.innerHTML = lista.length ? lista.map((c) => `
        <div class="busca-resultado-item" data-ir="${c.id}">
          <div style="font-weight:700">${escapeHtml(c.nome)}</div>
          <div class="texto-xs texto-mudo">${c.operacoes || 0} operação(ões) · ${formatarMoeda(c.saldoPendente || 0)} pendentes ${c.proximaCobranca ? `· Próxima cobrança: ${formatarData(c.proximaCobranca)}` : ''}</div>
        </div>`).join('') : `<div class="busca-resultado-item texto-mudo">Nenhum resultado encontrado</div>`;
      resultados.classList.remove('oculto');
      resultados.querySelectorAll('[data-ir]').forEach((el) => el.addEventListener('click', () => { resultados.classList.add('oculto'); input.value = ''; navegarClienteDetalhe(el.dataset.ir); }));
    }, 250);
  };
  input.addEventListener('input', onInput);
  document.addEventListener('click', (e) => { if (!e.target.closest('.busca-global')) resultados?.classList.add('oculto'); });
}

function wireSair() {
  document.getElementById('btn-sair-topo')?.addEventListener('click', async () => {
    const ok = await confirmarAcao({ titulo: 'Sair da conta', mensagem: 'Deseja realmente sair da sua conta?', textoConfirmar: 'Sair', perigo: false });
    if (ok) encerrarSessao();
  });
}

function wireSino() {
  const btn = document.getElementById('btn-notificacoes');
  const dropdown = document.getElementById('notificacoes-dropdown');
  if (!btn || !dropdown) return;
  renderListaNotificacoes();
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const abrindo = dropdown.classList.contains('oculto');
    dropdown.classList.toggle('oculto');
    if (abrindo) renderListaNotificacoes();
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.classList.contains('oculto') && !e.target.closest('#notificacoes-wrap') && !e.target.closest('#notificacoes-dropdown')) dropdown.classList.add('oculto');
  });
}

function wireFab() {
  const btnFab = document.getElementById('btn-fab');
  const menu = document.getElementById('fab-menu');
  if (!btnFab) return;
  btnFab.addEventListener('click', () => menu.classList.toggle('oculto'));
  document.addEventListener('click', (e) => { if (menu && !menu.classList.contains('oculto') && !e.target.closest('#fab-menu') && !e.target.closest('#btn-fab')) menu.classList.add('oculto'); });
  menu?.querySelectorAll('[data-acao-fab]').forEach((item) => item.addEventListener('click', () => {
    menu.classList.add('oculto');
    const acao = item.dataset.acaoFab;
    if (acao === 'novo-cliente') abrirNovoCliente();
    if (acao === 'novo-emprestimo') abrirNovoEmprestimo();
    if (acao === 'registrar-pagamento') irPara('cobrancas');
    if (acao === 'nova-movimentacao') abrirModalNovaMovimentacao({ aoSalvar: rotearAtual });
    if (acao === 'nova-nota') abrirModalNovaNota({ aoSalvar: rotearAtual });
  }));
}

function wireFolhaMais() {
  const btnAbrir = document.getElementById('btn-abrir-mais');
  const folha = document.getElementById('folha-mais');
  const fundo = document.getElementById('folha-mais-fundo');
  btnAbrir?.addEventListener('click', () => { folha.style.display = 'block'; });
  fundo?.addEventListener('click', () => { folha.style.display = 'none'; });
  folha?.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => { folha.style.display = 'none'; }));
}

async function rotearAtual() {
  const { base, params } = analisarRota();
  const conteudo = document.getElementById('conteudo-pagina');
  renderShell();

  if (base === 'clientes' && params[0]) {
    await renderClienteDetalhe(conteudo, { clienteId: params[0], navegarClientes, abrirNovoEmprestimo, abrirRegistrarPagamento });
    return;
  }
  const handler = ROTAS[base] || ROTAS.dashboard;
  try {
    await handler(conteudo);
  } catch (err) {
    conteudo.innerHTML = `<div class="pagina"><div class="alerta alerta-erro">Ocorreu um erro ao carregar esta página. ${err instanceof ErroAPI ? err.message : 'Tente novamente.'}</div></div>`;
  }
}

function montarShellApp() {
  app.innerHTML = `
  <div id="faixademo-slot"></div>
  <div class="app-shell">
    <div id="sidebar-slot"></div>
    <div class="conteudo-principal">
      <div id="topbar-slot"></div>
      <main class="pagina" id="conteudo-pagina"></main>
    </div>
  </div>
  <div id="bottomnav-slot"></div>
  <div id="folhamais-slot"></div>
  <div id="fabmenu-slot"></div>`;
}

function mostrarTelaAuth(render) {
  app.innerHTML = '';
  render(app);
}

async function iniciarAppAutenticado(usuario) {
  usuarioAtual = usuario;
  montarShellApp();
  await rotearAtual();
  iniciarCicloNotificacoes();
}

function encerrarSessao() {
  pararCicloNotificacoes();
  limparToken();
  loja.desativarDemo();
  usuarioAtual = null;
  window.location.hash = '';
  mostrarTelaLogin();
}

function mostrarTelaLogin() {
  mostrarTelaAuth((c) => renderLogin(c, {
    aoAutenticar: (usuario) => iniciarAppAutenticado(usuario),
    irParaRegistro: () => mostrarTelaAuth((c2) => renderRegistro(c2, { aoRegistrar: iniciarAppAutenticado, irParaLogin: mostrarTelaLogin })),
    aoEntrarDemo: () => {
      loja.ativarDemo();
      toast('Modo demonstração ativado — estes dados são fictícios.', 'sucesso');
      iniciarAppAutenticado({ nome: 'Usuário Demonstração', email: 'demo@credplus.app', demo: true });
    },
  }));
}

window.addEventListener('hashchange', () => { if (usuarioAtual) rotearAtual(); });
window.addEventListener('credplus:sessao-expirada', () => {
  usuarioAtual = null;
  toast('Sua sessão expirou. Faça login novamente.', 'erro');
  mostrarTelaLogin();
});

async function bootstrap() {
  if (window.location.hash === '#/esqueci-senha') {
    mostrarTelaAuth((c) => renderEsqueciSenha(c, { irParaLogin: mostrarTelaLogin }));
    return;
  }
  const token = obterToken();
  if (!token) { mostrarTelaLogin(); return; }
  try {
    const resposta = await auth.me();
    await iniciarAppAutenticado(resposta.usuario || resposta);
  } catch (err) {
    limparToken();
    mostrarTelaLogin();
  }
}

bootstrap();
})();
} catch (erroFatalCredPlus) {
  if (window.__erroFatalCredPlus) {
    window.__erroFatalCredPlus((erroFatalCredPlus && erroFatalCredPlus.stack) || String(erroFatalCredPlus));
  } else if (window.console) {
    console.error(erroFatalCredPlus);
  }
}
