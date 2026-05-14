const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');

let mainWindow;
let clientInstance = null;
let tray = null;

// CONFIGURAÇÕES DO ELECTRON E AUTO-UPDATE
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    autoHideMenuBar: true, // Esconde o menu superior estilo Windows antigo
    icon: path.join(__dirname, 'assets/maestro-licita.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
      
    }
    
  });

 mainWindow.loadFile('index.html');
 // mainWindow.webContents.openDevTools(); para abrir o DevTools na tela

  // BLOQUEADOR DO BOTÃO X
  mainWindow.on('close', function (event) {
    if (!app.isQuiting) {
      event.preventDefault(); // Impede de fechar
      mainWindow.hide();      // Apenas esconde a janela
    }
    return false;
  });

  // Checa se tem atualização no GitHub silenciosamente
  autoUpdater.checkForUpdatesAndNotify();
}

// Escuta eventos do Auto-Updater
autoUpdater.on('update-downloaded', () => {
  if (mainWindow) mainWindow.webContents.send('atualizacao-pronta');
});

ipcMain.on('aplicar-atualizacao', () => {
  autoUpdater.quitAndInstall();
});

// ADAPTAÇÃO DO SEU CÓDIGO NODE.JS
app.whenReady().then(() => {
  createWindow();

  const iconPath = path.join(__dirname, 'assets/maestro-licita.ico');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Abrir Painel do Bot', 
      click: function () {
        mainWindow.show(); 
      } 
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

  tray.setToolTip('Bot de Licitações - Rodando');
  tray.setContextMenu(contextMenu);

  // Se o cliente der dois cliques com o botão esquerdo no ícone, a tela abre
  tray.on('double-click', () => {
    mainWindow.show();
  });

  // GARANTE QUE OS ARQUIVOS VÃO PARA A PASTA CORRETA (AppData)
  const userDataPath = app.getPath('userData');
  const ARQUIVO_CONTATOS = path.join(userDataPath, 'contatos.json');
  const ARQUIVO_LOG = path.join(userDataPath, 'log-zap.txt');
  const ARQUIVO_RESULTADOS = path.join(userDataPath, 'resultados.json');

  // Função adaptada para mandar o log para a interface também
  function registrarLog(mensagem) {
    const dataHora = new Date().toLocaleString('pt-BR');
    const linhaLog = `[${dataHora}] ${mensagem}`;
    console.log(linhaLog);
    fs.appendFileSync(ARQUIVO_LOG, linhaLog + '\n', 'utf8');
    
    // Manda o texto para a tela do HTML!
    if (mainWindow) mainWindow.webContents.send('novo-log', linhaLog);
  }

  // --- O RESTO DO SEU CÓDIGO CONTINUA IGUAL AQUI ---
  let chatsLiberados = [];
  try {
    if (fs.existsSync(ARQUIVO_CONTATOS)) {
      chatsLiberados = JSON.parse(fs.readFileSync(ARQUIVO_CONTATOS, 'utf8'));
      registrarLog(`Memória carregada: ${chatsLiberados.length} contato(s).`);
    } else {
      fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify([]));
    }
  } catch (erro) {
    registrarLog(`Erro na memória: ${erro.message}`);
  }

  function salvarContatos() { fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify(chatsLiberados, null, 2)); }
  
  let votacoesAtivas = {};
  if (!fs.existsSync(ARQUIVO_RESULTADOS)) fs.writeFileSync(ARQUIVO_RESULTADOS, JSON.stringify([]));

  // Iniciando Express
  const server = express();
  server.use(express.json());

  server.post('/liberar-chat', async (req, res) => {
    // ... (Cole sua rota de disparo aqui exatamente como era)
    registrarLog(`Recebido POST: ${req.body.objeto}`);
    res.status(200).json({ sucesso: true, mensagem: `Disparo simulado.` });
  });

  server.listen(3000, () => {
    registrarLog(`API Local rodando na porta 3000`);
  });

  // Iniciando WPPConnect
  wppconnect.create({
    session: 'sessao-api-bot',
    headless: true,
    catchQR: (base64Qr, asciiQR) => {
      registrarLog('QR Code gerado! Aguardando o cliente escanear...');
      // Envia a imagem Base64 do Node.js para o Front-end (HTML)
      if (mainWindow) mainWindow.webContents.send('exibir-qr', base64Qr);
    }
  }).then((client) => {
    clientInstance = client;
    registrarLog('WhatsApp Conectado com sucesso!');
    // ... (Cole seus escutadores onMessage e onPollResponse aqui)
  }).catch((error) => {
    registrarLog(`Erro WPPConnect: ${error.message}`);
  });
});