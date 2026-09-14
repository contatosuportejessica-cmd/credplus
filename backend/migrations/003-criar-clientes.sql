-- CredPlus | Migration 003 — tabela real "clientes" (Etapa 1 do CredPlus real)
-- Cada cliente pertence a exatamente um usuario_id (dono). RLS forcado
-- garante isolamento mesmo se a rota esquecer um WHERE. A role de aplicacao
-- (credplus_app) NAO recebe GRANT DELETE: exclusao e sempre logica
-- (status='arquivado'), preservando o historico financeiro que sera
-- vinculado a este cliente em etapas futuras (emprestimos/pagamentos).

BEGIN;

CREATE TABLE IF NOT EXISTS clientes (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  telefone       TEXT,
  whatsapp       TEXT,
  email          TEXT,
  documento      TEXT,
  endereco       TEXT,
  complemento    TEXT,
  cidade         TEXT,
  estado         TEXT,
  cep            TEXT,
  localizacao    TEXT,
  observacoes    TEXT,
  foto           TEXT,
  status         TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'arquivado')),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  arquivado_em   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_clientes_usuario_id ON clientes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_clientes_usuario_status ON clientes(usuario_id, status);

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clientes_isolamento ON clientes;
CREATE POLICY clientes_isolamento ON clientes
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

GRANT SELECT, INSERT, UPDATE ON clientes TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE clientes_id_seq TO credplus_app;
-- Sem GRANT DELETE de proposito (ver comentario acima).

COMMIT;
