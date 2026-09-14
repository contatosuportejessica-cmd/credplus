-- CredPlus | Migration 006 — idempotencia de pagamentos (correcao da Etapa 3)
--
-- Fecha uma lacuna conhecida: duas requisicoes POST /pagamentos identicas
-- (duplo clique, retry de rede, resposta perdida) podiam gerar dois
-- registros de pagamento para a mesma tentativa do usuario.
--
-- chave_idempotencia e gerada pelo FRONTEND uma unica vez por clique em
-- "Registrar pagamento" (nao pelos campos parcela+valor+data, que dois
-- pagamentos legitimos do mesmo valor poderiam compartilhar). Nula para
-- os pagamentos ja existentes antes desta migration (nao ha problema:
-- UNIQUE em Postgres nao considera NULL como colisao entre si).
--
-- Indice UNICO parcial (usuario_id, chave_idempotencia) — a checagem de
-- unicidade e por usuario, entao a chave de um usuario jamais interfere na
-- de outro mesmo na hipotese teorica de colisao aleatoria.

BEGIN;

ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS chave_idempotencia TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pagamentos_usuario_chave_idem
  ON pagamentos(usuario_id, chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

COMMIT;
