const wppconnect = require('@wppconnect-team/wppconnect');
const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json());

let clientInstance = null;

const { app } = require('electron');
const path = require('path');

// Pega o caminho do AppData do computador do cliente
const pastaDoApp = app.getPath('userData'); 

const ARQUIVO_CONTATOS = path.join(pastaDoApp, 'contatos.json');
const ARQUIVO_LOG = path.join(pastaDoApp, 'log-zap.txt');
const ARQUIVO_RESULTADOS = path.join(pastaDoApp, 'resultados.json');

function registrarLog(mensagem) {
  const dataHora = new Date().toLocaleString('pt-BR');
  const linhaLog = `[${dataHora}] ${mensagem}`;
  console.log(linhaLog);
  fs.appendFileSync(ARQUIVO_LOG, linhaLog + '\n', 'utf8');
}


// MEMÓRIA DE CHATS LIBERADOS E VOTAÇÕES
let chatsLiberados = [];

try {
  if (fs.existsSync(ARQUIVO_CONTATOS)) {
    chatsLiberados = JSON.parse(fs.readFileSync(ARQUIVO_CONTATOS, 'utf8'));
    registrarLog(`Memória carregada: ${chatsLiberados.length} contato(s).`);
  } else {
    fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify([]));
  }
} catch (erro) {
  registrarLog(`Erro na memória de contatos: ${erro.message}`);
}

function salvarContatos() {
  fs.writeFileSync(ARQUIVO_CONTATOS, JSON.stringify(chatsLiberados, null, 2));
}

// AGORA A CHAVE SERÁ O ID ÚNICO DA ENQUETE, NÃO MAIS O NÚMERO!
let votacoesAtivas = {};

if (!fs.existsSync(ARQUIVO_RESULTADOS)) {
  fs.writeFileSync(ARQUIVO_RESULTADOS, JSON.stringify([]));
}

function salvarResultadoDaLicitacao(numero, objeto, votoFinal) {
  const resultados = JSON.parse(fs.readFileSync(ARQUIVO_RESULTADOS, 'utf8'));
  resultados.push({
    data: new Date().toLocaleString('pt-BR'),
    numero: numero,
    licitacao: objeto,
    voto_final: votoFinal
  });
  fs.writeFileSync(ARQUIVO_RESULTADOS, JSON.stringify(resultados, null, 2));
}

// INICIANDO O WPPCONNECT
registrarLog('Iniciando WPPConnect...');

wppconnect
  .create({
    session: 'sessao-api-bot',
    catchQR: (base64Qr, asciiQR) => {
      console.log(asciiQR);
      registrarLog('Aguardando leitura do QR Code.');
    },
    headless: true,
  })
  .then((client) => {
    clientInstance = client;
    registrarLog('Bot conectado.');

    // 1. ESCUTANDO MENSAGENS TEXTUAIS ("Liberar Chat")
    client.onMessage(async (message) => {
      if (message.type === 'chat' && message.body && message.body.toLowerCase() === 'liberar chat') {
        const numeroDoCliente = message.from;
        registrarLog(`Mensagem "liberar chat" recebida de: ${numeroDoCliente}`);

        if (!chatsLiberados.includes(numeroDoCliente)) {
          chatsLiberados.push(numeroDoCliente);
          salvarContatos(); 
          registrarLog(`Novo cliente salvo: ${numeroDoCliente}`);
        }

        await client.sendText(numeroDoCliente, 'Chat liberado.');
      }
    });

    // 2. ESCUTANDO CLIQUES DA ENQUETE (BUSCANDO PELO ID DA MENSAGEM)
    client.onPollResponse(async (res) => {
      // Identifica a enquete exata que foi clicada
      const enqueteId = typeof res.msgId === 'object' ? res.msgId._serialized : res.msgId;
      
      console.log('\n--- 📡 RAIO-X DO VOTO ---');
      console.log(JSON.stringify(res, null, 2));
      console.log('-------------------------\n');
      
      // Procura na nossa memória se ESSA enquete específica ainda está ativa (dentro dos 30s)
      if (votacoesAtivas[enqueteId]) {
        const dadosDaVotacao = votacoesAtivas[enqueteId];
        const pacoteDeDados = JSON.stringify(res.selectedOptions || res).toLowerCase();
        
        if (pacoteDeDados.includes('recusar')) {
          dadosDaVotacao.votoAtual = 'recusar';
          registrarLog(`[VOTO] ${dadosDaVotacao.numero} marcou: ❌ Recusar na licitação "${dadosDaVotacao.licitacao}"`);
          
        } else if (pacoteDeDados.includes('aceitar')) {
          dadosDaVotacao.votoAtual = 'aceitar';
          registrarLog(`[VOTO] ${dadosDaVotacao.numero} marcou: ✅ Aceitar na licitação "${dadosDaVotacao.licitacao}"`);
          
        } else {
          dadosDaVotacao.votoAtual = null;
          registrarLog(`[VOTO] ${dadosDaVotacao.numero} desmarcou o voto na licitação "${dadosDaVotacao.licitacao}"`);
        }
      }
    });

  })
  .catch((error) => {
    registrarLog(`Erro ao iniciar: ${error.message}`);
  });

