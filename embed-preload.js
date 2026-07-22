// 웹 임베드 재생 창(팝업) 전용 preload - contextIsolation:true라 커스텀 타이틀바 버튼들이
// 메인 프로세스에 요청을 보낼 수 있게 최소한의 API만 노출한다.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('embedAPI', {
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-embed-always-on-top'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  onMaximizeChanged: (cb) => ipcRenderer.on('window:maximize-changed', (e, v) => cb(v)),
  // 좌우반전(Ctrl+Alt+U) - 안의 iframe(핀터레스트/유튜브 등)이 포커스를 가져가면 일반
  // window keydown 리스너로는 이 단축키를 못 받으므로, main 프로세스가 before-input-event로
  // 잡아서 보내주는 신호를 받는다.
  onToggleMirror: (cb) => ipcRenderer.on('toggle-mirror', () => cb())
});
