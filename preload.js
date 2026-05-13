const { contextBridge, ipcRenderer } = require('electron');

// Expõe uma API segura para o mundo do Front-end (HTML)
contextBridge.exposeInMainWorld('api', {
  
  // Escuta os textos de log vindos do Node.js
  receberLog: (callback) => ipcRenderer.on('novo-log', callback),
  
  // Escuta o aviso invisível de que o Auto-Update terminou de baixar
  receberAvisoAtualizacao: (callback) => ipcRenderer.on('atualizacao-pronta', callback),
  
  // Envia a ordem do botão HTML para o Node.js fechar o app e atualizar
  aplicarAtualizacao: () => ipcRenderer.send('aplicar-atualizacao'),
  
  // Escuta a imagem Base64 do QR Code gerado pelo WPPConnect
  receberQRCode: (callback) => ipcRenderer.on('exibir-qr', callback)
  
});
