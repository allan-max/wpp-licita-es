const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const https = require('https'); 
const http = require('http'); 
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
// 2. CONFIGURAÇÃO DA JANELA
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

  // Envia a versão atual do app para o HTML logo após carregar
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('versao-app', app.getVersion());
  });

  autoUpdater.checkForUpdatesAndNotify();
}

const logUpdate = (msg) => {
  const logPath = path.join(app.getPath('userData'), 'log-atualizacao.txt');
  fs.appendFileSync(logPath, `[${new Date().toLocaleString('pt-PT')}] ${msg}\n`);
};

// =========================================================
// 🚀 ATUALIZAÇÃO 100% AUTOMÁTICA (SEM PERGUNTAS)
// =========================================================
autoUpdater.on('update-downloaded', async (info) => {
  logUpdate(`Nova versão ${info.version} baixada. A atualizar em modo silencioso...`);

  // 1. Avisa o ecrã da aplicação imediatamente
  if (mainWindow) {
    mainWindow.webContents.send('atualizando-automatico', info.version);
  }

  // 2. Envia um aviso de texto simples para todos no WhatsApp
  if (clientInstance) {
    const ARQUIVO_CONTATOS = path.join(app.getPath('userData'), 'contatos.json');
    if (fs.existsSync(ARQUIVO_CONTATOS)) {
      const contatos = JSON.parse(fs.readFileSync(ARQUIVO_CONTATOS, 'utf8'));
      for (const numero of contatos) {
        try {
          await clientInstance.sendText(
            numero,
            `🔄 *Maestro: Sistema Atualizado!*\n\nA nova versão *v${info.version}* foi baixada e instalada com sucesso.\n\nO aplicativo está a ser reiniciado de forma automática para aplicar as melhorias agora mesmo! 🚀`
          );
        } catch (e) { logUpdate(`Erro ao notificar WhatsApp: ${e.message}`); }
      }
    }
  }

  // 3. Aguarda 4 segundos (tempo para envio das mensagens) e reinicia sozinho!
  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 4000);
});

ipcMain.on('aplicar-atualizacao', () => autoUpdater.quitAndInstall());

app.whenReady().then(() => {
  createWindow();

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

  mainWindow.webContents.once('did-finish-load', () => {
    gerenciarLicenca();
  });
});

// ==========================================
// 4. SISTEMA DE LICENÇA
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

  const req = https.request(WEBHOOK_DISCORD, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } }, (res) => {});
  req.on('error', () => {}); req.write(dados); req.end();

  mainWindow.webContents.send('pedir-chave', novaChave);

  ipcMain.once('validar-chave', (event, chaveDigitada) => {
    if (chaveDigitada === novaChave) {
      fs.writeFileSync(ARQUIVO_LICENCA, JSON.stringify({ token: novaChave, hwid: hwidAtual, status: 'ativo' }, null, 2));
      mainWindow.webContents.send('liberar-tela-principal');
      iniciarBotDeVerdade();
    } else {
      mainWindow.webContents.send('chave-invalida');
    }
  });
}

