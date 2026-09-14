-- CredPlus | Migration 001 — role de aplicacao + tabela "usuarios"
--
-- Prerequisito que faltava no repositorio migrado da VPS: as migrations
-- 003+ ja existentes referenciam `usuarios(id)` (FK) e `GRANT ... TO
-- credplus_app`, mas nenhuma migration anterior criava nem a tabela nem o
-- role — sem esta, a sequencia inteira falhava na primeira migration real
-- (003) com "relation usuarios does not exist" / "role credplus_app does
-- not exist".
--
-- Estrutura de `usuarios` decidida pelo codigo existente, nao inventada:
-- backend/src/rotas/auth.js usa `id`, `nome`, `email` e (via
-- credplus_login_lookup) `password_hash` — exatamente essas colunas, sem
-- nenhuma a mais.
--
-- RLS auto-referente (id = app.usuario_id) pelo mesmo motivo de `clientes`
-- (migration 003): FORCE garante isolamento mesmo se algum código
-- esquecer o escopo. Cadastro (INSERT) e login (SELECT por e-mail, sem
-- usuario_id ainda definido) só acontecem via as funções SECURITY DEFINER
-- da migration 002 — é por isso que aqui não há nenhum GRANT INSERT.

BEGIN;

-- Role de aplicacao (least-privilege), mesmo nome que as migrations 003+
-- já esperam. NOLOGIN e sem senha de proposito: nenhuma migration gera ou
-- grava segredo. Se um dia a conexão da aplicação precisar rodar como este
-- role (em vez do role padrão que o Neon fornece em DATABASE_URL),
-- habilite LOGIN e defina a senha fora deste arquivo (painel do Neon).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'credplus_app') THEN
    CREATE ROLE credplus_app NOLOGIN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS usuarios (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  nome           TEXT NOT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuarios_isolamento ON usuarios;
CREATE POLICY usuarios_isolamento ON usuarios
  USING (id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

-- Só o próprio registro, só leitura/atualização (ex.: rota GET /api/auth/me).
-- Cadastro nunca passa por aqui — sempre via credplus_registrar_usuario()
-- (migration 002), a única operação que precisa existir ANTES de haver um
-- usuario_id para a policy decidir.
GRANT SELECT, UPDATE ON usuarios TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE usuarios_id_seq TO credplus_app;

COMMIT;
