const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const https = require('https'); 
const { spawn } = require('child_process'); 

let mainWindow;
let clientInstance = null;
let tray = null;
let processoDotNet = null;

// 1. CONFIGURAÇÕES DA MÁQUINA E LICENÇA
let hwidAtual;
try {
  hwidAtual = machineIdSync(true); 
} catch (e) {
  hwidAtual = 'DESCONHECIDO';
}

// ⚠️ COLOQUE O LINK DO SEU DISCORD AQUI ⚠️
const WEBHOOK_DISCORD = 'https://discord.com/api/webhooks/1504491496668401924/TE9n3p4KYWlX2mPDAfXuzaw4Kvd2PZZ0yxytfzHYerbvrXKOqWbOTjcHvGdzxx8zb4B4';

// 2. CONFIGURAÇÃO DA JANELA E AUTO-UPDATE
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
  //mainWindow.webContents.openDevTools();

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

// 3. INICIALIZAÇÃO DO SISTEMA
app.whenReady().then(() => {
  createWindow();

ipcMain.on('reiniciar-app', () => {
  if (processoDotNet) processoDotNet.kill(); // Derruba o C# por segurança
  app.relaunch(); // Prepara o app para abrir de novo
  app.quit();     // Fecha o app atual
});

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
        
        // MATANDO O PROCESSO .NET COM SEGURANÇA
        if (processoDotNet) {
            processoDotNet.kill();
        }

        app.quit(); 
      } 
    }
  ]);
  
  tray.setToolTip('Maestro Licitações - Rodando');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); });

  // --- CHAMA O GUARDA DE TRÂNSITO (DRM) APENAS QUANDO O HTML CARREGAR ---
  mainWindow.webContents.once('did-finish-load', () => {
    gerenciarLicenca();
  });
});

// 4. SISTEMA DE LICENÇA (O GUARDA DE TRÂNSITO)
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

  // Variável que vai guardar o número do dono do robô
  let numeroDoChefe = null; 

  // INICIANDO O MOTOR .NET (C#) EM SEGUNDO PLANO
  const caminhoDotNet = path.join(__dirname, 'assets/dotnet/MaestroCore.exe');
  
  if (fs.existsSync(caminhoDotNet)) {
    registrarLog('Dando a partida no motor .NET...');
    
    // Inicia o .exe de forma invisível
    processoDotNet = spawn(caminhoDotNet);

    // Escuta o que o C# "falar" no terminal e joga no seu HTML!
    processoDotNet.stdout.on('data', (dados) => {
      registrarLog(`[.NET]: ${dados.toString().trim()}`);
    });

    processoDotNet.stderr.on('data', (erro) => {
      registrarLog(`[ERRO .NET]: ${erro.toString().trim()}`);
    });
  } else {
    registrarLog('Aviso: Arquivo do motor .NET não encontrado em assets/dotnet/');
  }

  // API EXPRESS (A porta onde o .NET vai bater)
  const server = express();
  server.use(express.json());

  // Rota que o .NET vai chamar quando achar uma licitação
  server.post('/novo-edital', async (req, res) => {
    if (!clientInstance) {
      return res.status(400).json({ erro: 'WhatsApp ainda não está conectado.' });
    }
    if (!numeroDoChefe) {
      registrarLog('Um edital chegou, mas nenhum chat foi liberado ainda!');
      return res.status(400).json({ erro: 'Nenhum administrador liberou o chat.' });
    }

    // Pega os dados que o .NET enviou
    const edital = req.body; 
    
    // Formata o Card Visual
    const mensagemDetalhes = `🚨 *NOVO EDITAL ENCONTRADO!* 🚨\n\n` +
      `🏢 *Órgão:* ${edital.orgao}\n` +
      `📍 *Local de Serviço:* ${edital.local}\n` +
      `💰 *Valor Estimado:* ${edital.valor}\n\n` +
      `📄 *Objeto:* ${edital.objeto}`;

    try {
      // 1. Envia o texto
      await clientInstance.sendText(numeroDoChefe, mensagemDetalhes);
      
      // 2. Envia a Enquete
      await clientInstance.sendPollMessage(numeroDoChefe, 'Deseja participar desta licitação?', [
        '✅ Sim, tenho interesse',
        '❌ Não, pode descartar'
      ], { selectableCount: 1 });
      
      registrarLog(`Edital enviado com sucesso para ${numeroDoChefe}`);
      res.status(200).json({ sucesso: true });
    } catch (erro) {
      registrarLog(`Erro ao enviar edital: ${erro.message}`);
      res.status(500).json({ erro: erro.message });
    }
  });

  server.listen(3000, () => {
    registrarLog(`API Local rodando na porta 3000`);
  });

  // WPPCONNECT (O Motor do WhatsApp)
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

    // 1. O "OUVIDO" DE TEXTO: Lendo "liberar chat"
    client.onMessage((message) => {
      if (!message.isGroupMsg && message.body.toLowerCase() === 'liberar chat') {
        numeroDoChefe = message.from; 
        client.sendText(message.from, '✅ *Sistema Vinculado!*\nEste chat foi liberado e você passará a receber os alertas de licitação aqui.');
        registrarLog(`Novo administrador atrelado ao número: ${message.from}`);
      }
    });

    // 2. A VIA DE VOLTA: Escutando a votação e enviando para o .NET
    client.onPollResponse(async (res) => {
      try {
        const pacoteDeDados = JSON.stringify(res.selectedOptions || res).toLowerCase();
        let foiAceito = false;

        if (pacoteDeDados.includes('aceitar') || pacoteDeDados.includes('sim')) {
          foiAceito = true;
          registrarLog(`[VOTO] Cliente ACEITOU a licitação! Avisando o motor .NET...`);
        } else if (pacoteDeDados.includes('recusar') || pacoteDeDados.includes('não')) {
          foiAceito = false;
          registrarLog(`[VOTO] Cliente RECUSOU a licitação.`);
        } else {
          return; // Se desmarcou, não faz nada
        }

        // Bate na porta do C# (5000) avisando da decisão
        await fetch('http://localhost:5000/resposta-edital', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telefone: res.sender,
            aprovado: foiAceito
          })
        });

      } catch (erro) {
        registrarLog(`Erro ao enviar decisão para o .NET: ${erro.message}`);
      }
    });

  }).catch((error) => {
    registrarLog(`Erro WPPConnect: ${error.message}`);
  });
}
