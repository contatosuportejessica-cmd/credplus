-- CredPlus | Migration 010 — lembretes (Etapa 6 do produto real)
--
-- Lembrete NAO e historico financeiro: diferente de pagamentos/
-- movimentacoes_financeiras, aqui a role da aplicacao recebe DELETE real
-- (exclusao fisica) e UPDATE real, pois o proprio frontend ja trata
-- lembrete como dado mutavel/descartavel pelo usuario (editar status,
-- excluir com confirmacao) — nao ha razao de produto para imutabilidade.
--
-- cliente_id e opcional (o formulario atual sempre envia null, mas o
-- campo existe no contrato) com ON DELETE SET NULL: perder o vinculo com
-- um cliente nao deve impedir nem apagar o lembrete em si.

BEGIN;

CREATE TABLE IF NOT EXISTS lembretes (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  descricao      TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'pessoal' CHECK (tipo IN ('cobranca','cliente','operacao','reuniao','pessoal')),
  prioridade     TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta','media','baixa')),
  data           DATE NOT NULL,
  hora           TIME,
  alerta         TEXT CHECK (alerta IS NULL OR alerta IN ('no-dia','1-dia','3-dias','personalizado')),
  concluido      BOOLEAN NOT NULL DEFAULT false,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lembretes_usuario_id ON lembretes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_lembretes_usuario_concluido ON lembretes(usuario_id, concluido);
CREATE INDEX IF NOT EXISTS idx_lembretes_cliente_id ON lembretes(cliente_id);

ALTER TABLE lembretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lembretes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lembretes_isolamento ON lembretes;
CREATE POLICY lembretes_isolamento ON lembretes
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

GRANT SELECT, INSERT, UPDATE, DELETE ON lembretes TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE lembretes_id_seq TO credplus_app;

COMMIT;
