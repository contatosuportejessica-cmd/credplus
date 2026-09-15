-- CredPlus | Migration 019 — vínculo de cobrança no lembrete + templates
--
-- Lembrete de cobrança referencia cliente/empréstimo/parcela por ID
-- (nunca cópia de textos): valores exibidos são sempre lidos ao vivo das
-- tabelas reais. Colunas NULL: lembretes antigos e tipos não-cobrança
-- continuam funcionando sem vínculo.
--
-- lembrete_templates: personalização por usuário dos 4 modelos de WhatsApp.
-- Os textos-padrão vivem no código (backend devolve padrão + override);
-- aqui só persistem as personalizações (upsert por (usuario_id, chave)).

BEGIN;

ALTER TABLE lembretes ADD COLUMN IF NOT EXISTS emprestimo_id INTEGER REFERENCES emprestimos(id) ON DELETE SET NULL;
ALTER TABLE lembretes ADD COLUMN IF NOT EXISTS parcela_id INTEGER REFERENCES parcelas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lembretes_emprestimo_id ON lembretes(emprestimo_id);
CREATE INDEX IF NOT EXISTS idx_lembretes_parcela_id ON lembretes(parcela_id);

CREATE TABLE IF NOT EXISTS lembrete_templates (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  chave          TEXT NOT NULL CHECK (chave IN ('antes-vencimento','vence-hoje','atrasada','amigavel')),
  texto          TEXT NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 1000),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, chave)
);

ALTER TABLE lembrete_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lembrete_templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lembrete_templates_isolamento ON lembrete_templates;
CREATE POLICY lembrete_templates_isolamento ON lembrete_templates
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

GRANT SELECT, INSERT, UPDATE, DELETE ON lembrete_templates TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE lembrete_templates_id_seq TO credplus_app;

COMMIT;
