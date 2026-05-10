USE botzapbarber;

ALTER TABLE contatos
  ADD COLUMN IF NOT EXISTS data_agendada    DATE        DEFAULT NULL       AFTER etapa,
  ADD COLUMN IF NOT EXISTS tentativas       INT         NOT NULL DEFAULT 0 AFTER data_agendada,
  ADD COLUMN IF NOT EXISTS ultima_tentativa DATETIME    DEFAULT NULL       AFTER tentativas,
  ADD COLUMN IF NOT EXISTS waid             VARCHAR(60) DEFAULT NULL       AFTER ultima_tentativa;

CREATE TABLE IF NOT EXISTS usuarios (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  email     VARCHAR(100) UNIQUE NOT NULL,
  senha     VARCHAR(255) NOT NULL,
  criado_em DATETIME DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave VARCHAR(50) PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT IGNORE INTO configuracoes VALUES
  ('horario_inicio',        '9'),
  ('horario_fim',           '20'),
  ('dias_semana',           '1,2,3,4,5'),
  ('intervalo_verificacao', '60'),
  ('intervalo_entre_envios','20'),
  ('dias_indeciso',         '2');

CREATE TABLE IF NOT EXISTS fluxo (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  etapa    VARCHAR(50)  NOT NULL,
  ordem    INT          NOT NULL DEFAULT 0,
  tipo     VARCHAR(10)  NOT NULL DEFAULT 'texto',
  conteudo TEXT         NOT NULL,
  ativo    TINYINT      NOT NULL DEFAULT 1
);

INSERT IGNORE INTO fluxo (etapa, ordem, tipo, conteudo) VALUES
  ('abordagem',   1, 'texto', 'Olá, bom dia! 👋 Vi que você é barbeiro aqui na região.\n\nTenho um sistema de agendamento que ajuda a manter a agenda cheia e automática. Posso te mostrar como funciona?'),
  ('followup',    1, 'texto', 'Oi! Tudo bem? 👋 Semana passada te mandei uma mensagem sobre o BarberZone e não sei se chegou a ver.\n\nÉ um sistema de agendamento que elimina as faltas e libera seu WhatsApp. Vale 2 minutos do seu tempo. Posso te mostrar?'),
  ('solucao',     1, 'texto', 'O sistema elimina aquela perda de tempo repetindo preços e horários no WhatsApp.\n\nÉ super simples: você configura tudo com poucos cliques e o cliente agenda sozinho. É como ter um assistente 24h cuidando da burocracia enquanto você foca no corte.'),
  ('preco',       1, 'texto', 'Sobre o valor: sistemas assim custam uns R$ 80 ou R$ 120 mensais. Mas para os primeiros usuários, estamos fazendo por apenas *R$ 29,90/mês*.\n\nMenos de R$ 1 por dia para ganhar horas de descanso na sua semana. Topa testar? Só responder *SIM* que te mando o link. 😊'),
  ('link',        1, 'texto', 'Perfeito! 🚀 Acessa agora e cria sua conta em menos de 5 minutos:\n👉 *https://barberzone.com.br*\n\nQualquer dúvida no cadastro é só chamar aqui. 💪'),
  ('encerramento',1, 'texto', 'Sem problema! Se mudar de ideia é só chamar. 👊\nO link fica aqui: https://barberzone.com.br'),
  ('optout',      1, 'texto', 'Tudo bem! Vou te remover da lista. Não receberá mais mensagens. 🙏'),
  ('naoEntendeu', 1, 'texto', 'Não entendi bem. 😅 Responde *SIM* pra continuar ou *NÃO* caso não tenha interesse.');
