-- CredPlus | Migration 008 — idempotencia de emprestimos (correcao pre-Financeiro)
--
-- Mesmo padrao ja validado em pagamentos (migration 006): chave gerada
-- pelo FRONTEND uma unica vez por clique em "Salvar emprestimo",
-- persistida junto ao emprestimo, com indice UNICO parcial por usuario.
-- Nula para emprestimos ja existentes antes desta migration.

BEGIN;

ALTER TABLE emprestimos ADD COLUMN IF NOT EXISTS chave_idempotencia TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_emprestimos_usuario_chave_idem
  ON emprestimos(usuario_id, chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

COMMIT;
