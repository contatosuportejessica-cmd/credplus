-- CredPlus | Migration 013 — simulacoes + simulacao_parcelas (Simulador de operação)
--
-- Uma simulação é uma PROPOSTA (snapshot) que pode ou não virar empréstimo
-- real. Diferente de Cobranças (que é só uma view derivada de parcelas),
-- aqui precisamos de persistência própria: a proposta deve sobreviver
-- exatamente como foi apresentada, mesmo que os parâmetros do sistema
-- mudem no futuro (não é uma view derivada, é um registro histórico).
--
-- cliente_id é opcional (simulações podem ser feitas antes do cliente
-- existir no cadastro) e pode ser vinculado depois via UPDATE.
--
-- status: em_aberto (pode editar) -> convertida (imutável, gerou
-- emprestimo_id) ou arquivada (também imutável, só removida da listagem
-- principal). Nunca exclusão física — mesmo padrão de clientes/emprestimos.
--
-- Sem chave de idempotência própria aqui: a idempotência da CONVERSÃO
-- vem (a) do guard "WHERE status = 'em_aberto'" na transação de conversão
-- e (b) da chave_idempotencia já existente na tabela emprestimos — não
-- duplicamos esse mecanismo.

BEGIN;

CREATE TABLE IF NOT EXISTS simulacoes (
  id                      SERIAL PRIMARY KEY,
  usuario_id              INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cliente_id              INTEGER REFERENCES clientes(id) ON DELETE RESTRICT,
  nome                    TEXT NOT NULL,
  capital_centavos        BIGINT NOT NULL CHECK (capital_centavos > 0),
  total_centavos          BIGINT NOT NULL CHECK (total_centavos > capital_centavos),
  modo                    TEXT NOT NULL CHECK (modo IN ('valor-final', 'percentual')),
  percentual              NUMERIC(10, 2),
  qtd_parcelas            INTEGER NOT NULL CHECK (qtd_parcelas > 0),
  frequencia              TEXT NOT NULL CHECK (frequencia IN ('diario', 'semanal', 'quinzenal', 'mensal', 'personalizado')),
  dias_personalizado      INTEGER,
  data_primeira_cobranca  DATE NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'em_aberto' CHECK (status IN ('em_aberto', 'convertida', 'arquivada')),
  emprestimo_id           INTEGER REFERENCES emprestimos(id) ON DELETE RESTRICT,
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simulacoes_usuario_id ON simulacoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_simulacoes_usuario_status ON simulacoes(usuario_id, status);
CREATE INDEX IF NOT EXISTS idx_simulacoes_cliente_id ON simulacoes(cliente_id);

ALTER TABLE simulacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulacoes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulacoes_isolamento ON simulacoes;
CREATE POLICY simulacoes_isolamento ON simulacoes
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

-- Sem GRANT DELETE de proposito: uma simulacao nunca e apagada fisicamente
-- (so arquivada/convertida), mesmo padrao de clientes e emprestimos.
GRANT SELECT, INSERT, UPDATE ON simulacoes TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE simulacoes_id_seq TO credplus_app;

CREATE TABLE IF NOT EXISTS simulacao_parcelas (
  id              SERIAL PRIMARY KEY,
  simulacao_id    INTEGER NOT NULL REFERENCES simulacoes(id) ON DELETE CASCADE,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  numero          INTEGER NOT NULL CHECK (numero > 0),
  valor_centavos  BIGINT NOT NULL CHECK (valor_centavos >= 0),
  vencimento      DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_simulacao_parcelas_simulacao_id ON simulacao_parcelas(simulacao_id);
CREATE INDEX IF NOT EXISTS idx_simulacao_parcelas_usuario_id ON simulacao_parcelas(usuario_id);

ALTER TABLE simulacao_parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulacao_parcelas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulacao_parcelas_isolamento ON simulacao_parcelas;
CREATE POLICY simulacao_parcelas_isolamento ON simulacao_parcelas
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

-- Único caso do sistema com GRANT DELETE: o cronograma de uma simulação
-- AINDA EM ABERTO pode ser regenerado por inteiro ao editar a proposta
-- (DELETE + INSERT, na mesma transação). Diferente de parcelas reais de
-- empréstimos (histórico financeiro imutável), isto aqui é rascunho de
-- proposta. Uma simulação CONVERTIDA ou ARQUIVADA nunca tem suas parcelas
-- tocadas pela aplicação — essa trava é de código (rotas/simulacoes.js),
-- não do GRANT do banco, propositalmente para permitir a regeneração seguro
-- apenas no estado em_aberto.
GRANT SELECT, INSERT, UPDATE, DELETE ON simulacao_parcelas TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE simulacao_parcelas_id_seq TO credplus_app;

COMMIT;
