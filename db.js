const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     'localhost',
  user:     'root',
  password: '',
  database: 'botzapbarber',
  waitForConnections: true,
  connectionLimit:    10
});

// Contatos pendentes cuja data de agendamento já chegou (ou não tem data)
async function getPendentes() {
  const [rows] = await pool.query(`
    SELECT numero, nome FROM contatos
    WHERE status = 'pendente'
      AND (data_agendada IS NULL OR data_agendada <= CURDATE())
  `);
  return rows;
}

// Contatos que receberam disparo mas não responderam há mais de X dias
async function getIndecisos(diasSemResposta = 2) {
  const [rows] = await pool.query(`
    SELECT numero, nome FROM contatos
    WHERE status = 'disparo_enviado'
      AND ultima_tentativa < NOW() - INTERVAL ? DAY
  `, [diasSemResposta]);
  return rows;
}

// Busca etapa atual de um contato (para restaurar estado após reinício)
async function getContato(numero) {
  const [rows] = await pool.query(
    'SELECT status, etapa FROM contatos WHERE numero = ?',
    [numero]
  );
  return rows[0] || null;
}

async function marcarDisparado(numero, waid = null) {
  await pool.query(`
    UPDATE contatos
       SET status = 'disparo_enviado',
           etapa  = 'aguardando_interesse',
           waid   = ?,
           tentativas = tentativas + 1,
           data_disparo = COALESCE(data_disparo, NOW()),
           ultima_tentativa = NOW(),
           ultima_interacao = NOW()
     WHERE numero = ?
  `, [waid, numero]);
}

async function getContatoPorWaid(waid) {
  const [rows] = await pool.query(
    'SELECT * FROM contatos WHERE waid = ?', [waid]
  );
  return rows[0] || null;
}

async function marcarIndeciso(numero) {
  await pool.query(`
    UPDATE contatos
       SET status = 'indeciso',
           etapa  = 'aguardando_interesse',
           tentativas = tentativas + 1,
           ultima_tentativa = NOW(),
           ultima_interacao = NOW()
     WHERE numero = ?
  `, [numero]);
}

async function marcarOptout(numero) {
  await pool.query(`
    UPDATE contatos
       SET status = 'optout', etapa = NULL, ultima_interacao = NOW()
     WHERE numero = ?
  `, [numero]);
}

async function atualizarContato(numero, status, etapa = null) {
  await pool.query(`
    UPDATE contatos
       SET status = ?, etapa = ?, ultima_interacao = NOW()
     WHERE numero = ?
  `, [status, etapa, numero]);
}

// ── Painel admin ──────────────────────────────────────────────

async function getContatoPorId(id) {
  const [rows] = await pool.query('SELECT * FROM contatos WHERE id = ?', [id]);
  return rows[0] || null;
}

async function getTodos(statusFiltro = null) {
  if (statusFiltro) {
    const [rows] = await pool.query(
      'SELECT * FROM contatos WHERE status = ? ORDER BY criado_em DESC',
      [statusFiltro]
    );
    return rows;
  }
  const [rows] = await pool.query('SELECT * FROM contatos ORDER BY criado_em DESC');
  return rows;
}

async function getStats() {
  const [rows] = await pool.query(
    'SELECT status, COUNT(*) as total FROM contatos GROUP BY status'
  );
  const stats = { total: 0, pendente: 0, disparo_enviado: 0, indeciso: 0,
                  interessado: 0, link_enviado: 0, recusou: 0, optout: 0 };
  for (const row of rows) {
    stats[row.status] = Number(row.total);
    stats.total += Number(row.total);
  }
  return stats;
}

async function adicionarContato(numero, nome = null, dataAgendada = null) {
  await pool.query(
    'INSERT IGNORE INTO contatos (numero, nome, data_agendada) VALUES (?, ?, ?)',
    [numero, nome || null, dataAgendada || null]
  );
}

async function editarContato(id, { nome, status, data_agendada }) {
  const etapa = status === 'pendente' ? null : undefined;
  if (etapa === null) {
    await pool.query(
      'UPDATE contatos SET nome = ?, status = ?, data_agendada = ?, etapa = NULL WHERE id = ?',
      [nome || null, status, data_agendada || null, id]
    );
  } else {
    await pool.query(
      'UPDATE contatos SET nome = ?, status = ?, data_agendada = ? WHERE id = ?',
      [nome || null, status, data_agendada || null, id]
    );
  }
}

async function removerContato(id) {
  await pool.query('DELETE FROM contatos WHERE id = ?', [id]);
}

async function getUsuario(email) {
  const [rows] = await pool.query('SELECT * FROM usuarios WHERE email = ?', [email]);
  return rows[0] || null;
}

async function criarUsuario(email, senhaHash) {
  await pool.query('INSERT INTO usuarios (email, senha) VALUES (?, ?)', [email, senhaHash]);
}

// ── Configurações ─────────────────────────────────────────────

async function getConfiguracoes() {
  const [rows] = await pool.query('SELECT chave, valor FROM configuracoes');
  const cfg = {};
  for (const r of rows) cfg[r.chave] = r.valor;
  return cfg;
}

async function salvarConfiguracao(chave, valor) {
  await pool.query(
    'INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = ?',
    [chave, valor, valor]
  );
}

// ── Fluxo de conversa ─────────────────────────────────────────

async function getFluxo() {
  const [rows] = await pool.query(
    'SELECT * FROM fluxo WHERE ativo = 1 ORDER BY etapa, ordem'
  );
  return rows;
}

async function getMensagem(id) {
  const [rows] = await pool.query('SELECT * FROM fluxo WHERE id = ?', [id]);
  return rows[0] || null;
}

async function adicionarMensagem(etapa, tipo, conteudo, ordem) {
  const [[{ maxOrdem }]] = await pool.query(
    'SELECT COALESCE(MAX(ordem), 0) AS maxOrdem FROM fluxo WHERE etapa = ?', [etapa]
  );
  const ordemFinal = Math.max(ordem, maxOrdem + 1);
  await pool.query(
    'INSERT INTO fluxo (etapa, tipo, conteudo, ordem) VALUES (?, ?, ?, ?)',
    [etapa, tipo, conteudo, ordemFinal]
  );
}

async function editarMensagem(id, tipo, conteudo, ordem) {
  await pool.query(
    'UPDATE fluxo SET tipo = ?, conteudo = ?, ordem = ? WHERE id = ?',
    [tipo, conteudo, ordem, id]
  );
}

async function removerMensagem(id) {
  await pool.query('DELETE FROM fluxo WHERE id = ?', [id]);
}

module.exports = {
  getPendentes, getIndecisos, getContato, getContatoPorWaid,
  marcarDisparado, marcarIndeciso, marcarOptout, atualizarContato,
  getTodos, getContatoPorId, getStats, adicionarContato, editarContato, removerContato,
  getUsuario, criarUsuario,
  getConfiguracoes, salvarConfiguracao,
  getFluxo, getMensagem, adicionarMensagem, editarMensagem, removerMensagem
};
