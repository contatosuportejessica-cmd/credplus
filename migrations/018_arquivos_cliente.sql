-- CredPlus | Migration 018 — arquivos do cliente
--
-- Metadados + bytes de documentos/imagens/comprovantes/contratos por
-- cliente, com RLS por usuário. Exclusão real (DELETE) — arquivo não é
-- histórico financeiro.
--
-- Decisão de armazenamento (documentada): o backend antigo guardava bytes
-- em disco local da VPS (multer/UPLOADS_DIR) — efêmero e inutilizável em
-- serverless, sem token Blob/S3 configurado no projeto. Para não criar
-- infraestrutura paralela, os bytes vivem no próprio Neon (BYTEA/TOAST)
-- com teto rígido de 3MB por arquivo aplicado na API — nada "pesado" no
-- banco. Se o volume crescer, a troca por Vercel Blob/S3 exigirá só trocar
-- o corpo das rotas (o contrato da API já isola os bytes).
-- Sem GRANT UPDATE: correção de arquivo = excluir e reenviar.

BEGIN;

CREATE TABLE IF NOT EXISTS arquivos (
  id               SERIAL PRIMARY KEY,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  nome_original    TEXT NOT NULL,
  mime             TEXT NOT NULL,
  tamanho_bytes    INTEGER NOT NULL CHECK (tamanho_bytes BETWEEN 1 AND 3145728),
  dados            BYTEA NOT NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arquivos_cliente_id ON arquivos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_arquivos_usuario_id ON arquivos(usuario_id);

ALTER TABLE arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE arquivos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS arquivos_isolamento ON arquivos;
CREATE POLICY arquivos_isolamento ON arquivos
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

GRANT SELECT, INSERT, DELETE ON arquivos TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE arquivos_id_seq TO credplus_app;

COMMIT;
