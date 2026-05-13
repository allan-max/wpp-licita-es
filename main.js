const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');

let mainWindow;
let clientInstance = null;

// CONFIGURAÇÕES DO ELECTRON E AUTO-UPDATE
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    autoHideMenuBar: true, // Esconde o menu superior estilo Windows antigo
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');

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
    headless: true, // Muito importante continuar true
    // Opcional: folderNameToken: path.join(userDataPath, 'tokens') // Para salvar a sessão no AppData
  }).then((client) => {
    clientInstance = client;
    registrarLog('WhatsApp Conectado com sucesso!');
    // ... (Cole seus escutadores onMessage e onPollResponse aqui)
  }).catch((error) => {
    registrarLog(`Erro WPPConnect: ${error.message}`);
  });
});