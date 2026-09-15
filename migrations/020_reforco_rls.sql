-- CredPlus | Migration 020 — reforço idempotente do RLS
--
-- CONTEXTO: auditoria de segurança detectou que o isolamento entre contas
-- depende hoje SOMENTE do RLS. Se em algum ambiente o RLS estiver
-- desabilitado (migrations aplicadas parcialmente, por exemplo), contas
-- passam a enxergar dados umas das outras. O código da API já foi
-- reforçado com predicado explícito `usuario_id` em todas as consultas
-- (defesa em profundidade), e esta migration garante a camada do banco.
--
-- 100% idempotente e sem tocar em dados: ENABLE/FORCE são no-ops se já
-- ativos; cada policy é DROP IF EXISTS + CREATE. Pode rodar quantas vezes
-- for preciso, em qualquer ordem após a 001. Não cria tabelas, não altera
-- colunas, não move nenhum registro.

BEGIN;

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usuarios_isolamento ON usuarios;
CREATE POLICY usuarios_isolamento ON usuarios
  USING (id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clientes_isolamento ON clientes;
CREATE POLICY clientes_isolamento ON clientes
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE emprestimos ENABLE ROW LEVEL SECURITY;
ALTER TABLE emprestimos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emprestimos_isolamento ON emprestimos;
CREATE POLICY emprestimos_isolamento ON emprestimos
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcelas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parcelas_isolamento ON parcelas;
CREATE POLICY parcelas_isolamento ON parcelas
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pagamentos_isolamento ON pagamentos;
CREATE POLICY pagamentos_isolamento ON pagamentos
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE pagamento_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamento_itens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pagamento_itens_isolamento ON pagamento_itens;
CREATE POLICY pagamento_itens_isolamento ON pagamento_itens
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE movimentacoes_financeiras ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes_financeiras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movfin_isolamento ON movimentacoes_financeiras;
CREATE POLICY movfin_isolamento ON movimentacoes_financeiras
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE lembretes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lembretes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lembretes_isolamento ON lembretes;
CREATE POLICY lembretes_isolamento ON lembretes
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE lembrete_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lembrete_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lembrete_templates_isolamento ON lembrete_templates;
CREATE POLICY lembrete_templates_isolamento ON lembrete_templates
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metas_isolamento ON metas;
CREATE POLICY metas_isolamento ON metas
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE notas ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notas_isolamento ON notas;
CREATE POLICY notas_isolamento ON notas
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE arquivos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS arquivos_isolamento ON arquivos;
CREATE POLICY arquivos_isolamento ON arquivos
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE simulacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulacoes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulacoes_isolamento ON simulacoes;
CREATE POLICY simulacoes_isolamento ON simulacoes
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

ALTER TABLE simulacao_parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulacao_parcelas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulacao_parcelas_isolamento ON simulacao_parcelas;
CREATE POLICY simulacao_parcelas_isolamento ON simulacao_parcelas
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

COMMIT;
