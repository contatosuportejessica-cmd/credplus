-- CredPlus | Migration 011 — metas (Etapa 7 do produto real)
--
-- NAO existe coluna de progresso/realizado: o progresso e sempre DERIVADO
-- em tempo real de pagamentos/emprestimos reais (GET /metas/:id/progresso),
-- nunca armazenado aqui. Isso evita a duplicidade que o produto quer
-- evitar (Financeiro dizendo um valor, Meta dizendo outro).
--
-- Sem coluna atualizado_em: nao existe PUT /metas/:id no contrato real
-- (confirmado no frontend — so GET, POST, DELETE e o endpoint de
-- progresso). Uma meta nunca e editada depois de criada.
--
-- Sem GRANT UPDATE para credplus_app pelo mesmo motivo.

BEGIN;

CREATE TABLE IF NOT EXISTS metas (
  id               SERIAL PRIMARY KEY,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  titulo           TEXT NOT NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN ('capital_emprestado','recebimentos','ganho','quantidade_operacoes')),
  periodo          TEXT NOT NULL CHECK (periodo IN ('mensal','trimestral','anual','personalizado')),
  valor_alvo       BIGINT NOT NULL CHECK (valor_alvo > 0),
  data_inicio      DATE NOT NULL,
  data_fim         DATE NOT NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_metas_usuario_id ON metas(usuario_id);

ALTER TABLE metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metas_isolamento ON metas;
CREATE POLICY metas_isolamento ON metas
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

-- Sem UPDATE: nao ha edicao de meta no contrato real.
GRANT SELECT, INSERT, DELETE ON metas TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE metas_id_seq TO credplus_app;

COMMIT;
