// ═══════════════════════════════════════════════════════════════════════
// CredPlus — rota de TESTE genérica só para provar isolamento por usuário.
// Não é uma entidade real do produto (empréstimo/cliente/parcela virão
// depois) — é o suficiente para o teste técnico pedido: criar como um
// usuário, tentar ler/apagar como outro, e RLS barrando na raiz (banco),
// não só no código da rota.
// ═══════════════════════════════════════════════════════════════════════
const express = require('express');
const db = require('../db');
const { exigirAuth } = require('../auth');

const router = express.Router();
router.use(exigirAuth);

router.post('/', async (req, res) => {
  const conteudo = String((req.body || {}).conteudo || '').slice(0, 2000);
  if (!conteudo) return res.status(400).json({ error: 'conteudo é obrigatório' });
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query('INSERT INTO registros_teste (usuario_id, conteudo) VALUES ($1, $2) RETURNING id, conteudo, criado_em', [req.usuarioId, conteudo]));
    res.status(201).json({ registro: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao criar: ' + err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    // Sem WHERE por usuario_id no SQL de propósito: quem impede ver o
    // registro de outro é a policy de RLS, não uma cláusula que o código
    // da rota poderia esquecer de escrever.
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query('SELECT id, usuario_id, conteudo, criado_em FROM registros_teste ORDER BY id DESC'));
    res.json({ registros: r.rows });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao listar: ' + err.message });
  }
});

// Buscar por id de OUTRO usuário deve devolver 404 — não porque a rota
// verificou o dono, mas porque a query nem enxerga a linha (RLS).
router.get('/:id', async (req, res) => {
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query('SELECT id, usuario_id, conteudo, criado_em FROM registros_teste WHERE id = $1', [req.params.id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ registro: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao buscar: ' + err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await db.comUsuario(req.usuarioId, (c) =>
      c.query('DELETE FROM registros_teste WHERE id = $1 RETURNING id', [req.params.id]));
    if (!r.rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao apagar: ' + err.message });
  }
});

module.exports = router;
