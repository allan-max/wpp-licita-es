const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');
const https = require('https'); 
const http = require('http'); // 👈 ADICIONADO PARA GARANTIR COMPATIBILIDADE MÁXIMA
const { spawn } = require('child_process'); 

let mainWindow;
let clientInstance = null;
let tray = null;
let processoDotNet = null;

// ==========================================
// 1. CONFIGURAÇÕES DA MÁQUINA E LICENÇA
// ==========================================
let hwidAtual;
try {
  hwidAtual = machineIdSync(true); 
} catch (e) {
  hwidAtual = 'DESCONHECIDO';
}

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

  mainWindow.on('close', function (event) {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  autoUpdater.checkForUpdatesAndNotify();
}

const logUpdate = (msg) => {
  const logPath = path.join(app.getPath('userData'), 'log-atualizacao.txt');
  fs.appendFileSync(logPath, `[${new Date().toLocaleString()}] ${msg}\n`);
};

autoUpdater.on('checking-for-update', () => logUpdate('Buscando atualizações no GitHub...'));
autoUpdater.on('update-available', (info) => logUpdate(`Atualização ${info.version} encontrada! Começando o download...`));
autoUpdater.on('update-not-available', (info) => logUpdate(`Nenhuma atualização. Versão da nuvem: ${info.version}`));
autoUpdater.on('error', (err) => logUpdate(`ERRO NA ATUALIZAÇÃO: ${err.message}`));
autoUpdater.on('download-progress', (progressObj) => {
  logUpdate(`Baixando atualização: ${Math.round(progressObj.percent)}%`);
});

autoUpdater.on('update-downloaded', () => {
  logUpdate('Download 100% concluído! Avisando o HTML para mostrar o botão verde.');
  if (mainWindow) mainWindow.webContents.send('atualizacao-pronta');
});

ipcMain.on('aplicar-atualizacao', () => {
  logUpdate('O usuário clicou no botão verde. Fechando e instalando...');
  autoUpdater.quitAndInstall();
});

// ==========================================
// 3. INICIALIZAÇÃO DO SISTEMA
// ==========================================
app.whenReady().then(() => {
  createWindow();

  ipcMain.on('reiniciar-app', () => {
    if (processoDotNet) processoDotNet.kill(); 
    app.relaunch(); 
    app.quit();     
  });

  const iconPath = path.join(__dirname, 'assets/maestro-licita.ico');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Abrir Painel do Bot', click: function () { mainWindow.show(); } },
    { type: 'separator' },
    { 
      label: 'Encerrar Robô Completamente', 
      click: function () {
        app.isQuiting = true; 
        if (processoDotNet) processoDotNet.kill();
        app.quit(); 
      } 
    }
  ]);
  
  tray.setToolTip('Maestro Licitações - Rodando');
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
      console.log('Licença confirmada!');
      mainWindow.webContents.send('liberar-tela-principal');
      iniciarBotDeVerdade();
      return; 
    }
  }

  const novaChave = crypto.randomBytes(4).toString('hex').toUpperCase(); 

  const dados = JSON.stringify({ 
    content: `🚨 **Novo Acesso Detectado!**\n💻 HWID: \`${hwidAtual}\`\n🔑 Chave para o cliente: \`${novaChave}\`` 
  });

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

  mainWindow.webContents.send('pedir-chave', novaChave);

  ipcMain.once('validar-chave', (event, chaveDigitada) => {
    if (chaveDigitada === novaChave) {
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
// 5. O CÉREBRO DO ROBÔ & COMUNICAÇÃO MÃO DUPLA
// ==========================================
function iniciarBotDeVerdade() {
  const userDataPath = app.getPath('userData');
  const ARQUIVO_LOG = path.join(userDataPath, 'log-zap.txt');
  const ARQUIVO_CONTATOS = path.join(userDataPath, 'contatos.json');
  
  let chatsLiberados = [];
  let votacoesAtivas = {}; 

  try {
    if (fs.existsSync(ARQUIVO_CONTATOS)) {
      chatsLiberados = JSON.parse(fs.readFileSync(ARQUIVO_CONTATOS, 'utf8'));
    } else {
      fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify([]));
    }
  } catch (erro) {
    console.log(`Erro ao ler memória de contatos: ${erro.message}`);
  }

  function salvarContatos() {
    fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify(chatsLiberados, null, 2));
  }

  function registrarLog(mensagem) {
    const linhaLog = `[${new Date().toLocaleString('pt-PT')}] ${mensagem}`;
    console.log(linhaLog);
    fs.appendFileSync(ARQUIVO_LOG, linhaLog + '\n', 'utf8');
    if (mainWindow) mainWindow.webContents.send('novo-log', linhaLog);
  }

  registrarLog('A iniciar o cérebro do Bot...');

  // --- SERVIDOR API (NODE.JS) ---
  const server = express();
  server.use(express.json());

  // Rota raiz para responder caso o .NET decida checar o Node
  server.get('/', (req, res) => {
    res.status(200).send('Maestro Node.js Online!');
  });

  // Rota para receber editais vindo do .NET
  server.post('/novo-edital', async (req, res) => {
    if (!clientInstance) return res.status(400).json({ erro: 'WhatsApp ainda não está conectado.' });
    if (chatsLiberados.length === 0) {
      registrarLog('Um edital chegou, mas nenhum chat foi libertado ainda!');
      return res.status(400).json({ erro: 'Nenhum administrador libertou o chat.' });
    }

    const edital = req.body; 
    const idEdital = edital.id_edital || edital.id || Math.floor(Math.random() * 1000000).toString();

    const mensagemCompleta = `🚨 *NOVO EDITAL ENCONTRADO!* 🚨\n\n🆔 *ID:* ${idEdital}\n🏢 *Órgão:* ${edital.orgao}\n📍 *Local de Serviço:* ${edital.local}\n💰 *Valor Estimado:* ${edital.valor}\n\n📄 *Objeto:* ${edital.objeto}\n\n👉 *Deseja participar desta licitação?*`;

    try {
      for (const numero of chatsLiberados) {
        const msgEnviada = await clientInstance.sendPollMessage(numero, mensagemCompleta, [
          '✅ Sim, tenho interesse',
          '❌ Não, pode descartar'
        ], { selectableCount: 1 });
        
        const enqueteId = typeof msgEnviada.id === 'object' ? msgEnviada.id._serialized : msgEnviada.id;

        votacoesAtivas[enqueteId] = {
            numero: numero,
            id_edital: idEdital,
            votoAtual: null,
            timerIniciado: false 
        };

        registrarLog(`Edital [${idEdital}] enviado e a aguardar decisão de ${numero}`);
      }
      res.status(200).json({ sucesso: true });
    } catch (erro) {
      registrarLog(`Erro ao enviar edital: ${erro.message}`);
      res.status(500).json({ erro: erro.message });
    }
  });

  // 👇 FORÇAMOS O IP '127.0.0.1' PARA RESOLVER O CONFLITO IPv4 vs IPv6
  server.listen(3000, '127.0.0.1', () => {
    registrarLog(`API Local a correr com sucesso em http://127.0.0.1:3000`);

    const caminhoDotNet = app.isPackaged 
        ? path.join(process.resourcesPath, 'publish', 'Welington II.exe')
        : path.join(__dirname, 'assets', 'publish', 'Welington II.exe');

    if (fs.existsSync(caminhoDotNet)) {
      registrarLog('A dar a partida no motor .NET (Welington II)...');
      processoDotNet = spawn(caminhoDotNet);
      
      processoDotNet.stdout.on('data', (dados) => registrarLog(`[.NET]: ${dados.toString().trim()}`));
      processoDotNet.stderr.on('data', (erro) => registrarLog(`[ERRO .NET]: ${erro.toString().trim()}`));

      // 👇 SUBSTITUÍMOS O FETCH PELO CÓDIGO NATIVO DO NODE.JS
      function mandarCheckParaDotNet() {
        http.get('http://127.0.0.1:5000/', (resNet) => {
            registrarLog('🟢 Aperto de mão estabelecido! O .NET respondeu ao Check do Node.');
        }).on('error', (e) => {
            // Se o .NET ainda estiver a ligar e der erro, tenta de novo em 1.5 segundos
            setTimeout(mandarCheckParaDotNet, 1500);
        });
      }
      
      setTimeout(mandarCheckParaDotNet, 2000);

    } else {
      registrarLog(`Aviso: Ficheiro do motor .NET não encontrado em: ${caminhoDotNet}`);
    }
  });

  // --- WPPCONNECT (WHATSAPP) ---
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
          registrarLog(`Novo administrador atrelado ao número: ${numeroDoChefe}`);
          
          if (mainWindow) mainWindow.webContents.send('atualizar-contatos', chatsLiberados);
        }
        
        client.sendText(numeroDoChefe, '✅ *Sistema Vinculado!*\nEste chat foi libertado e passará a receber os alertas de licitação aqui.');
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
            } else {
                return; 
            }

            if (!dadosDaVotacao.timerIniciado) {
                dadosDaVotacao.timerIniciado = true;
                
                registrarLog(`⏳ Primeiro clique recebido de ${dadosDaVotacao.numero}. Cronómetro de 1 minuto ativado para o Edital [${dadosDaVotacao.id_edital}]...`);
                await client.sendText(dadosDaVotacao.numero, `⏳ *Voto Recebido!*\nTem *1 minuto* caso deseje mudar a sua resposta antes do envio oficial.`);

                setTimeout(async () => {
                    const votoFinal = votacoesAtivas[enqueteId].votoAtual;
                    registrarLog(`🔒 Tempo esgotado! Voto definitivo de ${dadosDaVotacao.numero} para o Edital [${dadosDaVotacao.id_edital}] foi enviado.`);

                    await client.sendText(dadosDaVotacao.numero, `✅ *Votação Encerrada!*\nA sua resposta definitiva foi encaminhada ao sistema.`);

                    // 👇 ENVIAR O VOTO AO .NET DE FORMA NATIVA E SEGURA (Bypass do fetch)
                    try {
                        const payload = JSON.stringify({
                            telefone: dadosDaVotacao.numero,
                            id_edital: dadosDaVotacao.id_edital,
                            aprovado: votoFinal
                        });

                        const reqNet = http.request({
                            hostname: '127.0.0.1',
                            port: 5000,
                            path: '/resposta-edital',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(payload)
                            }
                        }, (resNet) => {
                            registrarLog(`[SUCESSO] O .NET recebeu o voto com status: ${resNet.statusCode}`);
                        });

                        reqNet.on('error', (e) => registrarLog(`[ALERTA] Falha ao comunicar o voto ao .NET: ${e.message}`));
                        reqNet.write(payload);
                        reqNet.end();

                    } catch (e) {
                        registrarLog(`[ALERTA] Erro interno ao enviar voto: ${e.message}`);
                    }

                    delete votacoesAtivas[enqueteId];

                }, 60000);

            } else {
                registrarLog(`[ALTERAÇÃO] ${dadosDaVotacao.numero} trocou o voto para ${dadosDaVotacao.votoAtual ? 'SIM' : 'NÃO'} dentro do tempo.`);
            }
        }
      } catch (erro) {
        registrarLog(`Erro ao processar clique na enquete: ${erro.message}`);
      }
    });

  }).catch((error) => {
    registrarLog(`Erro WPPConnect: ${error.message}`);
  });
}