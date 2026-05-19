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
// 4. SISTEMA DE LICENÇA (O GUARDA DE TRÂNSITO)
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
// 5. O CÉREBRO DO ROBÔ
// ==========================================
function iniciarBotDeVerdade() {
  const userDataPath = app.getPath('userData');
  const ARQUIVO_LOG = path.join(userDataPath, 'log-zap.txt');
  const ARQUIVO_CONTATOS = path.join(userDataPath, 'contatos.json');
  
  let chatsLiberados = [];
  let votacoesAtivas = {}; // A gaveta temporária das enquetes

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
    const linhaLog = `[${new Date().toLocaleString('pt-BR')}] ${mensagem}`;
    console.log(linhaLog);
    fs.appendFileSync(ARQUIVO_LOG, linhaLog + '\n', 'utf8');
    if (mainWindow) mainWindow.webContents.send('novo-log', linhaLog);
  }

  registrarLog('Iniciando o cérebro do Bot...');

  // --- MOTOR .NET ---
  const caminhoDotNet = path.join(__dirname, 'assets/dotnet/MaestroCore.exe');
  if (fs.existsSync(caminhoDotNet)) {
    registrarLog('Dando a partida no motor .NET...');
    processoDotNet = spawn(caminhoDotNet);
    processoDotNet.stdout.on('data', (dados) => registrarLog(`[.NET]: ${dados.toString().trim()}`));
    processoDotNet.stderr.on('data', (erro) => registrarLog(`[ERRO .NET]: ${erro.toString().trim()}`));
  } else {
    registrarLog('Aviso: Arquivo do motor .NET não encontrado em assets/dotnet/');
  }

  // --- SERVIDOR API ---
  const server = express();
  server.use(express.json());

  server.post('/novo-edital', async (req, res) => {
    if (!clientInstance) return res.status(400).json({ erro: 'WhatsApp ainda não está conectado.' });
    if (chatsLiberados.length === 0) {
      registrarLog('Um edital chegou, mas nenhum chat foi liberado ainda!');
      return res.status(400).json({ erro: 'Nenhum administrador liberou o chat.' });
    }

    const edital = req.body; 
    // Garante que o edital tenha um ID único para o sistema identificar
    const idEdital = edital.id_edital || edital.id || Math.floor(Math.random() * 1000000).toString();

    const mensagemCompleta = `🚨 *NOVO EDITAL ENCONTRADO!* 🚨\n\n🆔 *ID:* ${idEdital}\n🏢 *Órgão:* ${edital.orgao}\n📍 *Local de Serviço:* ${edital.local}\n💰 *Valor Estimado:* ${edital.valor}\n\n📄 *Objeto:* ${edital.objeto}\n\n👉 *Deseja participar desta licitação?*`;

    try {
      for (const numero of chatsLiberados) {
        // Envia a licitação e guarda a referência da mensagem gerada
        const msgEnviada = await clientInstance.sendPollMessage(numero, mensagemCompleta, [
          '✅ Sim, tenho interesse',
          '❌ Não, pode descartar'
        ], { selectableCount: 1 });
        
        // Pega o ID único desta enquete específica
        const enqueteId = typeof msgEnviada.id === 'object' ? msgEnviada.id._serialized : msgEnviada.id;

        // Salva na memória, MAS NÃO INICIA O CRONÔMETRO AINDA! Fica aguardando o usuário.
        votacoesAtivas[enqueteId] = {
            numero: numero,
            id_edital: idEdital,
            votoAtual: null,
            timerIniciado: false // A flag que controla se os 60 segundos já começaram
        };

        registrarLog(`Edital [${idEdital}] enviado e aguardando decisão de ${numero}`);
      }
      res.status(200).json({ sucesso: true });
    } catch (erro) {
      registrarLog(`Erro ao enviar edital: ${erro.message}`);
      res.status(500).json({ erro: erro.message });
    }
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
        
        client.sendText(numeroDoChefe, '✅ *Sistema Vinculado!*\nEste chat foi liberado e você passará a receber os alertas de licitação aqui.');
      }
    });

    client.onPollResponse(async (res) => {
      try {
        const enqueteId = typeof res.msgId === 'object' ? res.msgId._serialized : res.msgId;

        // Verifica se essa enquete ainda está ativa na nossa memória
        if (votacoesAtivas[enqueteId]) {
            const dadosDaVotacao = votacoesAtivas[enqueteId];
            const pacoteDeDados = JSON.stringify(res.selectedOptions || res).toLowerCase();
            
            // Registra a alteração do voto temporariamente
            if (pacoteDeDados.includes('sim') || pacoteDeDados.includes('aceitar')) {
                dadosDaVotacao.votoAtual = true;
            } else if (pacoteDeDados.includes('não') || pacoteDeDados.includes('recusar') || pacoteDeDados.includes('descartar')) {
                dadosDaVotacao.votoAtual = false;
            } else {
                return; // Se ele desmarcou a opção (array vazio), a gente só ignora
            }

            // O GRANDE TRUQUE: Inicia os 60 segundos APENAS na PRIMEIRA vez que ele vota
            if (!dadosDaVotacao.timerIniciado) {
                dadosDaVotacao.timerIniciado = true;
                
                registrarLog(`⏳ Primeiro clique recebido do ${dadosDaVotacao.numero}. Iniciando cronômetro de 1 minuto para o Edital [${dadosDaVotacao.id_edital}]...`);
                await client.sendText(dadosDaVotacao.numero, `⏳ *Voto Recebido!*\nVocê tem *1 minuto* caso deseje mudar a sua resposta antes do envio oficial.`);

                // O cronômetro de 60 segundos (60000 milissegundos)
                setTimeout(async () => {
                    // Pega o voto final exato daquele momento
                    const votoFinal = votacoesAtivas[enqueteId].votoAtual;
                    registrarLog(`🔒 Tempo esgotado! Voto definitivo do ${dadosDaVotacao.numero} para o Edital [${dadosDaVotacao.id_edital}] foi: ${votoFinal ? 'ACEITO' : 'RECUSADO'}.`);

                    await client.sendText(dadosDaVotacao.numero, `✅ *Votação Encerrada!*\nSua resposta definitiva foi encaminhada ao sistema.`);

                    // Envia a resposta oficial para a porta 5000 do .NET
                    try {
                        await fetch('http://localhost:5000/resposta-edital', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                telefone: dadosDaVotacao.numero,
                                id_edital: dadosDaVotacao.id_edital,
                                aprovado: votoFinal
                            })
                        });
                    } catch (e) {
                        registrarLog(`[ALERTA] Falha ao comunicar o voto ao .NET: ${e.message}`);
                    }

                    // Exclui a enquete da memória para liberar espaço
                    delete votacoesAtivas[enqueteId];

                }, 60000);

            } else {
                // Se o timer já começou e ele mudou o voto de novo, a gente só avisa no painel
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