// Helpers HTTP da camada serverless (sem Express).
//
// O frontend lê `dados.mensagem || dados.erro` em respostas de erro —
// por isso `falhar()` sempre envia `{ mensagem }`.

function enviar(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(corpo));
  return res;
}

function ok(res, corpo, status = 200) {
  return enviar(res, status, corpo === undefined ? { ok: true } : corpo);
}

function falhar(res, status, mensagem, extras) {
  return enviar(res, status, { mensagem, ...(extras || {}) });
}

// Corpo JSON: na Vercel o runtime já entrega req.body parseado; em outros
// casos (string ou stream ainda não lida) fazemos o parse aqui.
async function lerCorpo(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      if (!req.body) return {};
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  const chunks = [];
  for await (const parte of req) chunks.push(parte);
  const bruto = Buffer.concat(chunks).toString('utf8');
  if (!bruto) return {};
  try { return JSON.parse(bruto); } catch { return {}; }
}

function dataValida(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function paraDataISO(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

// "Hoje" no fuso do negócio (America/Sao_Paulo), não no fuso do container.
function hojeSP() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}

// vencimento - hoje, em dias de calendário.
function diasEntreDatas(hojeISO, vencimentoISO) {
  const [ay, am, ad] = hojeISO.split('-').map(Number);
  const [by, bm, bd] = vencimentoISO.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function emailValido(v) {
  return typeof v === 'string' && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function idRota(valor) {
  const id = parseInt(valor, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

module.exports = { enviar, ok, falhar, lerCorpo, dataValida, paraDataISO, hojeSP, diasEntreDatas, emailValido, idRota };
