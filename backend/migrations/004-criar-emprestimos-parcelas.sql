-- CredPlus | Migration 004 — emprestimos + parcelas (Etapa 2 do CredPlus real)
-- Valores monetarios sempre em centavos (BIGINT), nunca FLOAT/REAL.
-- cliente_id usa ON DELETE RESTRICT (nunca CASCADE): historico financeiro
-- nao pode ser destruido mesmo que um cliente seja fisicamente removido no
-- futuro (hoje clientes so sao arquivados, nunca apagados).
-- Sem GRANT DELETE para credplus_app em nenhuma das duas tabelas:
-- "cancelar" emprestimo e sempre UPDATE de status, nunca remocao fisica.

BEGIN;

CREATE TABLE IF NOT EXISTS emprestimos (
  id                 SERIAL PRIMARY KEY,
  usuario_id         INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id         INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  capital_centavos   BIGINT NOT NULL CHECK (capital_centavos > 0),
  total_centavos     BIGINT NOT NULL CHECK (total_centavos > capital_centavos),
  qtd_parcelas       INTEGER NOT NULL CHECK (qtd_parcelas > 0),
  frequencia         TEXT NOT NULL CHECK (frequencia IN ('diario','semanal','quinzenal','mensal','personalizado')),
  data_operacao      DATE NOT NULL,
  observacoes        TEXT,
  status             TEXT NOT NULL DEFAULT 'andamento' CHECK (status IN ('andamento','cancelado')),
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelado_em       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_emprestimos_usuario_id ON emprestimos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_emprestimos_cliente_id ON emprestimos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_emprestimos_usuario_status ON emprestimos(usuario_id, status);

ALTER TABLE emprestimos ENABLE ROW LEVEL SECURITY;
ALTER TABLE emprestimos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emprestimos_isolamento ON emprestimos;
CREATE POLICY emprestimos_isolamento ON emprestimos
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

GRANT SELECT, INSERT, UPDATE ON emprestimos TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE emprestimos_id_seq TO credplus_app;

CREATE TABLE IF NOT EXISTS parcelas (
  id                   SERIAL PRIMARY KEY,
  emprestimo_id        INTEGER NOT NULL REFERENCES emprestimos(id) ON DELETE CASCADE,
  usuario_id           INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  numero               INTEGER NOT NULL CHECK (numero > 0),
  valor_centavos       BIGINT NOT NULL CHECK (valor_centavos >= 0),
  valor_pago_centavos  BIGINT NOT NULL DEFAULT 0 CHECK (valor_pago_centavos >= 0),
  vencimento           DATE NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','cancelado')),
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcelas_emprestimo_id ON parcelas(emprestimo_id);
CREATE INDEX IF NOT EXISTS idx_parcelas_usuario_id ON parcelas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_parcelas_usuario_vencimento ON parcelas(usuario_id, vencimento);

ALTER TABLE parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcelas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parcelas_isolamento ON parcelas;
CREATE POLICY parcelas_isolamento ON parcelas
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

GRANT SELECT, INSERT, UPDATE ON parcelas TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE parcelas_id_seq TO credplus_app;

COMMIT;
