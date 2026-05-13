const qrcode      = require('qrcode-terminal');
const path        = require('path');
const http        = require('http');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const db          = require('./db');

// ── Cliente ───────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
           '--disable-accelerated-2d-canvas','--no-first-run','--no-zygote',
           '--single-process','--disable-gpu']
  }
});

// ── Config e fluxo dinâmicos ──────────────────────────────────
let CONFIG = {
  horario_inicio: 9, horario_fim: 20,
  dias_semana: [1,2,3,4,5],
  intervalo_verificacao: 60,
  intervalo_entre_envios: 20,
  dias_indeciso: 2
};
let FLUXO = {}; // { etapa: [{ id, tipo, conteudo, ordem }] }

async function carregarConfig() {
  try {
    const cfg = await db.getConfiguracoes();
    if (cfg.horario_inicio)         CONFIG.horario_inicio         = parseInt(cfg.horario_inicio);
    if (cfg.horario_fim)            CONFIG.horario_fim             = parseInt(cfg.horario_fim);
    if (cfg.dias_semana)            CONFIG.dias_semana             = cfg.dias_semana.split(',').map(Number);
    if (cfg.intervalo_verificacao)  CONFIG.intervalo_verificacao   = parseInt(cfg.intervalo_verificacao);
    if (cfg.intervalo_entre_envios) CONFIG.intervalo_entre_envios  = parseInt(cfg.intervalo_entre_envios);
    if (cfg.dias_indeciso)          CONFIG.dias_indeciso           = parseInt(cfg.dias_indeciso);
  } catch(e) { console.error('[CONFIG]', e.message); }
}

async function carregarFluxo() {
  try {
    const rows = await db.getFluxo();
    FLUXO = {};
    for (const row of rows) {
      if (!FLUXO[row.etapa]) FLUXO[row.etapa] = [];
      FLUXO[row.etapa].push(row);
    }
  } catch(e) { console.error('[FLUXO]', e.message); }
}

