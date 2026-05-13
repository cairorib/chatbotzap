const express = require('express');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');
const path    = require('path');
const http    = require('http');
const fs      = require('fs');
const db      = require('../db');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function deletarArquivo(caminho) {
  if (!caminho) return;
  const abs = path.isAbsolute(caminho)
    ? caminho
    : path.join(__dirname, '..', caminho);
  fs.unlink(abs, () => {});
}

// Chama a API interna do bot
function chamarBot(rota) {
  return new Promise(resolve => {
    const req = http.request(
      { hostname: 'localhost', port: 3001, path: rota, method: 'POST' },
      () => resolve(true)
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

// Parser simples de linha CSV (suporta campos com aspas)
function parseCsvLine(linha) {
  const result = [];
  let current = '', inQuotes = false;
  for (const c of linha) {
    if (c === '"') { inQuotes = !inQuotes; }
    else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += c; }
  }
  result.push(current.trim());
  return result;
}

const app  = express();
const PORT = 3000;

// ── Upload de mídia (imagem/áudio) — lê em memória, grava depois ─
// Evita conflito quando o arquivo de origem está na mesma pasta de destino
const upload = multer({ storage: multer.memoryStorage() });

function salvarUpload(file) {
  const nome = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dest = path.join(UPLOADS_DIR, nome);
  fs.writeFileSync(dest, file.buffer);
  return nome;
}

// ── Upload de CSV (em memória) ────────────────────────────────
const uploadCSV = multer({ storage: multer.memoryStorage() });

// ── Express setup ─────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: 'barberzone-painel-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

const auth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

// Nomes amigáveis das etapas
const ETAPAS = {
  abordagem:    'Abordagem inicial',
  followup:     'Follow-up (indeciso)',
  solucao:      'Solução',
  preco:        'Preço',
  link:         'Envio do link',
  encerramento: 'Encerramento',
  optout:       'Optout',
  naoEntendeu:  'Não entendeu'
};

// ── Auth ──────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { erro: null });
});

app.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  const u = await db.getUsuario(email);
  if (!u || !(await bcrypt.compare(senha, u.senha)))
    return res.render('login', { erro: 'E-mail ou senha incorretos.' });
  req.session.user = { id: u.id, email: u.email };
  res.redirect('/');
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// ── Dashboard ─────────────────────────────────────────────────
app.get('/', auth, async (req, res) => {
  const filtro = req.query.status || null;
  const [stats, contatos] = await Promise.all([db.getStats(), db.getTodos(filtro)]);
  res.render('dashboard', { stats, contatos, filtro, query: req.query, usuario: req.session.user, pagina: 'leads' });
});

// ── Leads ─────────────────────────────────────────────────────
app.post('/leads/adicionar', auth, async (req, res) => {
  const { numero, nome, data_agendada } = req.body;
  const limpo = numero.replace(/\D/g, '');
  if (limpo.length >= 10) await db.adicionarContato(limpo, nome, data_agendada || null);
  res.redirect('/');
});

app.post('/leads/editar/:id', auth, async (req, res) => {
  const { nome, status, data_agendada } = req.body;
  await db.editarContato(req.params.id, { nome, status, data_agendada });
  res.redirect('/');
});

app.post('/leads/remover/:id', auth, async (req, res) => {
  await db.removerContato(req.params.id);
  res.redirect('/');
});

// ── Download do modelo CSV ────────────────────────────────────
app.get('/leads/modelo-csv', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-leads.csv"');
  res.send('numero,nome,data_agendada\n5585999990000,João Barbeiro,2025-06-01\n5585988880000,Maria Silva,\n');
});

// ── Importar CSV ──────────────────────────────────────────────
app.post('/leads/importar', auth, uploadCSV.single('csv'), async (req, res) => {
  if (!req.file) return res.redirect('/');

  const conteudo = req.file.buffer.toString('utf8');
  const linhas   = conteudo.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let importados = 0, erros = 0;

  for (let i = 1; i < linhas.length; i++) { // pula cabeçalho
    const cols   = parseCsvLine(linhas[i]);
    const numero = (cols[0] || '').replace(/\D/g, '');
    const nome   = (cols[1] || '').replace(/^"|"$/g, '') || null;
    const data   = (cols[2] || '').replace(/^"|"$/g, '') || null;

    if (numero.length >= 10) {
      await db.adicionarContato(numero, nome, data || null);
      importados++;
    } else {
      erros++;
    }
  }

  res.redirect(`/?importados=${importados}&erros=${erros}`);
});

// ── Configurações ─────────────────────────────────────────────
app.get('/configuracoes', auth, async (req, res) => {
  const cfg  = await db.getConfiguracoes();
  const salvo = req.query.salvo === '1';
  res.render('configuracoes', { cfg, salvo, usuario: req.session.user, pagina: 'config' });
});

