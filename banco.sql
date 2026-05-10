CREATE DATABASE IF NOT EXISTS botzapbarber CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE botzapbarber;

CREATE TABLE IF NOT EXISTS contatos (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  numero            VARCHAR(20)  NOT NULL UNIQUE,
  nome              VARCHAR(100) DEFAULT NULL,
  status            VARCHAR(30)  NOT NULL DEFAULT 'pendente',
  -- pendente       → nunca contatado
  -- disparo_enviado→ mensagem enviada, aguardando resposta
  -- indeciso       → não respondeu após X dias (vai receber follow-up)
  -- interessado    → respondeu SIM à abordagem
  -- link_enviado   → recebeu link (convertido)
  -- recusou        → disse NÃO
  -- optout         → não quer mais receber (nunca contatar)
  etapa             VARCHAR(30)  DEFAULT NULL,
  data_agendada     DATE         DEFAULT NULL,  -- NULL = enviar assim que possível
  tentativas        INT          NOT NULL DEFAULT 0,
  data_disparo      DATETIME     DEFAULT NULL,
  ultima_tentativa  DATETIME     DEFAULT NULL,
  ultima_interacao  DATETIME     DEFAULT NULL,
  criado_em         DATETIME     NOT NULL DEFAULT NOW()
);

-- Números para teste
INSERT IGNORE INTO contatos (numero) VALUES
  ('5585999607155'),
  ('5585996473077');
