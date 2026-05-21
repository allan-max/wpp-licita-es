const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const https = require('https');
const http = require('http'); // 👈 A NOSSA FERRAMENTA BLINDADA
const { spawn } = require('child_process');

let mainWindow;
let clientInstance = null;
let tray = null;
let processoDotNet = null;

// ==========================================
// 1. CONFIGURAÇÕES DA MÁQUINA E LICENÇA
// ==========================================
let hwidAtual;
try { hwidAtual = machineIdSync(true); } catch (e) { hwidAtual = 'DESCONHECIDO'; }

const WEBHOOK_DISCORD = 'https://discord.com/api/webhooks/1504491496668401924/TE9n3p4KYWlX2mPDAfXuzaw4Kvd2PZZ0yxytfzHYerbvrXKOqWbOTjcHvGdzxx8zb4B4';

// ==========================================
// 2. SUPER SISTEMA DE LOGS DE ATUALIZAÇÃO
// ==========================================
const logPath = path.join(app.getPath('userData'), 'log-atualizacao.txt');

const logUpdate = (msg) => {
  const linhaLog = `[${new Date().toLocaleString('pt-PT')}] ${msg}\n`;
  console.log(linhaLog);
  try { fs.appendFileSync(logPath, linhaLog); } catch (e) { }
};

autoUpdater.on('checking-for-update', () => logUpdate('🔍 Conectando ao GitHub... Procurando nova versão.'));
autoUpdater.on('update-available', (info) => logUpdate(`⚠️ BOA! Nova versão V${info.version} encontrada. Iniciando o download silencioso...`));
autoUpdater.on('update-not-available', (info) => logUpdate(`✅ Nenhuma atualização encontrada. O app já está na última versão (V${info.version}).`));
autoUpdater.on('error', (err) => logUpdate(`❌ [ERRO NO UPDATER]: ${err.message}`));
autoUpdater.on('download-progress', (progressObj) => logUpdate(`⏳ Baixando atualização... Progresso: ${Math.round(progressObj.percent)}%`));

autoUpdater.on('update-downloaded', async (info) => {
  logUpdate(`🚀 Download da versão ${info.version} concluído 100%!`);

  if (mainWindow) mainWindow.webContents.send('atualizando-automatico', info.version);

  if (clientInstance) {
    const ARQUIVO_CONTATOS = path.join(app.getPath('userData'), 'contatos.json');
    if (fs.existsSync(ARQUIVO_CONTATOS)) {
      const contatos = JSON.parse(fs.readFileSync(ARQUIVO_CONTATOS, 'utf8'));
      for (const numero of contatos) {
        try {
          await clientInstance.sendText(numero, `🔄 *Maestro: Sistema Atualizado!*\n\nA nova versão *v${info.version}* foi baixada e instalada com sucesso.\n\nO aplicativo está a ser reiniciado de forma automática para aplicar as melhorias agora mesmo! 🚀`);
        } catch (e) { logUpdate(`Erro ao notificar WhatsApp: ${e.message}`); }
      }
    }
  }

  setTimeout(async () => {
    logUpdate('Iniciando protocolo de aniquilação para liberar os ficheiros...');
    if (processoDotNet) { processoDotNet.kill(); }
    if (clientInstance) { try { await clientInstance.close(); } catch (e) { } }
    app.removeAllListeners('window-all-closed');
    autoUpdater.quitAndInstall(false, true);
  }, 5000);
});

// ==========================================
// 4. CONFIGURAÇÃO DA JANELA
// ==========================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900, height: 700,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/maestro-licita.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true }
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('close', function (event) {
    if (!app.isQuiting) { event.preventDefault(); mainWindow.hide(); }
    return false;
  });
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('versao-app', app.getVersion());
  });
}

ipcMain.on('aplicar-atualizacao', () => autoUpdater.quitAndInstall());

