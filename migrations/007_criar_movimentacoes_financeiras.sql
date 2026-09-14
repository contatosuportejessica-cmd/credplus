-- CredPlus | Migration 007 — movimentacoes_financeiras (Etapa 4 do CredPlus real)
--
-- origem distingue claramente a natureza do lancamento:
--   manual     -> criado livremente pelo usuario via "Nova movimentacao"
--   pagamento  -> gerado automaticamente quando um pagamento e confirmado
--   emprestimo -> reservado para quando a saida automatica de capital for
--                 ligada (NAO implementado nesta migration/etapa ainda)
--
-- pagamento_id tem UNIQUE parcial: garante no nivel do banco que um mesmo
-- pagamento NUNCA pode gerar duas movimentacoes financeiras, mesmo que o
-- codigo da aplicacao tente (bug, corrida, reenvio).
--
-- Historico imutavel: mesma politica de pagamentos — credplus_app recebe
-- somente SELECT e INSERT (sem UPDATE, sem DELETE). O frontend tambem nao
-- possui nenhuma tela de edicao/exclusao de movimentacao. Uma correcao
-- futura tera que ser um novo lancamento compensatorio, nunca uma edicao
-- do original.

BEGIN;

CREATE TABLE IF NOT EXISTS movimentacoes_financeiras (
  id              SERIAL PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  origem          TEXT NOT NULL CHECK (origem IN ('manual','pagamento','emprestimo')),
  valor_centavos  BIGINT NOT NULL CHECK (valor_centavos > 0),
  descricao       TEXT NOT NULL,
  categoria       TEXT NOT NULL DEFAULT 'Geral',
  data            DATE NOT NULL,
  observacao      TEXT,
  cliente_id      INTEGER REFERENCES clientes(id) ON DELETE RESTRICT,
  emprestimo_id   INTEGER REFERENCES emprestimos(id) ON DELETE RESTRICT,
  pagamento_id    INTEGER REFERENCES pagamentos(id) ON DELETE RESTRICT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pagamento_id IS NULL OR origem = 'pagamento')
);

CREATE INDEX IF NOT EXISTS idx_movfin_usuario_id ON movimentacoes_financeiras(usuario_id);
CREATE INDEX IF NOT EXISTS idx_movfin_usuario_tipo ON movimentacoes_financeiras(usuario_id, tipo);
CREATE INDEX IF NOT EXISTS idx_movfin_cliente_id ON movimentacoes_financeiras(cliente_id);
CREATE INDEX IF NOT EXISTS idx_movfin_emprestimo_id ON movimentacoes_financeiras(emprestimo_id);

-- Exatamente uma movimentacao por pagamento (nunca duas, mesmo por bug).
CREATE UNIQUE INDEX IF NOT EXISTS idx_movfin_pagamento_unico
  ON movimentacoes_financeiras(pagamento_id) WHERE pagamento_id IS NOT NULL;

ALTER TABLE movimentacoes_financeiras ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes_financeiras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movfin_isolamento ON movimentacoes_financeiras;
CREATE POLICY movfin_isolamento ON movimentacoes_financeiras
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

-- Somente SELECT + INSERT: historico imutavel garantido no nivel de
-- privilegio do banco (igual pagamentos).
GRANT SELECT, INSERT ON movimentacoes_financeiras TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE movimentacoes_financeiras_id_seq TO credplus_app;

COMMIT;
