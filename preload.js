const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  receberLog: (callback) => ipcRenderer.on('novo-log', callback),
  receberAvisoAtualizacao: (callback) => ipcRenderer.on('atualizacao-pronta', callback),
  aplicarAtualizacao: () => ipcRenderer.send('aplicar-atualizacao'),
  receberQRCode: (callback) => ipcRenderer.on('exibir-qr', callback),
  
  // NOVOS CANAIS DO SISTEMA DE LICENÇA (DRM)
  receberPedidoChave: (callback) => ipcRenderer.on('pedir-chave', callback),
  enviarChave: (chaveDigitada) => ipcRenderer.send('validar-chave', chaveDigitada),
  receberChaveInvalida: (callback) => ipcRenderer.on('chave-invalida', callback),
  liberarAcesso: (callback) => ipcRenderer.on('liberar-tela-principal', callback),
  
  whatsappConectado: (callback) => ipcRenderer.on('whatsapp-conectado', callback),
  
  // NOVA LINHA PARA RECEBER OS CONTATOS
  receberContatos: (callback) => ipcRenderer.on('atualizar-contatos', callback),

  // COMANDO PARA REINICIAR TUDO
  reiniciarApp: () => ipcRenderer.send('reiniciar-app')
});