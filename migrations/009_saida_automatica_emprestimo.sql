-- CredPlus | Migration 009 — saida financeira automatica de emprestimo
--
-- UM emprestimo -> no maximo UMA movimentacao automatica de origem
-- 'emprestimo'. Indice unico parcial garante isso no banco, independente
-- do codigo da aplicacao (mesma logica ja usada para pagamento_id na
-- migration 007).

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_movfin_emprestimo_saida_unica
  ON movimentacoes_financeiras(emprestimo_id)
  WHERE emprestimo_id IS NOT NULL AND origem = 'emprestimo';

COMMIT;