app.whenReady().then(() => {
  logUpdate(`\n=================================================`);
  logUpdate(`=== APLICATIVO INICIADO - VERSÃO ATUAL: ${app.getVersion()} ===`);
  logUpdate(`=================================================`);

  createWindow();

  setTimeout(() => {
    logUpdate(`Iniciando verificação inicial de atualizações...`);
    if (!app.isPackaged) {
      logUpdate(`❌ AVISO: O Auto-Updater NÃO funciona usando 'npm start'.`);
    } else {
      autoUpdater.checkForUpdatesAndNotify();
      setInterval(() => {
        logUpdate(`🔄 Ronda Automática do Radar: Verificando se o desenvolvedor lançou novidades...`);
        autoUpdater.checkForUpdatesAndNotify();
      }, 30 * 60 * 1000);
    }
  }, 5000);

  ipcMain.on('reiniciar-app', () => {
    if (processoDotNet) processoDotNet.kill();
    app.relaunch(); app.quit();
  });

  tray = new Tray(path.join(__dirname, 'assets/maestro-licita.ico'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir Painel do Bot', click: function () { mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Encerrar Robô Completamente', click: function () { app.isQuiting = true; if (processoDotNet) processoDotNet.kill(); app.quit(); } }
  ]);
  tray.setToolTip('Maestro Licitações - A Correr');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); });

  mainWindow.webContents.once('did-finish-load', () => { gerenciarLicenca(); });
});

// ==========================================
// 5. SISTEMA DE LICENÇA E CÉREBRO
// ==========================================
function gerenciarLicenca() {
  const userDataPath = app.getPath('userData');
  const ARQUIVO_LICENCA = path.join(userDataPath, 'licenca.json');

  if (fs.existsSync(ARQUIVO_LICENCA)) {
    const licencaSalva = JSON.parse(fs.readFileSync(ARQUIVO_LICENCA, 'utf8'));
    if (licencaSalva.hwid === hwidAtual && licencaSalva.status === 'ativo') {
      mainWindow.webContents.send('liberar-tela-principal');
      iniciarBotDeVerdade();
      return;
    }
  }

  const novaChave = crypto.randomBytes(4).toString('hex').toUpperCase();
  const dados = JSON.stringify({ content: `🚨 **Novo Acesso Detectado!**\n💻 HWID: \`${hwidAtual}\`\n🔑 Chave para o cliente: \`${novaChave}\`` });

  const req = https.request(WEBHOOK_DISCORD, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } }, (res) => { });
  req.on('error', () => { }); req.write(dados); req.end();

  mainWindow.webContents.send('pedir-chave', novaChave);

  ipcMain.once('validar-chave', (event, chaveDigitada) => {
    if (chaveDigitada === novaChave) {
      fs.writeFileSync(ARQUIVO_LICENCA, JSON.stringify({ token: novaChave, hwid: hwidAtual, status: 'ativo' }, null, 2));
      mainWindow.webContents.send('liberar-tela-principal');
      iniciarBotDeVerdade();
    } else { mainWindow.webContents.send('chave-invalida'); }
  });
}

