-- CredPlus | Migration 005 — pagamentos (Etapa 3 do CredPlus real)
--
-- Historico financeiro IMUTAVEL por desenho: credplus_app recebe apenas
-- SELECT e INSERT nesta tabela (sem UPDATE, sem DELETE). Um pagamento
-- registrado nunca pode ser sobrescrito ou apagado pela aplicacao; uma
-- futura correcao/estorno precisara ser um novo evento auditavel, nao uma
-- edicao do original — a ausencia de GRANT UPDATE/DELETE torna isso
-- impossivel de contornar sem uma migration explicita.
--
-- cliente_id e emprestimo_id sao denormalizados (derivados no backend a
-- partir da parcela, nunca confiados do corpo da requisicao) para permitir
-- consultas futuras de Financeiro/movimentacoes sem joins profundos.
--
-- valor_esperado_centavos e um SNAPSHOT do valor da parcela no momento do
-- pagamento — preserva o historico mesmo que a parcela venha a mudar no
-- futuro por algum mecanismo ainda nao criado.

BEGIN;

CREATE TABLE IF NOT EXISTS pagamentos (
  id                        SERIAL PRIMARY KEY,
  usuario_id                INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  parcela_id                INTEGER NOT NULL REFERENCES parcelas(id) ON DELETE RESTRICT,
  emprestimo_id              INTEGER NOT NULL REFERENCES emprestimos(id) ON DELETE RESTRICT,
  cliente_id                INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
  valor_esperado_centavos    BIGINT NOT NULL CHECK (valor_esperado_centavos >= 0),
  valor_recebido_centavos    BIGINT NOT NULL CHECK (valor_recebido_centavos > 0),
  data                       DATE NOT NULL,
  forma                      TEXT NOT NULL CHECK (forma IN ('pix','dinheiro','transferencia','outro')),
  observacao                 TEXT,
  criado_em                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_usuario_id ON pagamentos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_parcela_id ON pagamentos(parcela_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_emprestimo_id ON pagamentos(emprestimo_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_cliente_id ON pagamentos(cliente_id);

ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pagamentos_isolamento ON pagamentos;
CREATE POLICY pagamentos_isolamento ON pagamentos
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

-- Sem UPDATE, sem DELETE: so SELECT + INSERT. Historico imutavel garantido
-- no nivel de privilegio do banco, nao so por convencao da aplicacao.
GRANT SELECT, INSERT ON pagamentos TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE pagamentos_id_seq TO credplus_app;

COMMIT;
