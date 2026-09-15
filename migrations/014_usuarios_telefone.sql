-- CredPlus | Migration 014 — coluna telefone em usuarios
--
-- O frontend já possui campo "Telefone" no perfil (PUT /api/usuario/perfil
-- { nome, telefone }) e exibe usuario.telefone na tela de configurações,
-- mas a tabela usuarios (migration 001) nunca teve essa coluna.
--
-- UPDATE já é permitido à role credplus_app pela migration 001 (GRANT
-- SELECT, UPDATE) e a policy de RLS auto-referente continua valendo — por
-- isso nenhum GRANT ou POLICY novo é necessário aqui, só a coluna.

BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;

COMMIT;
