-- CredPlus | Migration 016 — foto de perfil (usuarios.foto)
--
-- Avatar do usuário exibido no topo, na barra lateral e no Perfil.
-- TEXT nullable: contas existentes continuam sem foto (iniciais), sem
-- nenhuma migração de dados. O frontend reduz a imagem para 256px JPEG
-- antes de enviar (~15-30KB) e a API recusa data-URL acima de 200KB —
-- nada de Base64 pesado no banco.
--
-- credplus_login_lookup é recriada incluindo `foto` (mesmo padrão da
-- 015: DROP + CREATE versionado, sem tocar arquivos antigos). Nenhum
-- GRANT/RLS novo: a coluna herda as permissões da tabela.

BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto TEXT;

DROP FUNCTION IF EXISTS credplus_login_lookup(TEXT);
CREATE OR REPLACE FUNCTION credplus_login_lookup(p_email TEXT)
RETURNS TABLE (id INTEGER, password_hash TEXT, nome TEXT, pergunta_recuperacao TEXT, foto TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.password_hash, u.nome, u.pergunta_recuperacao, u.foto
  FROM usuarios u
  WHERE u.email = p_email;
$$;

REVOKE ALL ON FUNCTION credplus_login_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credplus_login_lookup(TEXT) TO credplus_app;

COMMIT;