// ROTA DA API (DISPARO E CRONÔMETRO ISOLADO POR MENSAGEM)
app.post('/liberar-chat', async (req, res) => {
  const { objeto, valor_total, localidade } = req.body;

  if (!clientInstance) return res.status(503).json({ erro: 'Bot não conectado.' });
  if (chatsLiberados.length === 0) return res.status(400).json({ erro: 'Nenhum contato disponível.' });

  try {
    registrarLog(`Iniciando disparo para licitação: ${objeto}`);
    const textoProposta = `*LICITAÇÃO*\n\n*Objeto:* ${objeto}\n*Valor Estimado:* ${valor_total}\n*Localidade:* ${localidade}`;

    for (const numero of chatsLiberados) {
      await clientInstance.sendText(numero, textoProposta);
      
      // Dispara a enquete e guarda o resultado do envio
      const msgEnviada = await clientInstance.sendPollMessage(
        numero, 
        'Você tem 30 segundos para votar:', 
        ['✅ Aceitar', '❌ Recusar'], 
        { selectableCount: 1 }
      );

      // Extrai o ID único da mensagem que acabou de ser enviada
      const enqueteId = typeof msgEnviada.id === 'object' ? msgEnviada.id._serialized : msgEnviada.id;

      // Salva a votação usando o ID da mensagem como gaveta
      votacoesAtivas[enqueteId] = {
        numero: numero,
        licitacao: objeto,
        votoAtual: null
      };

      // CRONÔMETRO DE 30 SEGUNDOS INDIVIDUAL PARA ESTA ENQUETE
      setTimeout(async () => {
        const dados = votacoesAtivas[enqueteId];
        
        if (dados) {
          const votoFinal = dados.votoAtual; 

          if (votoFinal === 'aceitar') {
            salvarResultadoDaLicitacao(dados.numero, dados.licitacao, "Aceitou");
            await clientInstance.sendText(dados.numero, `Tempo esgotado. Aceite registrado para a licitação: ${dados.licitacao}.`);
            registrarLog(`Fechado. ${dados.numero} ACEITOU a licitação ${dados.licitacao}.`);
            
          } else if (votoFinal === 'recusar') {
            salvarResultadoDaLicitacao(dados.numero, dados.licitacao, "Recusou");
            await clientInstance.sendText(dados.numero, `Tempo esgotado. Recusa registrada para a licitação: ${dados.licitacao}.`);
            registrarLog(`Fechado. ${dados.numero} RECUSOU a licitação ${dados.licitacao}.`);
            
          } else {
            salvarResultadoDaLicitacao(dados.numero, dados.licitacao, "Não votou");
            await clientInstance.sendText(dados.numero, `Tempo esgotado. Nenhum voto registrado para a licitação: ${dados.licitacao}.`);
            registrarLog(`Fechado. ${dados.numero} IGNOROU a licitação ${dados.licitacao}.`);
          }

          // Apaga a gaveta específica desta enquete
          delete votacoesAtivas[enqueteId];
        }
      }, 30000); 
    }

    res.status(200).json({ sucesso: true, mensagem: `Disparo concluído.` });

  } catch (error) {
    registrarLog(`Erro no disparo: ${error.message}`);
    res.status(500).json({ erro: 'Falha ao enviar.' });
  }
});

const PORTA = 3000;
app.listen(PORTA, () => {
  registrarLog(`API rodando na porta ${PORTA}`);
});