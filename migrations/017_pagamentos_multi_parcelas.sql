-- CredPlus | Migration 017 — pagamento multi-parcelas + forma cartão
--
-- Um recebimento pode quitar VÁRIAS parcelas de uma vez (ex.: R$ 5.000 que
-- quita as parcelas 3-7) ou ser parcial/antecipado. Antes, pagamentos
-- apontavam para UMA parcela (parcela_id NOT NULL) — impossível representar
-- isso sem duplicar registros, o que é proibido.
--
-- Desenho (sem destruir nada):
--   * nova tabela pagamento_itens (pagamento -> parcelas, com o valor
--     alocado em cada uma). Histórico imutável: só SELECT+INSERT, como
--     pagamentos e movimentações.
--   * pagamentos.parcela_id passa a NULL (multi-itens não têm "a" parcela;
--     os legados de item único mantêm o valor original).
--   * backfill idempotente: todo pagamento legado ganha sua linha em
--     pagamento_itens (WHERE NOT EXISTS — rerodar não duplica).
--   * forma passa a aceitar 'cartao' (DROP IF EXISTS + ADD do CHECK; os
--     valores antigos continuam válidos — nenhuma linha é tocada).

BEGIN;

ALTER TABLE pagamentos ALTER COLUMN parcela_id DROP NOT NULL;

ALTER TABLE pagamentos DROP CONSTRAINT IF EXISTS pagamentos_forma_check;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_forma_check
  CHECK (forma IN ('pix','dinheiro','transferencia','cartao','outro'));

CREATE TABLE IF NOT EXISTS pagamento_itens (
  id               SERIAL PRIMARY KEY,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  pagamento_id     INTEGER NOT NULL REFERENCES pagamentos(id) ON DELETE RESTRICT,
  parcela_id       INTEGER NOT NULL REFERENCES parcelas(id) ON DELETE RESTRICT,
  valor_centavos   BIGINT NOT NULL CHECK (valor_centavos > 0),
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagamento_itens_pagamento_id ON pagamento_itens(pagamento_id);
CREATE INDEX IF NOT EXISTS idx_pagamento_itens_parcela_id ON pagamento_itens(parcela_id);
CREATE INDEX IF NOT EXISTS idx_pagamento_itens_usuario_id ON pagamento_itens(usuario_id);

ALTER TABLE pagamento_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamento_itens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pagamento_itens_isolamento ON pagamento_itens;
CREATE POLICY pagamento_itens_isolamento ON pagamento_itens
  USING (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer)
  WITH CHECK (usuario_id = NULLIF(current_setting('app.usuario_id', true), '')::integer);

GRANT SELECT, INSERT ON pagamento_itens TO credplus_app;
GRANT USAGE, SELECT ON SEQUENCE pagamento_itens_id_seq TO credplus_app;

INSERT INTO pagamento_itens (usuario_id, pagamento_id, parcela_id, valor_centavos)
SELECT p.usuario_id, p.id, p.parcela_id, p.valor_recebido_centavos
FROM pagamentos p
WHERE p.parcela_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pagamento_itens i WHERE i.pagamento_id = p.id);

COMMIT;
