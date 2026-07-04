const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on('sparky:' + channel, listener);
  return () => ipcRenderer.removeListener('sparky:' + channel, listener);
};

contextBridge.exposeInMainWorld('sparky', {
  getSecret: () => ipcRenderer.invoke('session:secret'),
  runTool: (name, args) => ipcRenderer.invoke('tool:run', { name, args }),
  wakeTranscribe: (arrayBuffer) => ipcRenderer.invoke('wake:transcribe', new Uint8Array(arrayBuffer)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  initState: () => ipcRenderer.invoke('state:init'),
  planControl: (msg) => ipcRenderer.invoke('plan:control', msg),
  wmCorrect: (beliefs) => ipcRenderer.invoke('wm:correct', { beliefs }),
  confirmResolve: (id, approved) => ipcRenderer.invoke('confirm:resolve', { id, approved }),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  pickFiles: () => ipcRenderer.invoke('file:pick'),
  injectDelivered: (id) => ipcRenderer.send('inject:delivered', { id }),
  sessionEnded: (lines) => ipcRenderer.send('session:ended', { lines }),
  clearClipboard: () => ipcRenderer.invoke('clipboard:clear'),

  onArtifact: on('artifact'),
  onPlan: on('plan'),
  onWorkingMemory: on('working_memory'),
  onMood: on('mood'),
  onMode: on('mode'),
  onLog: on('log'),
  onLogAppend: on('log_append'),
  onToggleMic: on('toggle_mic'),
  onMic: on('mic'),
  onTimers: on('timers'),
  onInject: on('inject'),
  onConfirm: on('confirm'),
  onConfirmResolved: on('confirm_resolved'),
  onSettings: on('settings'),
});
