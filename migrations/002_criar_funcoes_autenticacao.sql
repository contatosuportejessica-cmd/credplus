-- CredPlus | Migration 002 — funções de cadastro/login (SECURITY DEFINER)
--
-- backend/src/rotas/auth.js já chama estas duas funções exatamente assim:
--   SELECT credplus_registrar_usuario($1, $2, $3) AS id   -- (email, hash, nome)
--   SELECT * FROM credplus_login_lookup($1)                -- (email) -> {id, password_hash, nome}
-- Este arquivo só cria o que o código já espera — nenhuma assinatura nova.
--
-- Por que SECURITY DEFINER (ver também o comentário no topo de auth.js):
-- `usuarios` tem RLS forçado por (id = app.usuario_id). Cadastro precisa
-- fazer INSERT antes de existir qualquer usuario_id; login precisa fazer
-- SELECT por e-mail antes de saber quem é o usuario_id. Nenhum dos dois
-- casos tem como uma policy normal decidir — daí as duas únicas exceções,
-- estreitas e parametrizadas, em vez de abrir RLS pra tabela inteira.

BEGIN;

-- Cadastro: insere e devolve o id novo, ou NULL se o e-mail já existe (o
-- ON CONFLICT DO NOTHING não retorna linha nesse caso) — auth.js trata
-- `id === null` como 409 "já existe uma conta com este e-mail".
CREATE OR REPLACE FUNCTION credplus_registrar_usuario(p_email TEXT, p_hash TEXT, p_nome TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id INTEGER;
BEGIN
  INSERT INTO usuarios (email, password_hash, nome)
  VALUES (p_email, p_hash, p_nome)
  ON CONFLICT (email) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION credplus_registrar_usuario(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credplus_registrar_usuario(TEXT, TEXT, TEXT) TO credplus_app;

-- Login: busca só o necessário para conferir a senha e assinar o token —
-- nunca devolve mais colunas do que auth.js já desestrutura
-- ({ id, password_hash, nome }).
CREATE OR REPLACE FUNCTION credplus_login_lookup(p_email TEXT)
RETURNS TABLE (id INTEGER, password_hash TEXT, nome TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.password_hash, u.nome
  FROM usuarios u
  WHERE u.email = p_email;
$$;

REVOKE ALL ON FUNCTION credplus_login_lookup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION credplus_login_lookup(TEXT) TO credplus_app;

COMMIT;
