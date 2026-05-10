// leitor de qr code
const qrcode = require('qrcode-terminal');
const { Client, Buttons, List, MessageMedia, LocalAuth } = require('whatsapp-web.js');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// serviço de leitura do QR Code
client.on('qr', qr => {
    console.clear();
    qrcode.generate(qr, { small: true });
    console.log('\nLink do QR Code:', `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
});

client.on('authenticated', () => {
    console.log('[AUTH] Autenticado com sucesso.');
});

client.on('auth_failure', msg => {
    console.error('[AUTH FAILURE]', msg);
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

client.on('disconnected', reason => {
    console.log('[DESCONECTADO]', reason);
});

client.initialize();

const delay = ms => new Promise(res => setTimeout(res, ms));

// Tempo de digitação proporcional ao tamanho da mensagem (mín 2s, máx 8s)
const typingDelay = text => Math.min(Math.max(text.length * 35, 2000), 8000);

// Envia mensagem com indicador de digitação proporcional ao texto
const sendWithTyping = async (chat, to, text) => {
    await delay(1000);
    await chat.sendStateTyping();
    await delay(typingDelay(text));
    await client.sendMessage(to, text);
};

// Funil

client.on('message_create', async msg => {
    console.log('[DEBUG] body:', msg.body, '| from:', msg.from, '| to:', msg.to, '| fromMe:', msg.fromMe);

    // Ignora mensagens enviadas pelo próprio bot (evita loop)
    if (msg.fromMe) return;
    // Ignora grupos, newsletters e broadcasts
    if (!msg.from.endsWith('@c.us') && !msg.from.endsWith('@lid')) return;

    const isContact = msg.from.endsWith('@c.us') || msg.from.endsWith('@lid');
    const chat = await msg.getChat();

    if (msg.body.match(/(menu|dia|tarde|noite|oi|olá|ola)/i) && isContact) {
        const contact = await msg.getContact();
        const name = contact.pushname ? contact.pushname.split(' ')[0] : 'cliente';
        await sendWithTyping(chat, msg.from, `Olá, ${name}! Sou o assistente virtual da empresa tal. Como posso ajudá-lo hoje? Por favor, digite uma das opções abaixo:\n\n1 - Como funciona\n2 - Valores dos planos\n3 - Benefícios\n4 - Como aderir\n5 - Outras perguntas`);
    }

    if (msg.body === '1' && isContact) {
        await sendWithTyping(chat, msg.from, 'Nosso serviço oferece consultas médicas 24 horas por dia, 7 dias por semana, diretamente pelo WhatsApp.\n\nNão há carência, o que significa que você pode começar a usar nossos serviços imediatamente após a adesão.\n\nOferecemos atendimento médico ilimitado, receitas\n\nAlém disso, temos uma ampla gama de benefícios, incluindo acesso a cursos gratuitos');
        await sendWithTyping(chat, msg.from, 'COMO FUNCIONA?\nÉ muito simples.\n\n1º Passo\nFaça seu cadastro e escolha o plano que desejar.\n\n2º Passo\nApós efetuar o pagamento do plano escolhido você já terá acesso a nossa área exclusiva para começar seu atendimento na mesma hora.\n\n3º Passo\nSempre que precisar');
        await sendWithTyping(chat, msg.from, 'Link para cadastro: https://site.com');
    }

    if (msg.body === '2' && isContact) {
        await sendWithTyping(chat, msg.from, '*Plano Individual:* R$22,50 por mês.\n\n*Plano Família:* R$39,90 por mês, inclui você mais 3 dependentes.\n\n*Plano TOP Individual:* R$42,50 por mês, com benefícios adicionais como\n\n*Plano TOP Família:* R$79,90 por mês, inclui você mais 3 dependentes');
        await sendWithTyping(chat, msg.from, 'Link para cadastro: https://site.com');
    }

    if (msg.body === '3' && isContact) {
        await sendWithTyping(chat, msg.from, 'Sorteio de em prêmios todo ano.\n\nAtendimento médico ilimitado 24h por dia.\n\nReceitas de medicamentos');
        await sendWithTyping(chat, msg.from, 'Link para cadastro: https://site.com');
    }

    if (msg.body === '4' && isContact) {
        await sendWithTyping(chat, msg.from, 'Você pode aderir aos nossos planos diretamente pelo nosso site ou pelo WhatsApp.\n\nApós a adesão, você terá acesso imediato');
        await sendWithTyping(chat, msg.from, 'Link para cadastro: https://site.com');
    }

    if (msg.body === '5' && isContact) {
        await sendWithTyping(chat, msg.from, 'Se você tiver outras dúvidas ou precisar de mais informações, por favor, fale aqui nesse whatsapp ou visite nosso site: https://site.com');
    }
});