// ==========================================
// 5. O CÉREBRO DO ROBÔ & COMUNICAÇÃO
// ==========================================
function iniciarBotDeVerdade() {
  const userDataPath = app.getPath('userData');
  const ARQUIVO_LOG = path.join(userDataPath, 'log-zap.txt');
  const ARQUIVO_CONTATOS = path.join(userDataPath, 'contatos.json');
  const ARQUIVO_VOTACOES = path.join(userDataPath, 'votacoes.json');
  
  let chatsLiberados = [];
  let votacoesAtivas = {}; 

  // Carrega contatos
  try {
    if (fs.existsSync(ARQUIVO_CONTATOS)) chatsLiberados = JSON.parse(fs.readFileSync(ARQUIVO_CONTATOS, 'utf8'));
    else fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify([]));
  } catch (erro) { console.log(`Erro memória contatos: ${erro.message}`); }

  // Carrega votações pendentes
  try {
    if (fs.existsSync(ARQUIVO_VOTACOES)) votacoesAtivas = JSON.parse(fs.readFileSync(ARQUIVO_VOTACOES, 'utf8'));
    else fs.writeFileSync(ARQUIVO_VOTACOES, JSON.stringify({}));
  } catch (erro) { console.log(`Erro memória votações: ${erro.message}`); }

  function salvarContatos() { fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify(chatsLiberados, null, 2)); }
  function salvarVotacoes() { fs.writeFileSync(ARQUIVO_VOTACOES, JSON.stringify(votacoesAtivas, null, 2)); }

  function registrarLog(mensagem) {
    const linhaLog = `[${new Date().toLocaleString('pt-PT')}] ${mensagem}`;
    console.log(linhaLog);
    fs.appendFileSync(ARQUIVO_LOG, linhaLog + '\n', 'utf8');
    if (mainWindow) mainWindow.webContents.send('novo-log', linhaLog);
  }

  registrarLog('A iniciar o cérebro do Bot de forma sequencial...');

  const server = express();
  server.use(express.json());

  server.get('/', (req, res) => res.json({ status: 'ok' }));
  server.get('/health', (req, res) => res.json({ status: 'ok' }));

  server.post('/novo-edital', async (req, res) => {
    res.json({ status: 'recebido' });
    registrarLog('📥 Recebido do C#: Novo Edital em processamento...');

    if (!clientInstance) return registrarLog('Aviso: WPPConnect não está pronto para enviar.');
    if (chatsLiberados.length === 0) return registrarLog('Aviso: Nenhum contacto liberado para receber.');

    const edital = req.body; 
    const idEdital = edital.id_edital || edital.id || Math.floor(Math.random() * 1000000).toString();
    const mensagemCompleta = `🚨 *NOVO EDITAL ENCONTRADO!* 🚨\n\n🆔 *ID:* ${idEdital}\n🏢 *Órgão:* ${edital.orgao}\n📍 *Local de Serviço:* ${edital.local}\n💰 *Valor Estimado:* ${edital.valor}\n\n📄 *Objeto:* ${edital.objeto}\n\n👉 *Deseja participar desta licitação?*`;

    try {
      for (const numero of chatsLiberados) {
        const msgEnviada = await clientInstance.sendPollMessage(numero, mensagemCompleta, [
          '✅ Sim, tenho interesse', '❌ Não, pode descartar'
        ], { selectableCount: 1 });
        
        const enqueteId = typeof msgEnviada.id === 'object' ? msgEnviada.id._serialized : msgEnviada.id;
        votacoesAtivas[enqueteId] = { numero: numero, id_edital: idEdital, votoAtual: null, timerIniciado: false };
        salvarVotacoes();
      }
    } catch (erro) { registrarLog(`Erro ao enviar edital: ${erro.message}`); }
  });

  server.listen(3000, 'localhost', () => {
    registrarLog(`API Local a correr em http://localhost:3000`);

    const caminhoDotNet = app.isPackaged 
        ? path.join(process.resourcesPath, 'publish', 'Welington II.exe')
        : path.join(__dirname, 'assets', 'publish', 'Welington II.exe');

    if (fs.existsSync(caminhoDotNet)) {
      registrarLog('A iniciar motor .NET...');
      processoDotNet = spawn(caminhoDotNet);
      processoDotNet.stdout.on('data', (dados) => registrarLog(`[.NET]: ${dados.toString().trim()}`));
      processoDotNet.stderr.on('data', (erro) => registrarLog(`[ERRO .NET]: ${erro.toString().trim()}`));

      function mandarCheckParaDotNet() {
        registrarLog('⏳ A aguardar .NET iniciar na porta 5000...');
        
        fetch('http://localhost:5000/')
          .then(() => {
            registrarLog('🟢 Aperto de mão estabelecido! O .NET respondeu ao Check.');
            iniciarWhatsApp();
          })
          .catch((err) => {
            setTimeout(mandarCheckParaDotNet, 1500);
          });
      }
      setTimeout(mandarCheckParaDotNet, 2000);
    } else {
      registrarLog(`Aviso: Welington II.exe não encontrado. A iniciar só o WPP.`);
      iniciarWhatsApp();
    }
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
        if (!message.isGroupMsg && message.body.toLowerCase() === 'liberar chat') {
          const numeroDoChefe = message.from; 
          if (!chatsLiberados.includes(numeroDoChefe)) {
            chatsLiberados.push(numeroDoChefe);
            salvarContatos(); 
            registrarLog(`Novo administrador atrelado: ${numeroDoChefe}`);
            if (mainWindow) mainWindow.webContents.send('atualizar-contatos', chatsLiberados);
          }
          client.sendText(numeroDoChefe, '✅ *Sistema Vinculado!*\nEste chat foi libertado e passará a receber as licitações aqui.');
        }
      });

      client.onPollResponse(async (res) => {
        try {
          const enqueteId = typeof res.msgId === 'object' ? res.msgId._serialized : res.msgId;

          if (votacoesAtivas[enqueteId]) {
              const dadosDaVotacao = votacoesAtivas[enqueteId];
              const pacoteDeDados = JSON.stringify(res.selectedOptions || res).toLowerCase();
              
              if (pacoteDeDados.includes('sim') || pacoteDeDados.includes('aceitar')) {
                  dadosDaVotacao.votoAtual = true;
              } else if (pacoteDeDados.includes('não') || pacoteDeDados.includes('recusar') || pacoteDeDados.includes('descartar')) {
                  dadosDaVotacao.votoAtual = false;
              } else { return; }

              if (!dadosDaVotacao.timerIniciado) {
                  dadosDaVotacao.timerIniciado = true;
                  salvarVotacoes();
                  registrarLog(`⏳ Clique recebido. Cronómetro de 1 minuto ativado para o Edital [${dadosDaVotacao.id_edital}]...`);
                  await client.sendText(dadosDaVotacao.numero, `⏳ *Voto Recebido - Edital ID: ${dadosDaVotacao.id_edital}*\nTem *1 minuto* caso deseje mudar a sua resposta antes do envio oficial.`);

                  setTimeout(async () => {
                      const votoFinal = votacoesAtivas[enqueteId].votoAtual;
                      registrarLog(`🔒 Tempo esgotado! Voto definitivo de ${dadosDaVotacao.numero} enviado.`);
                      await client.sendText(dadosDaVotacao.numero, `✅ *Votação Encerrada - Edital ID: ${dadosDaVotacao.id_edital}*\nA sua resposta definitiva foi encaminhada ao sistema.`);

                      const resposta = {
                          telefone: dadosDaVotacao.numero,
                          id_edital: dadosDaVotacao.id_edital,
                          aprovado: votoFinal
                      };

                      fetch('http://localhost:5000/resposta-edital', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(resposta)
                      }).then(() => {
                          registrarLog(`📤 [SUCESSO] Resposta do Edital ${dadosDaVotacao.id_edital} enviada para o C#.`);
                      }).catch(err => {
                          registrarLog(`❌ [ALERTA] Erro ao enviar resposta para o C#: ${err}`);
                      });

                      delete votacoesAtivas[enqueteId];
                      salvarVotacoes();

                  }, 60000);

              } else {
                  salvarVotacoes();
                  registrarLog(`[ALTERAÇÃO] ${dadosDaVotacao.numero} trocou o voto dentro do tempo.`);
              }
          }
        } catch (erro) { registrarLog(`Erro na enquete: ${erro.message}`); }
      });

    }).catch((error) => { registrarLog(`Erro WPPConnect: ${error.message}`); });
  }
}