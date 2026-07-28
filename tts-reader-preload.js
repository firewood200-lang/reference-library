// "읽기 모드" 창(문서/기사 읽기 창)에서만 쓰는 아주 작은 preload.
// 이 창들은 nodeIntegration:false로 띄우기 때문에 렌더러(HTML 안 <script>)에서
// ipcRenderer를 직접 쓸 수 없다. TTS 설정(음성/속도/음높이/볼륨) 저장·불러오기와
// "고음질 음성 받기"(윈도우 설정 열기)에 필요한 최소한의 통로만 contextBridge로 열어준다.
//
// 2026-07-20: 이 PC의 Chromium이 일부 SAPI5 음성(유미 등)을 인식하지 못하는 문제 때문에,
// 브라우저 내장 speechSynthesis 대신 PowerShell(.NET System.Speech)로 우회 재생하는
// "네이티브 엔진" 통로(nativeXxx)를 추가했다.
// 2026-07-22: TTS를 한 차례 완전히 걷어냈다가 "읽는 위치 표시"까지 포함해 다시 만들었다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ttsAPI', {
  getConfig: () => ipcRenderer.invoke('get-tts-config'),
  setConfig: (partial) => ipcRenderer.invoke('set-tts-config', partial),
  openVoiceSettings: () => ipcRenderer.invoke('open-os-voice-settings'),
  nativeListVoices: () => ipcRenderer.invoke('tts-native-list-voices'),
  nativeSpeak: (payload) => ipcRenderer.invoke('tts-native-speak', payload),
  nativePause: () => ipcRenderer.invoke('tts-native-pause'),
  nativeResume: () => ipcRenderer.invoke('tts-native-resume'),
  nativeStop: () => ipcRenderer.invoke('tts-native-stop'),
  onNativeStatus: (cb) => ipcRenderer.on('tts-native-status', (_e, status) => cb(status)),
  // 2026-07-28: "읽기 모드" 창에 편집 기능 추가 - 미리보기(readDocText)는 큰 파일이면 앞부분만
  // 잘라서 보여주므로, 편집할 때는 반드시 전체 내용을 다시 읽어오는 read-text-full을 쓴다.
  readTextFull: (filePath) => ipcRenderer.invoke('read-text-full', filePath),
  writeTextFile: (payload) => ipcRenderer.invoke('write-text-file', payload),
});
