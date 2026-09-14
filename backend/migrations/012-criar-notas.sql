-- CredPlus | Migration 012 — notas (Etapa 8 do produto real)
--
-- Nota nao e historico financeiro: CRUD completo (GET/POST/PUT/DELETE),
-- todos realmente usados pelo frontend (fixar/desafixar via PUT,
-- exclusao real via DELETE). Ordenacao (fixadas primeiro, depois mais
-- recentes) e feita AQUI, no backend, pois o modo real do frontend nao
-- reordena a lista recebida (so o modo demo faz isso client-side).
--
-- cliente_id e opcional: usado tanto pela tela geral de Notas (sempre
-- null) quanto pela aba "Anotacoes" do detalhe do cliente (vinculado ao
-- cliente real). ON DELETE SET NULL: perder o vinculo nao apaga a nota.

BEGIN;

CREATE TABLE IF NOT EXISTS notas (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  titulo         TEXT NOT NULL,
  conteudo       TEXT,
  categoria      TEXT NOT NULL DEFAULT 'geral' CHECK (categoria IN ('geral','cliente','lembrete','reuniao','oportunidade','ideia')),
  fixado         BOOLEAN NOT NULL DEFAULT false,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_usuario_id ON notas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_notas_usuario_fixado ON notas(usuario_id, fixado);
CREATE INDEX IF NOT EXISTS idx_notas_cliente_id ON notas(cliente_id);

ALTER TABLE notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notas_isolamento ON notas;
CREATE POLICY notas_isolamento ON notas
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

GRANT SELECT, INSERT, UPDATE, DELETE ON notas TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE notas_id_seq TO credplus_app;

COMMIT;