app.post('/configuracoes', auth, async (req, res) => {
  const { horario_inicio, horario_fim, intervalo_entre_envios,
          intervalo_verificacao, dias_indeciso } = req.body;

  const dias = Array.isArray(req.body.dias_semana)
    ? req.body.dias_semana.join(',')
    : (req.body.dias_semana || '');

  await Promise.all([
    db.salvarConfiguracao('horario_inicio',         horario_inicio),
    db.salvarConfiguracao('horario_fim',             horario_fim),
    db.salvarConfiguracao('dias_semana',             dias),
    db.salvarConfiguracao('intervalo_entre_envios',  intervalo_entre_envios),
    db.salvarConfiguracao('intervalo_verificacao',   intervalo_verificacao),
    db.salvarConfiguracao('dias_indeciso',           dias_indeciso),
  ]);
  res.redirect('/configuracoes?salvo=1');
});

// ── Fluxo de conversa ─────────────────────────────────────────
app.get('/fluxo', auth, async (req, res) => {
  const rows       = await db.getFluxo();
  const fluxo      = {};
  for (const r of rows) {
    if (!fluxo[r.etapa]) fluxo[r.etapa] = [];
    fluxo[r.etapa].push(r);
  }
  const etapaAtiva = req.query.etapa || null;
  res.render('fluxo', { fluxo, etapaAtiva, ETAPAS, usuario: req.session.user, pagina: 'fluxo' });
});

app.post('/fluxo/adicionar', auth, (req, res, next) => {
  upload.single('arquivo')(req, res, err => {
    if (err || req.aborted) return res.redirect('/fluxo?etapa=' + (req.query.etapa || '') + '&erro=upload');
    next();
  });
}, async (req, res) => {
  const etapa = req.query.etapa;
  const { tipo, conteudo, ordem } = req.body;
  let conteudoFinal = conteudo;
  if ((tipo === 'imagem' || tipo === 'audio') && req.file) {
    conteudoFinal = 'uploads/' + salvarUpload(req.file);
  }
  if (conteudoFinal) await db.adicionarMensagem(etapa, tipo, conteudoFinal, parseInt(ordem) || 1);
  res.redirect('/fluxo?etapa=' + etapa);
});

app.post('/fluxo/editar/:id', auth, (req, res, next) => {
  upload.single('arquivo')(req, res, err => {
    if (err || req.aborted) return res.redirect('/fluxo?etapa=' + (req.query.etapa || '') + '&erro=upload');
    next();
  });
}, async (req, res) => {
  const etapa = req.query.etapa;
  const { tipo, conteudo, ordem } = req.body;

  let conteudoFinal;
  if (tipo === 'texto') {
    conteudoFinal = conteudo;
  } else if (req.file) {
    // Novo arquivo enviado: apaga o antigo e usa o novo
    const nome = salvarUpload(req.file);
    const atual = await db.getMensagem(req.params.id);
    if (atual?.conteudo && atual.conteudo !== 'uploads/' + nome) {
      deletarArquivo(atual.conteudo);
    }
    conteudoFinal = 'uploads/' + nome;
  } else {
    // Sem novo arquivo: mantém o caminho atual do banco
    const atual = await db.getMensagem(req.params.id);
    conteudoFinal = atual?.conteudo || '';
  }

  if (conteudoFinal) await db.editarMensagem(req.params.id, tipo, conteudoFinal, parseInt(ordem) || 1);
  res.redirect('/fluxo?etapa=' + etapa);
});

app.post('/fluxo/remover/:id', auth, async (req, res) => {
  const etapa = req.query.etapa;
  const msg = await db.getMensagem(req.params.id);
  if (msg?.tipo !== 'texto') deletarArquivo(msg?.conteudo);
  await db.removerMensagem(req.params.id);
  res.redirect('/fluxo?etapa=' + etapa);
});

// ── Disparo manual ────────────────────────────────────────────
app.post('/bot/recarregar', auth, async (req, res) => {
  await chamarBot('/reload');
  res.redirect('/?recarregado=1');
});

app.post('/bot/disparar', auth, async (req, res) => {
  await chamarBot('/disparar');
  res.redirect('/?disparado=1');
});

app.post('/bot/disparar-lead/:id', auth, async (req, res) => {
  const contato = await db.getContatoPorId(req.params.id);
  if (contato) await chamarBot(`/disparar/${encodeURIComponent(contato.numero)}`);
  res.redirect('/');
});

app.listen(PORT, () => console.log(`[PAINEL] http://localhost:${PORT}`));
