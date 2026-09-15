-- CredPlus | Migration 015 — pergunta secreta de recuperação de senha
--
-- Recuperação por pergunta/resposta (sem e-mail): duas colunas novas em
-- `usuarios`, ambas NULL para manter compatibilidade com as contas que já
-- existem (elas continuam logando normalmente e cadastram a pergunta em
-- Configurações → Segurança).
--
-- A resposta NUNCA é guardada em texto: só o hash scrypt (mesmo formato do
-- password_hash). Nenhum GRANT/RLS novo é necessário — as colunas herdam as
-- permissões da tabela (SELECT/UPDATE para credplus_app, migration 001).
--
-- Funções SECURITY DEFINER (mesmo padrão da migration 002 — RLS FORÇADO
-- impede essas operações por policy normal, pois não há usuario_id antes
-- de existir sessão):
--   * credplus_registrar_usuario/5: substitui a versão /3 (DROP + CREATE,
--     sem tocar o arquivo 002). O backend antigo de referência (/backend,
--     nunca publicado) usava a versão /3 — ele não é executado em produção.
--   * credplus_login_lookup: recriada incluindo pergunta_recuperacao
--     (adição de coluna no retorno — o SELECT * do código antigo continua
--     funcionando, só ignora a coluna nova).
--   * credplus_recuperacao_lookup: id + pergunta + hash da resposta por
--     e-mail — o ÚNICO acesso à resposta (sempre hash) fora de sessão.
--   * credplus_redefinir_senha: troca password_hash por id — só é chamada
--     pela rota DEPOIS de conferir a resposta no Node, nunca direto.

BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pergunta_recuperacao TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS resposta_hash TEXT;

DROP FUNCTION IF EXISTS credplus_registrar_usuario(TEXT, TEXT, TEXT);
CREATE FUNCTION credplus_registrar_usuario(p_email TEXT, p_hash TEXT, p_nome TEXT, p_pergunta TEXT, p_resposta_hash TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id INTEGER;
BEGIN
  INSERT INTO usuarios (email, password_hash, nome, pergunta_recuperacao, resposta_hash)
  VALUES (p_email, p_hash, p_nome, p_pergunta, p_resposta_hash)
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION credplus_registrar_usuario(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credplus_registrar_usuario(TEXT, TEXT, TEXT, TEXT, TEXT) TO credplus_app;

DROP FUNCTION IF EXISTS credplus_login_lookup(TEXT);
CREATE OR REPLACE FUNCTION credplus_login_lookup(p_email TEXT)
RETURNS TABLE (id INTEGER, password_hash TEXT, nome TEXT, pergunta_recuperacao TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.password_hash, u.nome, u.pergunta_recuperacao
  FROM usuarios u
  WHERE u.email = p_email;
$$;

REVOKE ALL ON FUNCTION credplus_login_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credplus_login_lookup(TEXT) TO credplus_app;

CREATE OR REPLACE FUNCTION credplus_recuperacao_lookup(p_email TEXT)
RETURNS TABLE (id INTEGER, pergunta TEXT, resposta_hash TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.pergunta_recuperacao, u.resposta_hash
  FROM usuarios u
  WHERE u.email = p_email;
$$;

REVOKE ALL ON FUNCTION credplus_recuperacao_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credplus_recuperacao_lookup(TEXT) TO credplus_app;

CREATE OR REPLACE FUNCTION credplus_redefinir_senha(p_id INTEGER, p_hash TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE usuarios SET password_hash = p_hash, atualizado_em = now() WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION credplus_redefinir_senha(INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credplus_redefinir_senha(INTEGER, TEXT) TO credplus_app;

COMMIT;
