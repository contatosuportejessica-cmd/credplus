// ═══════════════════════════════════════════════════════════════════════
// CredPlus — upload/download privado de documentos e comprovantes.
//
// Os BYTES ficam em UPLOADS_DIR (fora da pasta do projeto e fora de
// _published — ver .env: UPLOADS_DIR), nomeados por uuid (nunca pelo nome
// que o cliente mandou — path traversal e sobrescrita de outro arquivo
// ficam impossíveis por construção). O METADADO (dono, nome original, mime)
// fica no Postgres, sob RLS — a mesma dupla trava do resto do app.
//
// Nenhuma rota estática expõe esta pasta. O único jeito de ler um arquivo é
// GET /:id, autenticado, e mesmo autenticado só devolve se a linha
// pertencer a quem pediu — RLS decide isso antes do código ver o arquivo.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

// Era `process.exit(1)` + `fs.mkdirSync` direto no carregamento do módulo —
// correto numa VPS (falha rápido no boot, disco persistente de verdade),
// mas fatal numa função serverless: este arquivo é exigido incondicionalmente
// por backend/src/app.js, então um `process.exit`/`EROFS` aqui derrubava
// TODAS as rotas (cadastro, login, tudo), não só upload. Sem UPLOADS_DIR
// definido, cai em os.tmpdir() (o único diretório gravável garantido na
// Vercel); a criação da pasta é adiada para o momento de um upload de
// verdade, nunca no `require()`.
//
// AVISO (não escondido, só registrado aqui): `/tmp` na Vercel é efêmero —
// não sobrevive entre invocações/deploys. Uploads continuam funcionando
// dentro de uma mesma invocação (enviar e logo em seguida baixar), mas não
// há garantia de persistência a longo prazo sem um storage externo (ex.:
// Vercel Blob/S3) — isso é uma limitação arquitetural herdada da VPS
// (disco local), não algo que este ajuste mínimo resolve sozinho.
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(os.tmpdir(), 'credplus-uploads');
let _uploadsDirPronto = false;
function garantirUploadsDir() {
  if (_uploadsDirPronto) return;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true, mode: 0o700 });
  _uploadsDirPronto = true;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try { garantirUploadsDir(); cb(null, UPLOADS_DIR); }
    catch (e) { cb(e); }
  },
  filename: (req, file, cb) => cb(null, crypto.randomUUID()),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — suficiente para comprovante/PDF/foto
});

router.post('/', upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado (campo "arquivo")' });
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query(
        `INSERT INTO uploads (usuario_id, nome_original, nome_armazenado, mime_type, tamanho_bytes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, nome_original, mime_type, tamanho_bytes, criado_em`,
        [req.usuarioId, req.file.originalname.slice(0, 255), req.file.filename, req.file.mimetype, req.file.size],
      ));
    res.status(201).json({ upload: r.rows[0] });
  } catch (err) {
    // Se o registro no banco falhar, o arquivo órfão no disco não vale nada
    // sem a linha — remove para não acumular lixo silencioso.
    fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {});
    res.status(500).json({ error: 'Falha ao registrar upload: ' + err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query('SELECT id, nome_original, mime_type, tamanho_bytes, criado_em FROM uploads ORDER BY id DESC'));
    res.json({ uploads: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao listar: ' + err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query('SELECT nome_original, nome_armazenado, mime_type FROM uploads WHERE id = $1', [req.params.id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Não encontrado' });
    const { nome_original, nome_armazenado, mime_type } = r.rows[0];
    const caminho = path.join(UPLOADS_DIR, nome_armazenado);
    if (!fs.existsSync(caminho)) return res.status(404).json({ error: 'Arquivo ausente no disco' });
    res.set('Content-Type', mime_type || 'application/octet-stream');
    res.set('Content-Disposition', 'inline; filename="' + encodeURIComponent(nome_original) + '"');
    res.sendFile(caminho);
  } catch (err) {
    res.status(500).json({ error: 'Falha ao buscar: ' + err.message });
  }
});

module.exports = router;