// ── QR / Auth ─────────────────────────────────────────────────
client.on('qr', qr => {
  console.clear();
  qrcode.generate(qr, { small: true });
  console.log('\nQR disponível em:',
    `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
});

client.on('authenticated', () => console.log('[✔] Autenticado.'));
client.on('auth_failure',  m  => console.error('[✖] Autenticação falhou:', m));

client.on('disconnected', async r => {
  console.log('[!] Desconectado:', r, '— reiniciando em 5s...');
  await delay(5000);
  client.initialize();
});

let intervaloDisparo = null;

client.on('ready', async () => {
  console.log('[✔] Bot online.');
  await carregarConfig();
  await carregarFluxo();
  await verificarEDisparar();

  // Recarrega config/fluxo e verifica disparos conforme intervalo configurado
  if (intervaloDisparo) clearInterval(intervaloDisparo);
  intervaloDisparo = setInterval(async () => {
    await carregarConfig();
    await carregarFluxo();
    await verificarEDisparar();
  }, CONFIG.intervalo_verificacao * 60 * 1000);
});

client.initialize();

// ── API interna (porta 3001) para o painel acionar disparos ───
http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('{}'); }

  if (req.url === '/reload') {
    carregarConfig().then(() => carregarFluxo()).catch(console.error);
    console.log('[RELOAD] Config e fluxo recarregados do banco.');
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.url === '/disparar') {
    verificarEDisparar().catch(console.error);
    return res.end(JSON.stringify({ ok: true }));
  }
  const match = req.url.match(/^\/disparar\/(.+)$/);
  if (match) {
    enviarParaLead(decodeURIComponent(match[1])).catch(console.error);
    return res.end(JSON.stringify({ ok: true }));
  }
  res.statusCode = 404; res.end('{}');
}).listen(3001, () => console.log('[API] Bot API interna na porta 3001'));

// ── Helpers ───────────────────────────────────────────────────
const delay = ms => new Promise(res => setTimeout(res, ms));
const humanDelay = text => Math.min(Math.max(text.length * 38, 2000), 9000);

const send = async (chat, to, text) => {
  await delay(800 + Math.random() * 800);
  await chat.sendStateTyping();
  await delay(humanDelay(text));
  await client.sendMessage(to, text);
};

// Envia todas as mensagens de uma etapa (texto, imagem ou áudio)
async function sendEtapa(chat, _to, etapa, sufixoUltima = '') {
  const msgs = FLUXO[etapa] || [];
  if (msgs.length === 0) console.warn(`[FLUXO] Etapa "${etapa}" sem mensagens cadastradas.`);
  for (let i = 0; i < msgs.length; i++) {
    const m      = msgs[i];
    const isLast = i === msgs.length - 1;
    await delay(800 + Math.random() * 800);

    if (m.tipo === 'texto') {
      const texto = isLast && sufixoUltima ? m.conteudo + sufixoUltima : m.conteudo;
      await chat.sendStateTyping();
      await delay(humanDelay(texto));
      await chat.sendMessage(texto);

    } else if (m.tipo === 'imagem' || m.tipo === 'audio') {
      try {
        const filePath = path.isAbsolute(m.conteudo)
          ? m.conteudo
          : path.join(__dirname, m.conteudo);
        const media = MessageMedia.fromFilePath(filePath);
        await chat.sendMessage(media);
      } catch(e) {
        console.error(`[MÍDIA] Erro ao enviar ${m.conteudo}:`, e.message);
      }
    }
  }
}

const dentroDoHorario = () => {
  const agora = new Date();
  const h     = agora.getHours();
  const dia   = agora.getDay();
  return CONFIG.dias_semana.includes(dia) && h >= CONFIG.horario_inicio && h < CONFIG.horario_fim;
};

// ── Disparo automático ────────────────────────────────────────
const emDisparo = new Set();

async function verificarEDisparar() {
  if (!dentroDoHorario()) {
    console.log('[DISPARO] Fora do horário permitido.');
    return;
  }
  const pendentes = await db.getPendentes();
  const indecisos = await db.getIndecisos(CONFIG.dias_indeciso);
  console.log(`[DISPARO] ${pendentes.length} pendente(s), ${indecisos.length} indeciso(s).`);

  for (const c of pendentes) {
    if (emDisparo.has(c.numero)) continue;
    emDisparo.add(c.numero);
    await delay(CONFIG.intervalo_entre_envios * 1000);
    await enviarAbordagem(c.numero, 'abordagem');
    emDisparo.delete(c.numero);
  }
  for (const c of indecisos) {
    if (emDisparo.has(c.numero)) continue;
    emDisparo.add(c.numero);
    await delay(CONFIG.intervalo_entre_envios * 1000);
    await enviarAbordagem(c.numero, 'followup');
    emDisparo.delete(c.numero);
  }
}

async function enviarAbordagem(numero, etapa) {
  try {
    const numberId = await client.getNumberId(numero);
    if (!numberId) { console.error(`[DISPARO] Não encontrado: ${numero}`); return; }
    const id = numberId._serialized;

    // Envia mensagens da etapa + sufixo de resposta na última
    const msgs = FLUXO[etapa] || [];
    for (let i = 0; i < msgs.length; i++) {
      const m      = msgs[i];
      const isLast = i === msgs.length - 1;
      await delay(800 + Math.random() * 800);
      if (m.tipo === 'texto') {
        const texto = isLast ? m.conteudo + '\n\n› Digite *SIM* ou *NÃO*' : m.conteudo;
        await client.sendMessage(id, texto);
      } else if (m.tipo === 'imagem' || m.tipo === 'audio') {
        const filePath = path.isAbsolute(m.conteudo) ? m.conteudo : path.join(__dirname, m.conteudo);
        await client.sendMessage(id, MessageMedia.fromFilePath(filePath));
      }
    }

    setState(numero, { step: 'aguardando_interesse' }); // usa o número limpo como chave
    if (etapa === 'followup') await db.marcarIndeciso(numero);
    else                      await db.marcarDisparado(numero, id); // salva o LID/waid
    console.log(`[DISPARO] ✔ ${numero} (${etapa})`);
  } catch(e) { console.error(`[ERRO] ${numero}:`, e.message); }
}

// Disparo individual para um número específico (via painel)
async function enviarParaLead(numero) {
  const contato = await db.getContato(numero);
  const etapa   = contato?.status === 'indeciso' ? 'followup' : 'abordagem';
  await enviarAbordagem(numero, etapa);
}

// ── Estado em memória ─────────────────────────────────────────
const userState   = {};
const getState    = from => userState[from] || {};
const setState    = (from, data) => { userState[from] = { ...getState(from), ...data }; };

// ── Anti-concorrência: bloqueia novo msg enquanto processa o anterior ─
const processing = new Set();

// ── Intenções ─────────────────────────────────────────────────
const ehSim    = t => /\b(sim|s|si|claro|quero|pode|ok|bora|topo|tapa|yes|manda|tá|ta|aceito|vamos|com certeza)\b/i.test(t);
const ehNao    = t => /\b(não|nao|n|agora não|depois|deixa|dispensa|obrigado|obrigada|valeu|sem interesse|nao quero)\b/i.test(t);
const ehOptout = t => /\b(para|parar|sair|remover|cancelar|stop|descadastrar|me remova|me retire|não me mande|nao me mande)\b/i.test(t);

// ── Handler principal ─────────────────────────────────────────
client.on('message', async msg => {
  if (!msg.from.endsWith('@c.us') && !msg.from.endsWith('@lid')) return;
  if (processing.has(msg.from)) return;

  const body = (msg.body || '').trim();
  const from = msg.from;
  if (!body) return;

  processing.add(from);
  try {

  const chat = await msg.getChat();

  // Resolve o número real — busca por waid quando formato @lid
  let numero;
  if (from.endsWith('@c.us')) {
    numero = from.replace('@c.us', '');
  } else {
    const porWaid = await db.getContatoPorWaid(from);
    if (porWaid) {
      numero = porWaid.numero;
    } else {
      try {
        const contact = await msg.getContact();
        numero = contact.id.user;
      } catch {
        numero = from.replace(/@.*/, '');
      }
    }
  }
  console.log(`[MSG] from:${from} | numero:${numero} | body:${body}`);

  // ── Optout (prioridade máxima) ────────────────────────────
  if (ehOptout(body)) {
    await db.marcarOptout(numero);
    setState(numero, { step: 'optout' });
    await sendEtapa(chat, from, 'optout');
    return;
  }

  // Restaura estado do banco após reinício
  let state = getState(numero);
  if (!state.step) {
    const dbc = await db.getContato(numero);
    if (dbc?.etapa) { setState(numero, { step: dbc.etapa }); state = getState(numero); }
  }

  // ── Etapa 1: responde à abordagem ────────────────────────
  if (state.step === 'aguardando_interesse') {
    if (ehSim(body)) {
      setState(numero, { step: 'aguardando_link' });
      await db.atualizarContato(numero, 'interessado', 'aguardando_link');
      await sendEtapa(chat, from, 'solucao');
      await sendEtapa(chat, from, 'preco', '\n\n› Digite *SIM* ou *NÃO*');
    } else if (ehNao(body)) {
      setState(numero, { step: 'encerrado' });
      await db.atualizarContato(numero, 'recusou', 'encerrado');
      await sendEtapa(chat, from, 'encerramento');
    } else {
      await sendEtapa(chat, from, 'naoEntendeu');
    }
    return;
  }

  // ── Etapa 2: responde após ver preço ─────────────────────
  if (state.step === 'aguardando_link') {
    if (ehSim(body)) {
      setState(numero, { step: 'concluido' });
      await db.atualizarContato(numero, 'link_enviado', 'concluido');
      await sendEtapa(chat, from, 'link');
    } else if (ehNao(body)) {
      setState(numero, { step: 'encerrado' });
      await db.atualizarContato(numero, 'recusou', 'encerrado');
      await sendEtapa(chat, from, 'encerramento');
    } else {
      await sendEtapa(chat, from, 'naoEntendeu');
    }
    return;
  }

  // ── Fora do fluxo ────────────────────────────────────────
  const dbc = await db.getContato(numero);
  if (dbc?.status === 'optout') return;

  setState(numero, { step: 'aguardando_interesse' });
  await db.atualizarContato(numero, 'disparo_enviado', 'aguardando_interesse');
  await sendEtapa(chat, from, 'abordagem', '\n\n› Digite *SIM* ou *NÃO*');
  } catch(e) {
    console.error('[HANDLER]', e.message, e.stack);
  } finally {
    processing.delete(from);
  }
});