function iniciarBotDeVerdade() {
  const userDataPath = app.getPath('userData');
  const ARQUIVO_LOG = path.join(userDataPath, 'log-zap.txt');
  const ARQUIVO_CONTATOS = path.join(userDataPath, 'contatos.json');
  const ARQUIVO_VOTACOES = path.join(userDataPath, 'votacoes.json');

  let chatsLiberados = [];
  let votacoesAtivas = {};

  let filaDeEditais = [];
  let processandoFila = false;

  try {
    if (fs.existsSync(ARQUIVO_CONTATOS)) chatsLiberados = JSON.parse(fs.readFileSync(ARQUIVO_CONTATOS, 'utf8'));
    else fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify([]));
  } catch (erro) { }

  try {
    if (fs.existsSync(ARQUIVO_VOTACOES)) votacoesAtivas = JSON.parse(fs.readFileSync(ARQUIVO_VOTACOES, 'utf8'));
    else fs.writeFileSync(ARQUIVO_VOTACOES, JSON.stringify({}));
  } catch (erro) { }

  function salvarContatos() { fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify(chatsLiberados, null, 2)); }
  function salvarVotacoes() { fs.writeFileSync(ARQUIVO_VOTACOES, JSON.stringify(votacoesAtivas, null, 2)); }

  function registrarLog(mensagem) {
    const linhaLog = `[${new Date().toLocaleString('pt-PT')}] ${mensagem}`;
    console.log(linhaLog);
    fs.appendFileSync(ARQUIVO_LOG, linhaLog + '\n', 'utf8');
    if (mainWindow) mainWindow.webContents.send('novo-log', linhaLog);
  }

  // =======================================================
  // MOTOR ANTI-FLOOD: PROCESSADOR DE FILA
  // =======================================================
  async function processarProximoEdital() {
    if (filaDeEditais.length === 0) {
      processandoFila = false;
      registrarLog('✅ Todos os editais da fila foram enviados!');
      return;
    }

    processandoFila = true;

    const edital = filaDeEditais.shift();
    const idEdital = edital.id_edital || edital.id || Math.floor(Math.random() * 1000000).toString();
    const mensagemCompleta = `🚨 *NOVO EDITAL ENCONTRADO!* 🚨\n\n🆔 *ID:* ${idEdital}\n🏢 *Órgão:* ${edital.orgao}\n📍 *Local de Serviço:* ${edital.local}\n💰 *Valor Estimado:* ${edital.valor}\n\n📄 *Objeto:* ${edital.objeto}\n\n👉 *Deseja participar desta licitação?*`;

    let enviouParaAlguem = false;

    try {
      for (const numero of chatsLiberados) {
        const msgEnviada = await clientInstance.sendPollMessage(numero, mensagemCompleta, [
          '✅ Sim, tenho interesse', '❌ Não, pode descartar'
        ]);

        const enqueteId = typeof msgEnviada.id === 'object' ? msgEnviada.id._serialized : msgEnviada.id;
        votacoesAtivas[enqueteId] = { numero: numero, id_edital: idEdital, votoAtual: null, timerIniciado: false };
        enviouParaAlguem = true;
      }
      if (enviouParaAlguem) salvarVotacoes();
    } catch (erro) { registrarLog(`Erro ao enviar edital da fila: ${erro.message}`); }

    if (filaDeEditais.length > 0) {
      registrarLog(`⏳ Fila ativa: Aguardando 1 minuto de segurança para enviar o próximo... (${filaDeEditais.length} na fila)`);
      setTimeout(processarProximoEdital, 30000);
    } else {
      processarProximoEdital();
    }
  }

  registrarLog('A iniciar o cérebro do Bot (Hub Central)...');

  // ========================================================
  // 📥 SERVIDOR (PORTA 3000): OUVIR EDITAIS DO C#
  // ========================================================
  const server3000 = express();
  server3000.use(express.json());

  server3000.get('/', (req, res) => res.json({ status: 'API 3000 Online' }));
  server3000.get('/health', (req, res) => res.json({ status: 'ok' }));

  server3000.post('/novo-edital', async (req, res) => {
    res.json({ status: 'colocado_na_fila' });
    registrarLog('📥 Recebido do C#: Novo Edital inserido na fila de espera.');

    if (!clientInstance) return registrarLog('Aviso: WPPConnect não está pronto para enviar.');
    if (chatsLiberados.length === 0) return registrarLog('Aviso: Nenhum contacto liberado para receber.');

    filaDeEditais.push(req.body);
    if (!processandoFila) { processarProximoEdital(); }
  });

  server3000.listen(3000, '127.0.0.1', () => {
    registrarLog(`📡 Receção de Editais a correr em http://127.0.0.1:3000`);

    const caminhoDotNet = app.isPackaged
      ? path.join(process.resourcesPath, 'publish', 'Welington II.exe')
      : path.join(__dirname, 'assets', 'publish', 'Welington II.exe');

    if (fs.existsSync(caminhoDotNet)) {
      registrarLog('A iniciar motor .NET...');
      processoDotNet = spawn(caminhoDotNet);
      processoDotNet.stdout.on('data', (dados) => registrarLog(`[.NET]: ${dados.toString().trim()}`));
      processoDotNet.stderr.on('data', (erro) => registrarLog(`[ERRO .NET]: ${erro.toString().trim()}`));
    }

    iniciarWhatsApp();
  });

  function iniciarWhatsApp() {
    registrarLog('A iniciar motor do WhatsApp Web...');
    wppconnect.create({
      session: 'sessao-api-bot',
      headless: true,
      catchQR: (base64Qr, asciiQR) => {
        registrarLog('QR Code gerado! A aguardar que o cliente faça o scan...');
        if (mainWindow) mainWindow.webContents.send('exibir-qr', base64Qr);
      }
    }).then((client) => {
      clientInstance = client;
      registrarLog('WhatsApp Conectado com sucesso!');

      if (mainWindow) {
        mainWindow.webContents.send('whatsapp-conectado');
        mainWindow.webContents.send('atualizar-contatos', chatsLiberados);
      }

      client.onMessage((message) => {
        if (message.isGroupMsg || typeof message.body !== 'string') return;

        const texto = message.body.toLowerCase().trim();
        const numero = message.from;

        if (texto === 'liberar chat') {
          if (!chatsLiberados.includes(numero)) {
            chatsLiberados.push(numero);
            salvarContatos();
            registrarLog(`Novo administrador atrelado: ${numero}`);
            if (mainWindow) mainWindow.webContents.send('atualizar-contatos', chatsLiberados);
            client.sendText(numero, '✅ *Sistema Vinculado!*\nEste chat foi libertado e passará a receber as licitações aqui.');
          } else {
            client.sendText(numero, '⚠️ O seu chat já estava vinculado.');
          }
        }
        else if (texto === 'sair') {
          if (chatsLiberados.includes(numero)) {
            chatsLiberados = chatsLiberados.filter(n => n !== numero);
            salvarContatos();
            registrarLog(`Administrador descadastrado: ${numero}`);
            if (mainWindow) mainWindow.webContents.send('atualizar-contatos', chatsLiberados);
            client.sendText(numero, '🛑 *Inscrição Cancelada!*\nVocê não receberá mais notificações de licitações. Se desejar voltar, digite *liberar chat*.');
          }
        }
      });

      client.onPollResponse(async (res) => {
        try {
          const enqueteId = typeof res.msgId === 'object' ? res.msgId._serialized : res.msgId;

          if (votacoesAtivas[enqueteId]) {
            const dadosDaVotacao = votacoesAtivas[enqueteId];
            const pacoteDeDados = JSON.stringify(res.selectedOptions || res).toLowerCase();

            // Define o voto atual
            if (pacoteDeDados.includes('sim') || pacoteDeDados.includes('aceitar')) {
              dadosDaVotacao.votoAtual = true;
            } else if (pacoteDeDados.includes('não') || pacoteDeDados.includes('recusar') || pacoteDeDados.includes('descartar')) {
              dadosDaVotacao.votoAtual = false;
            } else { return; }

            // SE FOR O PRIMEIRO CLIQUE: Inicia a contagem visual
            if (!dadosDaVotacao.timerIniciado) {
              dadosDaVotacao.timerIniciado = true;
              salvarVotacoes();

              // REAÇÃO 1: Ampulheta indicando tempo em curso
              await client.sendReactionToMessage(enqueteId, '⏳');
              registrarLog(`⏳ Tempo iniciado para o Edital [${dadosDaVotacao.id_edital}].`);

              setTimeout(async () => {
                const votoFinal = votacoesAtivas[enqueteId].votoAtual;

                // REAÇÃO 2: Certinho verde indicando que foi processado e enviado
                await client.sendReactionToMessage(enqueteId, '✅');
                registrarLog(`✅ Tempo esgotado para o Edital [${dadosDaVotacao.id_edital}]. Voto enviado.`);

                const resposta = {
                  telefone: dadosDaVotacao.numero,
                  id_edital: dadosDaVotacao.id_edital,
                  aprovado: votoFinal
                };
                const payload = JSON.stringify(resposta);

                // ENVIO PARA O .NET (Como você pediu, usando a forma nativa)
                const reqNet = http.request({
                  hostname: '127.0.0.1',
                  port: 8080, // 👈 Alterado de 5000 para 8080
                  path: '/resposta-edital',
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                  }
                }, (resNet) => {
                  registrarLog(`🟢 [SUCESSO] Comunicação C# finalizada. Status: ${resNet.statusCode}`);
                });

                reqNet.on('error', (err) => {
                  registrarLog(`❌ [ERRO] Falha ao enviar para o C#: ${err.message}`);
                });

                reqNet.write(payload);
                reqNet.end();

                delete votacoesAtivas[enqueteId];
                salvarVotacoes();

              }, 60000); // 1 minuto de espera

            } else {
              // Se o usuário clicar novamente, apenas salvamos o novo voto silenciosamente
              salvarVotacoes();
              registrarLog(`[ALTERAÇÃO] ${dadosDaVotacao.numero} trocou o voto dentro do tempo.`);
            }
          }
        } catch (erro) { registrarLog(`Erro na enquete: ${erro.message}`); }
      });

    }).catch((error) => { registrarLog(`Erro WPPConnect: ${error.message}`); });
  }
}