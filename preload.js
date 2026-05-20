const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  receberLog: (callback) => ipcRenderer.on('novo-log', callback),
  receberQRCode: (callback) => ipcRenderer.on('exibir-qr', callback),
  reiniciarApp: () => ipcRenderer.send('reiniciar-app'),
  
  // --- CONTROLO DE ATUALIZAÇÃO AUTOMÁTICA ---
  receberVersao: (callback) => ipcRenderer.on('versao-app', callback), // NOVO
  receberAtualizandoAutomatico: (callback) => ipcRenderer.on('atualizando-automatico', callback), // NOVO
  receberAvisoAtualizacao: (callback) => ipcRenderer.on('atualizacao-pronta', callback),
  aplicarAtualizacao: () => ipcRenderer.send('aplicar-atualizacao'),
  
  // --- SISTEMA DE LICENÇA (DRM) ---
  receberPedidoChave: (callback) => ipcRenderer.on('pedir-chave', callback),
  enviarChave: (chaveDigitada) => ipcRenderer.send('validar-chave', chaveDigitada),
  receberChaveInvalida: (callback) => ipcRenderer.on('chave-invalida', callback),
  liberarAcesso: (callback) => ipcRenderer.on('liberar-tela-principal', callback),
  
  // --- WHATSAPP ---
  whatsappConectado: (callback) => ipcRenderer.on('whatsapp-conectado', callback),
  receberContatos: (callback) => ipcRenderer.on('atualizar-contatos', callback)
});