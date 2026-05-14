const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const https = require('https'); // <-- Adicionado aqui no topo!

let mainWindow;
let clientInstance = null;
let tray = null;

// ==========================================
// 1. CONFIGURAÇÕES DA MÁQUINA E LICENÇA
// ==========================================
let hwidAtual;
try {
  hwidAtual = machineIdSync(true); 
} catch (e) {
  hwidAtual = 'DESCONHECIDO';
}

// ⚠️ COLOQUE O LINK DO SEU DISCORD AQUI ⚠️
const WEBHOOK_DISCORD = 'https://discord.com/api/webhooks/1504491496668401924/TE9n3p4KYWlX2mPDAfXuzaw4Kvd2PZZ0yxytfzHYerbvrXKOqWbOTjcHvGdzxx8zb4B4';

// ==========================================
// 2. CONFIGURAÇÃO DA JANELA E AUTO-UPDATE
// ==========================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/maestro-licita.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');
  // mainWindow.webContents.openDevTools();

  // BLOQUEADOR DO BOTÃO X
  mainWindow.on('close', function (event) {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  autoUpdater.checkForUpdatesAndNotify();
}

autoUpdater.on('update-downloaded', () => {
  if (mainWindow) mainWindow.webContents.send('atualizacao-pronta');
});

ipcMain.on('aplicar-atualizacao', () => {
  autoUpdater.quitAndInstall();
});

// ==========================================
// 3. INICIALIZAÇÃO DO SISTEMA
// ==========================================
app.whenReady().then(() => {
  createWindow();

  // --- CONFIGURANDO A BANDEJA (TRAY) ---
  const iconPath = path.join(__dirname, 'assets/maestro-licita.ico');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Abrir Painel do Bot', 
      click: function () { mainWindow.show(); } 
    },
    { type: 'separator' },
    { 
      label: 'Encerrar Robô Completamente', 
      click: function () {
        app.isQuiting = true; 
        app.quit(); 
      } 
    }
  ]);
  
  tray.setToolTip('Maestro Licitações - Rodando');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); });

  // --- CHAMA O GUARDA DE TRÂNSITO (DRM) ---
  gerenciarLicenca();
});

// ==========================================
// 4. SISTEMA DE LICENÇA (O GUARDA DE TRÂNSITO)
// ==========================================
function gerenciarLicenca() {
  const userDataPath = app.getPath('userData');
  const ARQUIVO_LICENCA = path.join(userDataPath, 'licenca.json');

  // 1. Verifica se já existe licença ativa
  if (fs.existsSync(ARQUIVO_LICENCA)) {
    const licencaSalva = JSON.parse(fs.readFileSync(ARQUIVO_LICENCA, 'utf8'));
    if (licencaSalva.hwid === hwidAtual && licencaSalva.status === 'ativo') {
      console.log('Licença confirmada!');
      mainWindow.webContents.send('liberar-tela-principal');
      iniciarBotDeVerdade();
      return; 
    }
  }

  // 2. Se não tem licença, gera a chave
  const novaChave = crypto.randomBytes(4).toString('hex').toUpperCase(); 

  // Prepara a mensagem pro Discord
  const dados = JSON.stringify({ 
    content: `🚨 **Novo Acesso Detectado!**\n💻 HWID: \`${hwidAtual}\`\n🔑 Chave para o cliente: \`${novaChave}\`` 
  });

  // Dispara a mensagem com o HTTPS raiz (À prova de falhas)
  const req = https.request(WEBHOOK_DISCORD, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(dados)
    }
  }, (res) => {
    console.log(`Status do envio pro Discord: ${res.statusCode}`);
  });

  req.on('error', (erro) => {
    console.log('O Firewall/Rede bloqueou o envio! Erro exato:', erro.message);
  });

  req.write(dados);
  req.end();

  // Trava a tela pedindo a chave
  mainWindow.webContents.send('pedir-chave', novaChave);

  // Escuta a tentativa do cliente
  ipcMain.once('validar-chave', (event, chaveDigitada) => {
    if (chaveDigitada === novaChave) {
      // Salva a chave para nunca mais pedir
      fs.writeFileSync(ARQUIVO_LICENCA, JSON.stringify({
        token: novaChave, hwid: hwidAtual, status: 'ativo'
      }, null, 2));

      mainWindow.webContents.send('liberar-tela-principal');
      iniciarBotDeVerdade();
    } else {
      mainWindow.webContents.send('chave-invalida');
    }
  });
}

// ==========================================
// 5. O SEU BOT DE LICITAÇÕES (EXPRESS + WPPCONNECT)
// ==========================================
function iniciarBotDeVerdade() {
  const userDataPath = app.getPath('userData');
  const ARQUIVO_LOG = path.join(userDataPath, 'log-zap.txt');

  function registrarLog(mensagem) {
    const linhaLog = `[${new Date().toLocaleString('pt-BR')}] ${mensagem}`;
    console.log(linhaLog);
    fs.appendFileSync(ARQUIVO_LOG, linhaLog + '\n', 'utf8');
    if (mainWindow) mainWindow.webContents.send('novo-log', linhaLog);
  }

  registrarLog('Iniciando o cérebro do Bot...');

  // --- API EXPRESS ---
  const server = express();
  server.use(express.json());

  server.post('/liberar-chat', async (req, res) => {
    res.status(200).json({ sucesso: true });
  });

  server.listen(3000, () => {
    registrarLog(`API Local rodando na porta 3000`);
  });

  // --- WPPCONNECT ---
  wppconnect.create({
    session: 'sessao-api-bot',
    headless: true,
    catchQR: (base64Qr, asciiQR) => {
      registrarLog('QR Code gerado! Aguardando o cliente escanear...');
      if (mainWindow) mainWindow.webContents.send('exibir-qr', base64Qr);
    }
  }).then((client) => {
    clientInstance = client;
    registrarLog('WhatsApp Conectado com sucesso!');
  }).catch((error) => {
    registrarLog(`Erro WPPConnect: ${error.message}`);
  });
}