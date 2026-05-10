// Rode uma vez para criar o usuário admin:
// node painel/setup-admin.js

const bcrypt = require('bcryptjs');
const db     = require('../db');

const EMAIL = 'admin@barberzone.com';
const SENHA = 'teste123!!!';

(async () => {
  const hash = await bcrypt.hash(SENHA, 10);
  await db.criarUsuario(EMAIL, hash);
  console.log(`✔ Admin criado: ${EMAIL} / senha: ${SENHA}`);
  process.exit(0);
})().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
