const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, screen, globalShortcut, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const zlib = require('zlib'); // docx(zip) 안의 문서 XML 압축을 풀 때 씀 - 별도 라이브러리 설치 없이 내장 모듈만으로 처리

let mainWindow;
let closeConfirmed = false; // 닫기 전 "전체 코드저장" 확인이 끝나서 실제로 닫아도 되는 상태인지
// 파일 종류별 확장자 - 이미지/3D모델/문서를 모두 라이브러리에 표시
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const MODEL_EXTS = ['.obj'];
const DOC_EXTS = ['.pdf', '.txt', '.md', '.docx'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v'];
const EMBED_EXT = '.pinembed'; // 파일을 못 받아오는 웹 임베드(핀터레스트 등)를 가리키는 참조용 파일
const LINK_EXT = '.weblink'; // 뉴스 기사 등 일반 웹 링크 - 본문을 추출해서 캐시해둔 참조용 파일
// 2026-07-22: "미니창 열기"(임의 사이트를 작은 창으로 띄우는 기능)로 보던 화면을 라이브러리 항목으로
// 남겨두는 참조용 파일. 핀터레스트/유튜브 전용인 .pinembed나, 기사 본문 추출용인 .weblink와 달리
// 아무 사이트나 대상이라 자동으로 대표 이미지를 구할 방법이 없다 - 그래서 썸네일은 사용자가 직접
// 파일 선택/붙여넣기로 지정해서 같이 저장한다({url, title, addedAt} JSON + 썸네일 캐시 이미지).
const MINIWIN_EXT = '.miniwin';
const SUPPORTED = [...IMAGE_EXTS, ...MODEL_EXTS, ...DOC_EXTS, ...VIDEO_EXTS, EMBED_EXT, LINK_EXT, MINIWIN_EXT];
function kindOf(ext) {
  ext = ext.toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (MODEL_EXTS.includes(ext)) return 'model';
  if (DOC_EXTS.includes(ext)) return 'doc';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (ext === EMBED_EXT) return 'embed';
  if (ext === LINK_EXT) return 'link';
  if (ext === MINIWIN_EXT) return 'miniwin';
  return 'other';
}
const DATA_FILE = '.reflib-data.json';
const CONFIG_PATH = path.join(app.getPath('userData'), 'reflib-config.json');
// 크로키 앱(항상 위 뷰어) 기본 위치 - 없으면 최초 1회 폴더 선택 다이얼로그로 물어봄
const DEFAULT_CROQUIS_DIR = 'C:\\Users\\user\\Downloads\\ai-webtoon studio1.0\\croquis_player_v2\\croquis';
// obj 뷰어 기본 위치 - 없으면 최초 1회 폴더 선택 다이얼로그로 물어봄
const DEFAULT_OBJVIEWER_DIR = 'C:\\Users\\user\\Downloads\\ai-webtoon studio1.0\\obj-viewer-app\\obj-viewer-app';
// 워크 타이머(별도 exe) 기본 위치 - 구글 드라이브로 옮겨둔 위치. 없으면 최초 1회 파일 선택 다이얼로그로 물어봄
const DEFAULT_WORK_TIMER_EXE = 'C:\\Users\\user\\내 드라이브\\워크 타이머\\Work.exe';
// 시계 앱(별도 exe) 기본 위치 - 없으면 최초 1회 파일 선택 다이얼로그로 물어봄
const DEFAULT_CLOCK_EXE = 'C:\\Users\\user\\내 드라이브\\ai-webtoon studio1.0\\ai-webtoon studio1.0\\desktop-clock\\clock-app\\dist\\win-unpacked\\DesktopClock.exe';
// 업스케일(Upscayl, 이미지 화질 개선 앱) - 별도 설치 프로그램. 없으면 최초 1회 파일 선택 다이얼로그로 물어봄
const DEFAULT_UPSCAYL_EXE = 'C:\\Program Files\\Upscayl\\Upscayl.exe';
// DesignDoll(3D 포즈 참고 인형) - 별도 설치 프로그램. 없으면 최초 1회 파일 선택 다이얼로그로 물어봄
const DEFAULT_DESIGNDOLL_EXE = 'C:\\Program Files (x86)\\DesignDoll\\DesignDollLauncher.exe';
// 예스24 이북(만화/서적 참고용 뷰어) - 별도 설치 프로그램. 없으면 최초 1회 파일 선택 다이얼로그로 물어봄
const DEFAULT_YES24EBOOK_EXE = 'C:\\Program Files\\YES24eBook\\YES24eBook.exe';
// PureRef(참고 이미지 무드보드 앱) - 별도 설치 프로그램. 없으면 최초 1회 파일 선택 다이얼로그로 물어봄
const DEFAULT_PUREREF_EXE = 'C:\\Program Files\\PureRef\\PureRef.exe';
// 포스트잇 앱 - 빌드된 exe 없이 소스(package.json)만 있어서, 크로키 앱처럼 이 앱 자신의 electron 런타임으로 실행한다.
// Downloads 원본을 구글 드라이브 쪽으로 복사해뒀으므로, 드라이브 위치를 기본으로 쓴다.
const DEFAULT_STICKY_NOTES_DIR = 'C:\\Users\\user\\내 드라이브\\ai-webtoon studio1.0\\ai-webtoon studio1.0\\sticky-notes\\sticky-notes';
// 곡선 원근 그리드 앱 - 포스트잇과 마찬가지로 빌드된 exe 없이 소스(package.json)만 있어서
// 이 앱 자신의 electron 런타임으로 실행한다.
const DEFAULT_GRID_DIR = 'C:\\Users\\user\\내 드라이브\\ai-webtoon studio1.0\\ai-webtoon studio1.0\\curvilinear-perspective-grid';
// OBJ 배치 뷰어(곡선 그리드 + 3D 모델 배치) 앱 - 위 그리드 앱과 같은 방식(소스 폴더를 이 앱의
// electron 런타임으로 직접 실행). 2026-07-17: 레퍼런스 라이브러리에서 .obj를 우클릭으로 바로 열 수 있게 추가.
const DEFAULT_OBJPLACER_DIR = 'C:\\Users\\user\\내 드라이브\\ai-webtoon studio1.0\\ai-webtoon studio1.0\\curvilinear-obj-placer';
// ComfyUI(로컬 이미지 생성 워크플로우) - 서버 상태(꺼져 있으면 켜기)까지 확인해서 버튼 하나로 여는 용도.
// 2026-07-23: ControlNet+SDXL 워크플로우(sdxl_simple_example)를 레퍼런스 라이브러리에서 바로 열기 위해 추가.
const COMFYUI_DIR = 'D:\\AI-Workflow\\ComfyUI';
const COMFYUI_BAT = path.join(COMFYUI_DIR, 'ComfyUI실행.bat');
const COMFYUI_URL = 'http://127.0.0.1:8188';
// AnythingLLM(로컬 LLM 데스크톱 앱) - 켜져 있는지 확인해서 꺼져 있으면 켜고, 뜰 때까지 기다린 뒤
// 노션 동기화까지 이어서 실행하는 용도. 2026-08-23 추가. 설치 위치를 몰라서 기본 경로가 없으면
// (다른 exe 버튼들과 마찬가지로) 최초 1회 파일 선택 다이얼로그로 물어보고 그 다음부터는 기억한다.
const DEFAULT_ANYTHINGLLM_EXE = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'anythingllm-desktop', 'AnythingLLM.exe');
const ANYTHINGLLM_URL = 'http://localhost:3001';
// 살아있는지 확인할 때는 루트(/)가 아니라 가벼운 API 경로를 친다 - 루트는 SPA 전체 번들을 내려주는
// 경로라 무겁게 느려질 수 있고, 이 경로는 노션 동기화 스크립트(anythingllm_client.py)가 실제로
// 쓰는 것과 같은 엔드포인트라 이미 응답 확인이 된 경로다. API 키 없이 쳐도 401/403 등 어떤 응답이든
// 오기만 하면(에러가 아니라 정상적인 HTTP 응답이면) "켜져 있다"로 판단하기에 충분하다.
const ANYTHINGLLM_ALIVE_CHECK_URL = ANYTHINGLLM_URL + '/api/v1/workspaces';
const NOTION_SYNC_DIR = 'C:\\Users\\user\\Claude\\Projects\\ai-webtoon studio1.0\\notion-sync';
// 펜터치 로컬 앱 - 포스트잇/그리드와 같은 방식(소스 폴더를 이 앱의 electron 런타임으로 직접 실행).
// ComfyUI 원본 노드 그래프(위 버튼)를 그대로 여는 대신, LoRA+ControlNet 워크플로우 전용 UI로
// 감싼 별도 앱. 2026-08-06 추가.
const DEFAULT_PENTOUCH_DIR = 'C:\\Users\\user\\내 드라이브\\ai-webtoon studio1.0\\ai-webtoon studio1.0\\pentouch-app\\pentouch';
// 펜터치 웹 서버(폰에서 Tailscale로 접속하는 원격용) - ComfyUI나 펜터치 앱을 켤 때 같이 켜 두면
// 따로 챙기지 않아도 폰에서 바로 쓸 수 있다. 2026-08-11 추가.
const PENTOUCH_WEB_DIR = 'C:\\Users\\user\\내 드라이브\\ai-webtoon studio1.0\\ai-webtoon studio1.0\\pentouch-app\\pentouch-web';
const PENTOUCH_WEB_BAT = path.join(PENTOUCH_WEB_DIR, '펜터치웹서버실행.bat');
const PENTOUCH_WEB_URL = 'http://127.0.0.1:8189';
// 웹툰 3D(사진/선화 -> 3D 참고용 메쉬) - 버튼 하나로 Hunyuan3D-2mv 서버(꺼져 있으면 자동 시작)를
// 먼저 켜고, 그 다음 webtoon_3d_app.py(Gradio 웹앱, 꺼져 있으면 자동 시작)를 켠 뒤 창을 연다.
// ComfyUI 버튼과 같은 "서버 상태 확인 -> 필요하면 켜기 -> 창 열기" 패턴을 그대로 따르되, 서버가
// 두 개(Hunyuan3D-2mv + webtoon 웹앱)라서 순서대로 두 번 확인/기동한다. 2026-08-22 추가.
const HUNYUAN_MV_DIR = 'D:\\Hunyuan3D2_WinPortable\\Hunyuan3D2_WinPortable_cu129\\Hunyuan3D2_WinPortable';
const HUNYUAN_MV_BAT = path.join(HUNYUAN_MV_DIR, 'hunyuan3d_mv_start.bat');
const HUNYUAN_MV_URL = 'http://127.0.0.1:8080';
const WEBTOON3D_DIR = 'D:\\AI-Workflow';
const WEBTOON3D_BAT = path.join(WEBTOON3D_DIR, 'webtoon_3d_app_start.bat');
const WEBTOON3D_URL = 'http://127.0.0.1:7860';

// 2026-07-18: 이 창(레퍼런스 라이브러리)에서 더블클릭·버튼 등으로 파생되는 팝업/새 창들이 화면
// 아무 데나 뜨지 않고 이 창 정중앙에 뜨도록 하는 공용 헬퍼. 자식 창 크기(width,height)를 받아
// 이 창의 중심점에 맞춘 좌상단 좌표를 계산하되, 그 중심점이 속한 모니터의 작업영역을 벗어나지
// 않게 clamp한다(멀티 모니터 경계 근처에서 창이 화면 밖으로 잘리는 것 방지).
function centeredPosOnMain(width, height) {
  if (!mainWindow) return null;
  try {
    const b = mainWindow.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const display = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) });
    const area = display.workArea;
    let x = Math.round(cx - width / 2);
    let y = Math.round(cy - height / 2);
    x = Math.max(area.x, Math.min(x, area.x + area.width - width));
    y = Math.max(area.y, Math.min(y, area.y + area.height - height));
    return { x, y };
  } catch { return null; }
}
// 별도 프로세스로 띄우는 우리 자신의 다른 앱(크로키·곡선 원근 그리드·OBJ 배치 뷰어·3D 뷰어)에도
// 이 창의 중심 좌표를 커맨드라인 인자로 넘겨서, 그쪽 콜드 스타트 창도 이 창 중앙에 뜨게 한다
// (각 앱 main.js가 "--reflib-center=x,y" 인자를 읽어서 처리 - 크로키 앱 참고).
function reflibCenterArg() {
  if (!mainWindow) return null;
  const b = mainWindow.getBounds();
  return `--reflib-center=${Math.round(b.x + b.width / 2)},${Math.round(b.y + b.height / 2)}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#17181c',
    frame: false, // 회색 기본 제목표시줄/메뉴바 대신 index.html 안의 커스텀 타이틀바로 통일된 디자인을 준다
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }
  });
  // 상세 패널 안의 웹 임베드 미리보기(iframe)도 이 창의 UA를 그대로 쓰므로, 유튜브 등이 낯선 UA를 다르게
  // 취급하지 않도록 데스크톱 크롬 UA로 맞춰둔다.
  mainWindow.webContents.setUserAgent(DESKTOP_CHROME_UA);
  mainWindow.loadFile('index.html');

  // 최대화/복원 시 커스텀 타이틀바의 □/⧉ 아이콘을 맞춰 바꿔주기 위해 렌더러에 상태를 알려준다
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximize-changed', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximize-changed', false));

  // 닫기 직전에 "전체 코드저장 하시겠습니까?" 확인창을 띄우기 위해, 실제 닫기를 한 번 막고 렌더러에
  // 알려준다. 렌더러가 confirm()을 띄운 뒤 (저장하든 안 하든) window:confirm-close를 호출해주면
  // 그때 closeConfirmed를 켜고 다시 닫는다 - 커스텀 타이틀바의 닫기 버튼과 Alt+F4 둘 다 이 close
  // 이벤트를 거치므로 한 곳에서 처리된다.
  mainWindow.on('close', (e) => {
    if (closeConfirmed) return;
    e.preventDefault();
    mainWindow.webContents.send('window:request-close');
  });
}
ipcMain.handle('window:confirm-close', () => {
  closeConfirmed = true;
  mainWindow?.close();
});

// 요청을 보낸 창(e.sender)을 기준으로 동작해서, 메인 창뿐 아니라 웹 임베드 팝업 등 커스텀 타이틀바를 쓰는
// 어떤 창에서도 같은 채널을 그대로 재사용할 수 있게 했다.
ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.handle('window:toggle-maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return win.isMaximized();
});
ipcMain.handle('window:is-maximized', (e) => !!BrowserWindow.fromWebContents(e.sender)?.isMaximized());
ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

app.whenReady().then(() => {
  createWindow();
  // Ctrl+Alt+Y: 그 순간 포커스된 창(크롬이든 뭐든)의 항상 위를 켜고 끈다 - 아래쪽 toggleFocusedWindowTopmost 참고
  // (예전에는 Ctrl+Alt+T였는데, 이 PC의 다른 프로그램이 그 조합키를 이미 선점하고 있어 등록이 조용히
  // 실패했다 - Electron은 이미 선점된 전역 단축키를 등록하려 해도 에러를 던지지 않는다. 그래서 등록
  // 성공 여부를 콘솔에 남기고, 덜 흔히 쓰이는 조합으로 바꿨다.)
  const topmostShortcutOk = globalShortcut.register('Control+Alt+Y', async () => {
    const out = await toggleFocusedWindowTopmost();
    if (!out || out.startsWith('NOTFOUND')) return;
    const [state, title] = out.split(/:(.*)/s);
    if (Notification.isSupported()) {
      new Notification({
        title: state === 'ON' ? '항상 위 켜짐' : '항상 위 꺼짐',
        body: title || '(제목 없음)'
      }).show();
    }
  });
  if (!topmostShortcutOk) {
    console.error('[전역 단축키] Control+Alt+Y 등록 실패 - 다른 프로그램이 이미 이 조합키를 쓰고 있을 수 있습니다.');
  }
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// ---- 설정(마지막 라이브러리 경로) ----
ipcMain.handle('get-config', () => {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
});
ipcMain.handle('set-config', (e, cfg) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return true;
});

// ---- TTS(문서 읽어주기) 설정 - 같은 설정 파일의 "tts" 하위 키에 저장, 전체 config를 덮어쓰지 않도록 병합 ----
ipcMain.handle('get-tts-config', () => getConfig().tts || {});
ipcMain.handle('set-tts-config', (e, partial) => {
  const cfg = getConfig();
  cfg.tts = Object.assign({}, cfg.tts || {}, partial);
  setConfig(cfg);
  return cfg.tts;
});
// "고음질 음성 받기" 버튼용 - 별도 엔진을 앱에 내장하는 대신, 윈도우 자체 "음성 관리" 설정 화면을
// 바로 열어준다. 거기서 받은 자연스러운(Natural/온라인) 한국어 음성은 다운로드가 끝나면 별도 코드
// 없이도 speechSynthesis.getVoices() 목록에 자동으로 나타난다 - OS가 음성 다운로드/설치를 전담.
ipcMain.handle('open-os-voice-settings', () => {
  shell.openExternal('ms-settings:speech');
  return true;
});

// ---- TTS 네이티브 엔진(.NET System.Speech) 프로세스 관리 ----
// 이 PC의 Chromium이 새로 등록된 일부 SAPI5 음성(유미 등)을 speechSynthesis.getVoices()에
// 노출하지 않는 문제가 확인됐다(레지스트리는 정상, 크롬 자체 필터링 문제). 반면 PowerShell의
// System.Speech는 같은 음성을 정상적으로 재생한다. 그래서 읽기 모드 창마다 PowerShell 자식
// 프로세스(tts-native-engine.ps1)를 하나씩 붙여두고, 표준입출력으로 명령/상태를 주고받는
// 방식으로 브라우저 TTS 대신 이 경로를 쓴다. 창(webContents)마다 프로세스를 하나씩 유지해서
// 재생 중 다른 창을 열어도 서로 간섭하지 않는다.
// 'powershell.exe'를 이름만으로 실행하면 PATH 검색 결과에 따라 32비트 버전이 걸릴 수 있고,
// 그러면 유미처럼 진짜 64비트 레지스트리에만 등록된 SAPI5 음성을 SelectVoice()가 못 찾는다
// (목록 조회에선 이름이 얼핏 보이다가 실제 선택 시 "일치하는 음성이 없다" 오류로 실패하는 걸
// 확인함). 이 앱(Electron) 자체는 64비트로 뜨므로, System32 경로는 리다이렉션 없이 진짜
// 64비트 PowerShell을 가리킨다 - 이 절대경로를 명시해서 PATH 검색에 흔들리지 않게 한다.
const POWERSHELL_64 = (() => {
  const p = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  try { return fs.existsSync(p) ? p : 'powershell.exe'; } catch { return 'powershell.exe'; }
})();
const ttsNativeProcesses = new Map(); // webContents.id -> child process
function getTtsNativeProcess(webContentsId, win) {
  let proc = ttsNativeProcesses.get(webContentsId);
  if (proc && !proc.killed) return proc;
  const scriptPath = path.join(__dirname, 'tts-native-engine.ps1');
  proc = spawn(POWERSHELL_64, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('STATUS:') && win && !win.isDestroyed()) {
        win.webContents.send('tts-native-status', line.slice('STATUS:'.length));
      }
    }
  });
  proc.on('error', () => { ttsNativeProcesses.delete(webContentsId); });
  proc.on('exit', () => { ttsNativeProcesses.delete(webContentsId); });
  ttsNativeProcesses.set(webContentsId, proc);
  return proc;
}
function killTtsNativeProcess(webContentsId) {
  const proc = ttsNativeProcesses.get(webContentsId);
  if (proc && !proc.killed) { try { proc.stdin.write('EXIT\n'); } catch {} try { proc.kill(); } catch {} }
  ttsNativeProcesses.delete(webContentsId);
}
ipcMain.handle('tts-native-list-voices', () => {
  try {
    const cmd = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name } | ConvertTo-Json -Compress";
    const result = spawnSync(POWERSHELL_64, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf-8' });
    if (result.error) return { success: false, error: result.error.message };
    if (result.status !== 0) return { success: false, error: result.stderr || '알 수 없는 오류' };
    let names = JSON.parse((result.stdout || '[]').trim() || '[]');
    if (!Array.isArray(names)) names = [names];
    return { success: true, voices: names };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('tts-native-speak', (e, { text, voiceName, rate, pitch, volume }) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    const netRate = Math.max(-10, Math.min(10, Math.round(((typeof rate === 'number' ? rate : 1) - 1) * 10)));
    const netVolume = Math.max(0, Math.min(100, Math.round((typeof volume === 'number' ? volume : 1) * 100)));
    const netPitch = Math.max(-100, Math.min(100, Math.round(((typeof pitch === 'number' ? pitch : 1) - 1) * 100)));
    const b64 = Buffer.from(String(text || ''), 'utf-8').toString('base64');
    const proc = getTtsNativeProcess(e.sender.id, win);
    if (voiceName) proc.stdin.write(`VOICE:${voiceName}\n`);
    proc.stdin.write(`RATE:${netRate}\n`);
    proc.stdin.write(`VOLUME:${netVolume}\n`);
    proc.stdin.write(`PITCH:${netPitch}\n`);
    proc.stdin.write(`SPEAK:${b64}\n`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
// 2026-07-20: 일시정지/정지가 조용히 반응 없는 문제 진단용 - proc을 못 찾거나 쓰기 자체가
// 실패하는 경우 원인을 그대로 렌더러에 돌려줘서 화면에 표시되게 한다(이전엔 무조건 true 반환).
// 2026-07-22(5차): tts-native-engine.ps1의 명령 파서는 콜론(:)이 없는 줄을 통째로 무시한다
// ($sep = $line.IndexOf(':'); if ($sep -lt 0) { continue } - RECEIVED:$cmd 진단 로그조차 안 찍힘).
// PAUSE/RESUME/STOP은 값이 필요 없어 콜론 없이 "PAUSE\n"처럼 그냥 보내고 있었는데, 그래서
// PowerShell 쪽이 이 명령들을 전부 조용히 버리고 있었다 - 실제로 개발자 도구 콘솔에서
// RECEIVED:PAUSE가 단 한 번도 안 찍히는 것으로 확인됨(일시정지 버튼이 "반응이 없다"던 진짜
// 원인). 값 없는 명령도 파서가 인식하도록 뒤에 빈 콜론을 붙여서 보낸다.
ipcMain.handle('tts-native-pause', (e) => {
  const proc = ttsNativeProcesses.get(e.sender.id);
  if (!proc) return { success: false, error: '재생 세션이 없습니다(먼저 읽기를 눌러야 합니다)' };
  try { proc.stdin.write('PAUSE:\n'); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('tts-native-resume', (e) => {
  const proc = ttsNativeProcesses.get(e.sender.id);
  if (!proc) return { success: false, error: '재생 세션이 없습니다(먼저 읽기를 눌러야 합니다)' };
  try { proc.stdin.write('RESUME:\n'); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});
// 2026-07-22: 세션이 없을 때 이전엔 오류를 돌려줬는데, 그러면 STOPPED 상태 이벤트가 안 와서
// 렌더러의 resetUi()가 한 번도 안 불려 정지 버튼을 눌러도 다른 버튼들이 재생 중이던 모습(비활성화된
// 채) 그대로 멈춰버리는 문제가 있었다. "정지"는 원래 멱등적인 동작(이미 멈춰 있으면 목표 상태에
// 이미 도달한 것)이라, 세션이 없는 걸 오류로 보지 않고 조용히 성공 처리한다.
ipcMain.handle('tts-native-stop', (e) => {
  const proc = ttsNativeProcesses.get(e.sender.id);
  if (!proc) return { success: true };
  try { proc.stdin.write('STOP:\n'); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

// ---- 코드 저장/받기 (git push/pull을 버튼으로) ----
// 2026-07-22: 이 앱 자체(reference-library 폴더)를 git 저장소로 바꾸면서, 매번 PowerShell을
// 열어 git 명령을 치는 대신 앱 안 버튼으로도 되게 만든다. git 명령은 이 파일(main.js)이 있는
// 폴더(__dirname) 기준으로 실행한다 - 그게 곧 git 저장소 루트다.
function runGitCommand(args) {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd: __dirname, windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('close', (code) => resolve({ success: code === 0, code, stdout, stderr }));
    proc.on('error', (err) => resolve({ success: false, code: -1, stdout, stderr: err.message }));
  });
}
ipcMain.handle('git-save', async (e, { message } = {}) => {
  const msg = (message && message.trim()) ? message.trim() : `수정 ${new Date().toLocaleString('ko-KR')}`;
  const add = await runGitCommand(['add', '-A']);
  if (!add.success) return { success: false, message: '변경사항 확인(git add) 실패:\n' + (add.stderr || add.stdout || '알 수 없는 오류') };

  const commit = await runGitCommand(['commit', '-m', msg]);
  // "nothing to commit"은 실패가 아니라 "바뀐 게 없다"는 정상 상태 - 이 경우에도 아래에서 push는 계속 시도한다
  // (다른 컴퓨터에서 이미 커밋해둔 게 아직 안 올라간 상태일 수 있어서).
  const nothingToCommit = /nothing to commit/i.test(commit.stdout + commit.stderr);
  if (!commit.success && !nothingToCommit) {
    return { success: false, message: '저장(git commit) 실패:\n' + (commit.stderr || commit.stdout || '알 수 없는 오류') };
  }

  const push = await runGitCommand(['push']);
  if (!push.success) {
    return { success: false, message: 'GitHub 업로드(git push) 실패:\n' + (push.stderr || push.stdout || '알 수 없는 오류') };
  }

  return {
    success: true,
    message: nothingToCommit
      ? '바뀐 내용이 없어서 저장할 게 없습니다. (이미 최신 상태)'
      : 'GitHub에 정상적으로 저장되었습니다.',
  };
});
ipcMain.handle('git-pull', async () => {
  const pull = await runGitCommand(['pull']);
  if (!pull.success) {
    return { success: false, message: '최신 코드 받아오기(git pull) 실패:\n' + (pull.stderr || pull.stdout || '알 수 없는 오류') };
  }
  const upToDate = /Already up to date/i.test(pull.stdout);
  return {
    success: true,
    message: upToDate ? '이미 최신 상태입니다.' : ('최신 코드를 정상적으로 받아왔습니다.\n\n' + pull.stdout.trim()),
  };
});

// ---- 로컬LLM(AnythingLLM) 켜기 + 노션 동기화 (2026-08-23) ----
// "로컬LLM" 버튼 하나로: 1) AnythingLLM 데스크톱 앱이 꺼져 있으면 켜고 뜰 때까지 기다린 뒤,
// 2) notion-sync 폴더의 sync.py를 실행해서 노션에 새로 쓰거나 수정한 내용을 AnythingLLM에
// 자동으로 반영한다. ComfyUI 버튼(server 꺼져 있으면 켜고 기다리는 패턴)과 같은 방식.
function checkAnythingLLMAlive() {
  // 2026-08-23: 처음엔 /api/v1/workspaces API로, 그다음엔 tasklist 프로세스 확인으로 시도했으나
  // 각각 "API 미설정"과 "확인할 때마다 콘솔 창이 깜빡이는 문제"가 있었다.
  // 그래서 서브프로세스를 전혀 띄우지 않는 순수 TCP 포트 연결 확인으로 바꾼다.
  // AnythingLLM 데스크톱 앱은 자체 화면(렌더러)이 내부적으로 이 포트(3001)와 통신하므로,
  // Developer API 설정과 무관하게 앱이 켜져 있으면 이 포트는 항상 열려 있다.
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 3001 });
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(2000);
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}
async function waitForAnythingLLM(maxWaitMs) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkAnythingLLMAlive()) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// ---- Ollama(실제로 답변을 만들어내는 엔진) 켜기 ----
// AnythingLLM 창이 떠 있어도, 그 뒤에서 답을 실제로 만들어주는 Ollama 서비스가 꺼져 있으면
// 채팅에서 "Ollama service could not be reached. Is Ollama running?" 오류가 난다.
// AnythingLLM.exe 실행과 Ollama 실행은 서로 별개이므로 따로 확인하고 켜줘야 한다.
// 2026-08-23: 'localhost'로 접속하면 이 컴퓨터에서 Node가 IPv6(::1)를 먼저 시도하다 실패하는 문제가 있어,
// Ollama가 실제로 바인딩하는 주소인 127.0.0.1을 직접 명시한다.
const OLLAMA_ALIVE_CHECK_URL = 'http://127.0.0.1:11434';
function checkOllamaAlive() {
  return new Promise((resolve) => {
    const req = http.get(OLLAMA_ALIVE_CHECK_URL, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitForOllama(maxWaitMs) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkOllamaAlive()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
// 마지막으로 ollama 자동 실행을 시도했을 때 무슨 일이 있었는지 기록해둔다.
// (실패해도 이유를 알 수 없어서 사용자가 매번 추측만 해야 했던 문제를 없애기 위함)
let lastOllamaStartAttemptLog = '';
function tryStartOllama() {
  return new Promise((resolve) => {
    lastOllamaStartAttemptLog = '';
    let child;
    try {
      child = spawn('ollama', ['serve'], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      lastOllamaStartAttemptLog = 'ollama 명령 실행 자체에 실패: ' + err.message;
      resolve(false);
      return;
    }
    let settled = false;
    child.stdout && child.stdout.on('data', (d) => { lastOllamaStartAttemptLog += d.toString('utf-8'); });
    child.stderr && child.stderr.on('data', (d) => { lastOllamaStartAttemptLog += d.toString('utf-8'); });
    child.on('error', (err) => {
      // 'ollama' 명령을 PATH에서 찾지 못하면(ENOENT) 여기로 온다.
      lastOllamaStartAttemptLog = 'ollama 명령을 실행하지 못했습니다 (' + err.message + '). PATH에 등록되어 있는지 확인이 필요합니다.';
      if (!settled) { settled = true; resolve(false); }
    });
    child.on('exit', (code, signal) => {
      // serve가 곧바로 종료되면(예: 포트 충돌, 권한 문제 등) 실패로 본다.
      if (!settled) {
        settled = true;
        lastOllamaStartAttemptLog += `\n(ollama serve 프로세스가 곧바로 종료됨: code=${code}, signal=${signal})`;
        resolve(false);
      }
    });
    // 1.5초 안에 error/exit가 안 나면 일단 정상적으로 떠 있는 것으로 보고 넘어간다.
    // (실제로 응답 가능한지는 waitForOllama가 별도로 포트를 확인한다)
    setTimeout(() => {
      if (!settled) { settled = true; child.unref(); resolve(true); }
    }, 1500);
  });
}
function runNotionSyncScript() {
  return new Promise((resolve) => {
    // 2026-08-23: 파이썬 출력이 윈도우 콘솔 기본 인코딩(cp949)으로 나가면서 한글이 깨지는 문제가 있어,
    // 파이썬 자체를 UTF-8로 출력하도록 강제한다.
    const proc = spawn('py', ['sync.py'], {
      cwd: NOTION_SYNC_DIR,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('close', (code) => {
      if (code !== 0) {
        const tail = (stderr || stdout || '알 수 없는 오류').trim().split('\n').slice(-15).join('\n');
        resolve({ success: false, message: '노션 동기화 실패 (code ' + code + '):\n\n' + tail });
      } else {
        const tail = stdout.trim().split('\n').slice(-15).join('\n');
        resolve({ success: true, message: tail || '동기화가 완료되었습니다.' });
      }
    });
    proc.on('error', (err) => resolve({ success: false, message: '노션 동기화 실행 실패: ' + err.message + '\n(notion-sync 폴더 위치나 py 설치를 확인해주세요)' }));
  });
}
ipcMain.handle('run-local-llm-and-sync', async () => {
  const steps = [];
  try {
    // 0) Ollama(실제로 답변을 만들어내는 엔진)가 켜져 있는지 먼저 확인. 이게 꺼져 있으면
    //    AnythingLLM 창이 떠 있어도 채팅에서 "Ollama service could not be reached" 오류가 난다.
    const ollamaAlreadyRunning = await checkOllamaAlive();
    if (!ollamaAlreadyRunning) {
      steps.push('Ollama가 꺼져 있어 켜는 중...');
      const started = await tryStartOllama();
      if (!started) {
        return { success: false, message: 'Ollama를 자동으로 켜지 못했습니다. Ollama 프로그램을 먼저 한 번 직접 실행해주세요.\n\n[상세 오류]\n' + (lastOllamaStartAttemptLog || '(추가 정보 없음)') };
      }
      const ollamaReady = await waitForOllama(30000); // 최대 30초 대기
      if (!ollamaReady) {
        return { success: false, message: 'Ollama 프로세스는 실행됐지만 30초 안에 응답하지 않았습니다. Ollama 프로그램을 먼저 한 번 직접 실행한 뒤 다시 눌러주세요.\n\n[프로세스 출력]\n' + (lastOllamaStartAttemptLog || '(출력 없음)') };
      }
      steps.push('Ollama 켜짐 확인됨.');
    } else {
      steps.push('Ollama는 이미 켜져 있습니다.');
    }

    const alreadyRunning = await checkAnythingLLMAlive();
    if (!alreadyRunning) {
      const exePath = await resolveExePath('anythingllmExe', DEFAULT_ANYTHINGLLM_EXE, 'AnythingLLM 실행 파일(AnythingLLM.exe)을 선택하세요');
      if (!exePath) return { success: false, message: 'AnythingLLM 실행 파일 위치를 찾지 못했습니다.' };
      launchExe(exePath);
      steps.push('AnythingLLM을 켜는 중...');
      const ready = await waitForAnythingLLM(150000); // 모델 로딩 등으로 시간이 걸릴 수 있어 최대 150초(2분 30초) 대기
      if (!ready) {
        return { success: false, message: 'AnythingLLM이 150초 안에 켜지지 않았습니다. 켜지는 중이라면 잠시 후 다시 눌러주세요. (이미 켜져 있는데도 이 메시지가 다시 뜬다면 알려주세요 - 확인 로직 자체를 다시 봐야 합니다)' };
      }
      steps.push('AnythingLLM 켜짐 확인됨.');
    } else {
      steps.push('AnythingLLM은 이미 켜져 있습니다.');
    }
    const syncResult = await runNotionSyncScript();
    return {
      success: syncResult.success,
      message: steps.join('\n') + '\n\n' + syncResult.message,
    };
  } catch (err) {
    return { success: false, message: '로컬LLM 실행/동기화 중 오류: ' + err.message };
  }
});

// ---- 전체 앱 코드저장/받기 (2026-07-23) ----
// 레퍼런스 라이브러리가 사실상 런처 역할을 하므로, 여기서 8개 앱 폴더를 전부 돌면서 git 명령을
// 실행한다. 각 앱 폴더는 이 폴더(reference-library)와 형제 폴더라는 점만 가정하므로(즉 상위 폴더
// 구조만 같으면), 컴퓨터마다 드라이브 문자나 절대경로가 달라도(집 D드라이브/회사 C드라이브 등)
// 항상 정확히 찾는다 - __dirname 기준 상대경로라서다.
const GIT_ALL_PARENT_DIR = path.join(__dirname, '..');
const GIT_ALL_APPS = [
  { name: '레퍼런스 라이브러리', dir: __dirname },
  { name: '크로키 앱', dir: path.join(GIT_ALL_PARENT_DIR, 'croquis_player_v2', 'croquis') },
  { name: '커브 원근 그리드', dir: path.join(GIT_ALL_PARENT_DIR, 'curvilinear-perspective-grid') },
  { name: 'OBJ 배치 뷰어', dir: path.join(GIT_ALL_PARENT_DIR, 'curvilinear-obj-placer') },
  { name: 'SetPose 임베드', dir: path.join(GIT_ALL_PARENT_DIR, 'setpose-embed') },
  { name: '데스크탑 시계', dir: path.join(GIT_ALL_PARENT_DIR, 'desktop-clock', 'clock-app') },
  { name: '포스트잇', dir: path.join(GIT_ALL_PARENT_DIR, 'sticky-notes', 'sticky-notes') },
  { name: '3D 뷰어', dir: path.join(GIT_ALL_PARENT_DIR, 'obj-viewer-app', '3d-viewer') },
];
function runGitCommandIn(dir, args) {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd: dir, windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });
    proc.on('close', (code) => resolve({ success: code === 0, code, stdout, stderr }));
    proc.on('error', (err) => resolve({ success: false, code: -1, stdout, stderr: err.message }));
  });
}
ipcMain.handle('git-save-all', async () => {
  const results = [];
  for (const appInfo of GIT_ALL_APPS) {
    if (!fs.existsSync(appInfo.dir) || !fs.existsSync(path.join(appInfo.dir, '.git'))) {
      results.push({ name: appInfo.name, success: false, message: '폴더를 못 찾았거나 git 저장소가 아님 (건너뜀)' });
      continue;
    }
    const msg = `수정 ${new Date().toLocaleString('ko-KR')}`;
    const add = await runGitCommandIn(appInfo.dir, ['add', '-A']);
    if (!add.success) { results.push({ name: appInfo.name, success: false, message: 'git add 실패: ' + (add.stderr || add.stdout || '알 수 없는 오류').trim() }); continue; }
    const commit = await runGitCommandIn(appInfo.dir, ['commit', '-m', msg]);
    const nothingToCommit = /nothing to commit/i.test(commit.stdout + commit.stderr);
    if (!commit.success && !nothingToCommit) { results.push({ name: appInfo.name, success: false, message: 'git commit 실패: ' + (commit.stderr || commit.stdout || '알 수 없는 오류').trim() }); continue; }
    const push = await runGitCommandIn(appInfo.dir, ['push']);
    if (!push.success) { results.push({ name: appInfo.name, success: false, message: 'git push 실패: ' + (push.stderr || push.stdout || '알 수 없는 오류').trim() }); continue; }
    results.push({ name: appInfo.name, success: true, message: nothingToCommit ? '변경 없음(이미 최신)' : '저장 완료' });
  }
  return results;
});
ipcMain.handle('git-pull-all', async () => {
  const results = [];
  for (const appInfo of GIT_ALL_APPS) {
    if (!fs.existsSync(appInfo.dir) || !fs.existsSync(path.join(appInfo.dir, '.git'))) {
      results.push({ name: appInfo.name, success: false, message: '폴더를 못 찾았거나 git 저장소가 아님 (건너뜀)' });
      continue;
    }
    const pull = await runGitCommandIn(appInfo.dir, ['pull']);
    if (!pull.success) { results.push({ name: appInfo.name, success: false, message: 'git pull 실패: ' + (pull.stderr || pull.stdout || '알 수 없는 오류').trim() }); continue; }
    const upToDate = /Already up to date/i.test(pull.stdout);
    results.push({ name: appInfo.name, success: true, message: upToDate ? '이미 최신' : '받기 완료' });
  }
  return results;
});

// ---- 라이브러리 루트 선택 ----
ipcMain.handle('select-library-root', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ---- 폴더 트리 스캔 (폴더만, 재귀) ----
// imageCount는 하위 폴더까지 전부 합친 총 개수(재귀), directCount는 그 폴더 안에 바로 있는 파일 개수
function scanTree(dir, root) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { name: path.basename(dir), relPath: path.relative(root, dir), children: [], imageCount: 0, directCount: 0 }; }
  const children = [];
  let directCount = 0;
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      children.push(scanTree(full, root));
    } else {
      // 확장자 화이트리스트로 걸러내지 않고 폴더 안의 모든 파일을 센다 (문서 파일 등이 누락되지 않도록)
      directCount++;
    }
  }
  // 가나다/abc 순 정렬 (한글 로케일 기준 - 대소문자 구분 없이 자연스러운 순서로 비교)
  children.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const childrenTotal = children.reduce((sum, c) => sum + c.imageCount, 0);
  return { name: path.basename(dir), relPath: path.relative(root, dir), children, imageCount: directCount + childrenTotal, directCount };
}
ipcMain.handle('scan-folder-tree', (e, root) => scanTree(root, root));

// ---- 특정 폴더의 이미지 목록 ----
function listImages(dir, recursive) {
  let out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (recursive) out = out.concat(listImages(full, true));
    } else {
      // 확장자 화이트리스트로 걸러내지 않고 모든 파일을 표시 (등록 안 된 문서/기타 파일도 'other'로 표시되어 최소한 보이고 열 수 있음)
      const stat = fs.statSync(full);
      const ext = path.extname(ent.name);
      const item = { path: full, name: ent.name, size: stat.size, mtime: stat.mtimeMs, kind: kindOf(ext) };
      // 웹 임베드 참조 파일은 실제 파일(이미지 등)이 아니라 {embedUrl, title} JSON이므로 같이 읽어서 붙여준다
      if (ext.toLowerCase() === EMBED_EXT) {
        try {
          const meta = JSON.parse(fs.readFileSync(full, 'utf-8'));
          item.embedUrl = meta.embedUrl;
          item.embedTitle = meta.title;
          item.sourceUrl = meta.sourceUrl;
        } catch {}
      }
      // 웹 링크(기사 등) 참조 파일도 목록에는 가벼운 정보(제목/썸네일/요약)만 붙인다 - 본문 전체는 상세 패널에서 필요할 때만 읽는다
      if (ext.toLowerCase() === LINK_EXT) {
        try {
          const meta = JSON.parse(fs.readFileSync(full, 'utf-8'));
          item.linkUrl = meta.url;
          item.linkTitle = meta.title;
          item.linkImage = meta.image;
          item.linkExcerpt = meta.excerpt;
        } catch {}
      }
      // 미니창 항목 참조 파일도 {url, title} JSON이므로 같이 읽어서 붙여준다. 썸네일은 자동 소스가
      // 없어(임의 사이트) 저장 시점에 사용자가 지정한 캐시 이미지를 그대로 쓴다 - 렌더러 쪽 ensureMiniwinThumbnail 참고.
      if (ext.toLowerCase() === MINIWIN_EXT) {
        try {
          const meta = JSON.parse(fs.readFileSync(full, 'utf-8'));
          item.miniwinUrl = meta.url;
          item.miniwinTitle = meta.title;
        } catch {}
      }
      // 텍스트/마크다운 파일도 그리드에서 무슨 내용인지 알 수 있게 앞부분만 살짝 읽어서 붙인다.
      // 파일 전체를 읽으면 큰 텍스트 파일에서 느려질 수 있어, 앞쪽 300바이트만 부분적으로 읽는다.
      if (ext.toLowerCase() === '.txt' || ext.toLowerCase() === '.md') {
        try {
          const fd = fs.openSync(full, 'r');
          const buf = Buffer.alloc(300);
          const bytesRead = fs.readSync(fd, buf, 0, 300, 0);
          fs.closeSync(fd);
          item.textExcerpt = buf.toString('utf-8', 0, bytesRead).replace(/�$/, '').replace(/\s+/g, ' ').trim();
        } catch {}
      }
      out.push(item);
    }
  }
  return out;
}
ipcMain.handle('list-images', (e, { root, folderPath, recursive }) => {
  const dir = folderPath || root;
  return listImages(dir, !!recursive);
});

// ---- 메타데이터(태그/메모/즐겨찾기) 로드/저장 ----
ipcMain.handle('load-data', (e, root) => {
  const p = path.join(root, DATA_FILE);
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return { user_id: 'default_user', version: 1, tags: {}, notes: {}, favorites: [], pinnedFolders: [] }; }
});
ipcMain.handle('save-data', (e, { root, data }) => {
  const p = path.join(root, DATA_FILE);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return true;
});

// ---- 웹 임베드 참조(핀터레스트 등 - 파일로 못 받아오는 콘텐츠를 재생 링크만 저장) ----
// 실제 이미지/동영상 파일이 아니라 {embedUrl, title, sourceUrl} 만 담은 작은 JSON 파일을 라이브러리 폴더 안에 남겨서,
// 다른 파일들과 똑같이 폴더 트리에 보이고 더블클릭하면 재생 창이 뜨게 한다.
ipcMain.handle('save-web-embed', (e, { destDir, embedUrl, title, sourceUrl }) => {
  try {
    const safeTitle = (title || '웹 임베드').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    let dest = path.join(destDir, safeTitle + EMBED_EXT);
    let i = 1;
    while (fs.existsSync(dest)) { dest = path.join(destDir, `${safeTitle} (${i})${EMBED_EXT}`); i++; }
    fs.writeFileSync(dest, JSON.stringify({ embedUrl, title: title || '웹 임베드', sourceUrl, addedAt: Date.now() }, null, 2));
    return { success: true, path: dest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- 미니창 항목 저장 (2026-07-22) ----
// "미니창 열기"로 띄워서 보던 임의 사이트를, 다른 라이브러리 항목들처럼 폴더 트리에 남기고 더블클릭하면
// 다시 미니창으로 열리게 한다. 썸네일은 이 핸들러에서 다루지 않고(자동 소스가 없으므로), 렌더러가
// save-mini-window-ref로 만들어진 경로를 받아 직접 썸네일 캐시 파일에 써넣는다.
ipcMain.handle('save-mini-window-ref', (e, { destDir, url, title }) => {
  try {
    const safeTitle = (title || '미니창 항목').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    let dest = path.join(destDir, safeTitle + MINIWIN_EXT);
    let i = 1;
    while (fs.existsSync(dest)) { dest = path.join(destDir, `${safeTitle} (${i})${MINIWIN_EXT}`); i++; }
    fs.writeFileSync(dest, JSON.stringify({ url, title: title || '미니창 항목', addedAt: Date.now() }, null, 2));
    return { success: true, path: dest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 이미 저장된 미니창 항목의 연결 주소만 바꿔치기 (2026-07-22 추가) - 그리드 우클릭/상세 패널의
// "주소 변경"에서 사용. 제목/추가일 등 기존 메타데이터는 그대로 두고 url 필드만 덮어쓴다.
ipcMain.handle('update-mini-window-ref', (e, { path: targetPath, url }) => {
  try {
    const meta = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    meta.url = url;
    fs.writeFileSync(targetPath, JSON.stringify(meta, null, 2));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 미니창 항목 추가 모달의 "파일 선택" 버튼용 - 이미지 하나를 골라 base64로 돌려주면, 렌더러가
// 저장 전 미리보기에 쓰고, 실제 저장 시 썸네일 캐시 파일로 써넣는다.
ipcMain.handle('pick-thumbnail-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '썸네일 이미지 선택',
    properties: ['openFile'],
    filters: [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { success: false };
  try {
    const buf = fs.readFileSync(result.filePaths[0]);
    return { success: true, data: buf.toString('base64') };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- 웹페이지에서 선택한 텍스트를 드래그해서 놓으면 자동으로 .txt 메모 파일로 저장 ----
// 파일명은 사용자에게 묻지 않고 텍스트 첫 줄(짧게 잘라서)로 자동 지정한다 - "자동으로 저장"하는 게 목적이라 프롬프트를 띄우지 않음.
ipcMain.handle('save-text-note', (e, { destDir, text }) => {
  try {
    const firstLine = (text.split(/\r?\n/).find(l => l.trim()) || '메모').trim();
    const safeTitle = firstLine.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '메모';
    let dest = path.join(destDir, safeTitle + '.txt');
    let i = 1;
    while (fs.existsSync(dest)) { dest = path.join(destDir, `${safeTitle} (${i}).txt`); i++; }
    fs.writeFileSync(dest, text, 'utf-8');
    return { success: true, path: dest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 데스크톱 크롬과 동일한 UA로 보이게 - 일부 사이트(유튜브 등)가 낯선 UA의 임베드 요청을 다르게 취급하는 경우가 있음
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---- 뉴스 기사 등 일반 웹 링크 저장 - 서버가 응답한 HTML을 그대로 받아 제목/대표이미지/본문 문단을 추출해서 캐시한다 ----
// 핀터레스트/유튜브처럼 "임베드용 주소"를 공식 제공하지 않는 일반 사이트는 iframe으로 삽입해도 대부분
// X-Frame-Options/CSP로 막혀 있어(클릭재킹 방지 - 사이트 쪽에서 거는 보안 정책이라 우리 쪽 origin을 바꿔도 우회되지 않음)
// 그대로 보여줄 수 없다. 그래서 본문 텍스트만 추출해 앱 안에 "읽기 모드"로 캐시해두는 방식을 쓴다.
function fetchHtml(targetUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(targetUrl); } catch (err) { reject(err); return; }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(u, { headers: { 'User-Agent': DESKTOP_CHROME_UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, u).href;
        fetchHtml(nextUrl, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('status ' + res.statusCode)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf-8'), finalUrl: u.href }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('요청 시간 초과')));
  });
}
function decodeEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
function extractMeta(html, property) {
  // property="og:X" content="..." 순서든 content="..." property="og:X" 순서든 둘 다 잡아낸다
  let m = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'));
  if (m) return decodeEntities(m[1]);
  m = html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}
function extractArticle(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, '');
  const ogTitle = extractMeta(cleaned, 'og:title');
  const titleMatch = cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = ogTitle || (titleMatch ? decodeEntities(titleMatch[1]).trim() : '(제목 없음)');
  const image = extractMeta(cleaned, 'og:image');
  const description = extractMeta(cleaned, 'og:description');
  // <p> 문단들을 그대로 본문 후보로 삼는다 - 네비게이션/광고 문구처럼 너무 짧은 것은 걸러낸다
  const paragraphs = [];
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(cleaned)) && paragraphs.length < 60) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
    if (text.length >= 20) paragraphs.push(text);
  }
  return { title, image, excerpt: description, paragraphs };
}
ipcMain.handle('save-web-link', async (e, { destDir, url }) => {
  try {
    const { html, finalUrl } = await fetchHtml(url);
    const article = extractArticle(html);
    const safeTitle = (article.title || '링크').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    let dest = path.join(destDir, safeTitle + LINK_EXT);
    let i = 1;
    while (fs.existsSync(dest)) { dest = path.join(destDir, `${safeTitle} (${i})${LINK_EXT}`); i++; }
    fs.writeFileSync(dest, JSON.stringify({
      url: finalUrl, title: article.title, image: article.image,
      excerpt: article.excerpt, paragraphs: article.paragraphs, addedAt: Date.now()
    }, null, 2));
    return { success: true, path: dest, paragraphCount: article.paragraphs.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('read-web-link', (e, filePath) => {
  try { return { success: true, data: JSON.parse(fs.readFileSync(filePath, 'utf-8')) }; }
  catch (err) { return { success: false, error: err.message }; }
});

// ---- txt/md/docx 문서도 아이콘 대신 앱 안에서 바로 내용을 읽을 수 있게 ----
// docx는 사실 zip 압축 파일이라(안에 word/document.xml이 실제 본문), adm-zip 같은 별도 라이브러리를 새로 설치하는 대신
// Node에 내장된 zlib(압축 해제)만으로 필요한 최소한의 zip 파싱을 직접 구현했다. pdf는 이 방식이 통하지 않아(바이너리
// 포맷이 완전히 달라 별도의 pdf 파싱 라이브러리가 필요) 여기서는 지원하지 않고, 기존처럼 OS 기본 프로그램으로 연다.
function readZipEntryText(buf, entryName) {
  const EOCD_SIG = 0x06054b50;
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw new Error('zip 구조를 찾을 수 없음(문서가 손상되었거나 지원하지 않는 형식)');
  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);

  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('zip 중앙 디렉터리 파싱 실패');
    const compMethod = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf-8', pos + 46, pos + 46 + nameLen);
    if (name === entryName) {
      const lNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(dataStart, dataStart + compSize);
      const data = compMethod === 8 ? zlib.inflateRawSync(raw) : raw;
      return data.toString('utf-8');
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('word/document.xml을 찾지 못함 (정상적인 .docx 파일이 맞는지 확인해 주세요)');
}
function extractDocxText(filePath) {
  const buf = fs.readFileSync(filePath);
  const xml = readZipEntryText(buf, 'word/document.xml');
  const withBreaks = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n');
  const text = withBreaks.replace(/<[^>]+>/g, '');
  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim();
}
const TEXT_PREVIEW_MAX = 300000; // 너무 큰 파일을 통째로 렌더러에 넘기지 않도록 상한선
function readDocText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let content;
  if (ext === '.txt' || ext === '.md') {
    content = fs.readFileSync(filePath, 'utf-8');
  } else if (ext === '.docx') {
    content = extractDocxText(filePath);
  } else {
    throw new Error('미리보기를 지원하지 않는 형식(' + ext + ')');
  }
  const truncated = content.length > TEXT_PREVIEW_MAX;
  return { content: truncated ? content.slice(0, TEXT_PREVIEW_MAX) : content, truncated };
}
ipcMain.handle('read-doc-text', (e, filePath) => {
  try { return { success: true, ...readDocText(filePath) }; }
  catch (err) { return { success: false, error: err.message }; }
});
// 편집 기능: 미리보기는 앞부분만 잘라서 보여주지만(readDocText), 편집할 때는 전체 내용이 필요하다.
// docx는 바이너리 포맷이라 텍스트로 다시 써넣으면 파일이 깨지므로 txt/md만 허용한다.
ipcMain.handle('read-text-full', (e, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.txt' && ext !== '.md') throw new Error('편집은 txt/md 파일만 지원합니다.');
    return { success: true, content: fs.readFileSync(filePath, 'utf-8') };
  } catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('write-text-file', (e, { filePath, content }) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.txt' && ext !== '.md') throw new Error('편집은 txt/md 파일만 지원합니다.');
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});
let textWindows = [];
ipcMain.handle('open-text-window', (e, filePath) => {
  try {
    const { content, truncated } = readDocText(filePath);
    const title = path.basename(filePath);
    // docx는 바이너리 포맷을 텍스트로 다시 써넣으면 파일이 깨지므로(main.js의 write-text-file과
    // 동일한 기준) 편집 버튼 자체를 txt/md에서만 보여준다.
    const ext = path.extname(filePath).toLowerCase();
    const editable = ext === '.txt' || ext === '.md';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#1b1b1b;color:#e8e8e8;font-family:"Malgun Gothic",system-ui,sans-serif;line-height:1.7;}
      .wrap{max-width:760px;margin:0 auto;padding:28px 24px 60px;}
      .docHeader{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 16px;}
      h1{font-size:18px;color:#bbb;margin:0;word-break:break-all;}
      .docEditBtn{background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;font-family:inherit;flex-shrink:0;}
      .docEditBtn:hover{background:#3a3a3a;}
      pre{white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:14.5px;color:#ddd;margin:0;}
      #docEditor{display:none;width:100%;box-sizing:border-box;min-height:420px;background:#141414;color:#eee;border:1px solid #3a3a3a;border-radius:8px;padding:14px;font-family:inherit;font-size:14.5px;line-height:1.7;resize:vertical;}
      #docEditBar{display:none;align-items:center;gap:10px;margin-top:10px;}
      #docEditBar button{background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px;font-family:inherit;}
      #docEditBar button:hover{background:#3a3a3a;}
      #docSaveBtn{background:#2a5a2a;border-color:#4a8a4a;}
      #docSaveBtn:hover{background:#316831;}
      #docEditStatus{font-size:12px;color:#999;}
      .notice{color:#e0a050;font-size:12px;margin-top:16px;}
      ${ttsCss()}
      </style></head><body><div class="wrap">
      <div class="docHeader"><h1>${escapeHtmlMain(title)}</h1>${editable ? '<button id="docEditBtn" class="docEditBtn" title="이 문서를 직접 수정합니다">✏ 편집</button>' : ''}</div>
      ${ttsBarHtml()}
      <pre id="docPre">${escapeHtmlMain(content)}</pre>
      ${editable ? '<textarea id="docEditor" spellcheck="false"></textarea><div id="docEditBar"><button id="docSaveBtn">저장</button><button id="docCancelBtn">취소</button><span id="docEditStatus"></span></div>' : ''}
      ${truncated ? '<div class="notice">파일이 너무 커서 앞부분만 표시했습니다. (편집 시에는 전체 내용을 불러옵니다)</div>' : ''}
      </div>${ttsScript(content)}${editable ? docEditScript(filePath) : ''}</body></html>`;
    const win = new BrowserWindow({
      width: 760, height: 880, title,
      ...(centeredPosOnMain(760, 880) || {}),
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'tts-reader-preload.js') }
    });
    win.setMenuBarVisibility(false);
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    textWindows.push(win);
    const wcId = win.webContents.id;
    win.on('closed', () => { textWindows = textWindows.filter(w => w !== win); killTtsNativeProcess(wcId); });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

let embedWindows = [];

// file://나 data:는 브라우저가 Referer 헤더를 아예 안 보내거나 "출처 없음"으로 취급한다.
// 유튜브 임베드는 이 Referer/출처가 정상적인 http(s) 사이트여야 재생을 허용하는 것으로 보인다(오류 153의 실제 원인으로 추정).
// 그래서 실제 파일이 아니라, 컴퓨터 안에서만 도는 아주 작은 로컬 서버(127.0.0.1)로 페이지를 띄워 진짜 http 출처를 만들어준다.
function serveWrapperHtml(html) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

ipcMain.handle('open-embed-window', async (e, { embedUrl, title }) => {
  try {
    // 주소로 바로 이동(최상위 페이지로 열기)하면 유튜브 등 일부 사이트는 "진짜 iframe 안에 있는지"를 검사해서
    // 재생을 거부하므로, 실제 웹사이트에 심어둔 것과 똑같이 이 페이지 안에 진짜 <iframe>으로 한 번 감싼다.
    // 회색 기본 제목표시줄 대신, 나머지 앱들과 같은 톤의 커스텀 타이틀바(항상 위 핀 + 최소화/최대화/닫기)를 둔다.
    const wrapperHtml = `<!DOCTYPE html><html><head><style>
      html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:'Segoe UI',sans-serif;}
      body{display:flex;flex-direction:column;}
      /* 우리 자신의 창(타이틀바 등)에 스크롤이 생기는 경우를 대비한 스크롤바 스타일 - 다만 iframe 안의
         내용(핀터레스트/유튜브 페이지)은 다른 도메인 문서라 브라우저 보안 정책상 우리가 스타일을 입힐 수 없다 */
      ::-webkit-scrollbar{width:10px;height:10px;}
      ::-webkit-scrollbar-track{background:transparent;}
      ::-webkit-scrollbar-thumb{background:#383a43;border-radius:10px;border:2px solid transparent;background-clip:padding-box;}
      ::-webkit-scrollbar-thumb:hover{background:#4a4d58;background-clip:padding-box;}
      #titlebar{display:flex;align-items:center;height:30px;flex-shrink:0;background:#1d1f24;border-bottom:1px solid #34363f;-webkit-app-region:drag;}
      #titlebarSpace{flex:1;-webkit-app-region:drag;}
      #titlebarControls{display:flex;height:100%;-webkit-app-region:no-drag;}
      .tb-btn{width:38px;height:100%;border:0;background:transparent;color:#a7abb8;cursor:pointer;font-size:12px;
        line-height:1;display:flex;align-items:center;justify-content:center;transition:background .1s ease,color .1s ease;
        -webkit-app-region:no-drag;}
      .tb-btn:hover{background:#2e3038;color:#eceef3;}
      .tb-btn.tb-close:hover{background:#e5595e;color:#fff;}
      #pinBtn.tb-btn{font-size:13px;}
      #pinBtn.off{opacity:.45;}
      #videoWrap{flex:1;position:relative;}
      iframe{width:100%;height:100%;border:0;position:absolute;inset:0;}
      </style></head><body>
      <div id="titlebar">
        <button id="pinBtn" class="tb-btn" title="항상 위로 표시 켜기/끄기">📌</button>
        <div id="titlebarSpace"></div>
        <div id="titlebarControls">
          <button id="btnWinMin" class="tb-btn" title="최소화">&#xFF0D;</button>
          <button id="btnWinMax" class="tb-btn" title="최대화">&#x25A1;</button>
          <button id="btnWinClose" class="tb-btn tb-close" title="닫기">&#xD7;</button>
        </div>
      </div>
      <div id="videoWrap">
        <iframe src="${embedUrl.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
      </div>
      <script>
        const pinBtn = document.getElementById('pinBtn');
        pinBtn.onclick = async () => {
          const onTop = await window.embedAPI.toggleAlwaysOnTop();
          pinBtn.classList.toggle('off', !onTop);
        };
        document.getElementById('btnWinMin').onclick = () => window.embedAPI.minimize();
        document.getElementById('btnWinClose').onclick = () => window.embedAPI.close();
        const btnWinMax = document.getElementById('btnWinMax');
        btnWinMax.onclick = async () => {
          const maximized = await window.embedAPI.toggleMaximize();
          btnWinMax.title = maximized ? '이전 크기로' : '최대화';
        };
        document.getElementById('titlebar').ondblclick = (ev) => {
          if (ev.target.closest('.tb-btn')) return;
          btnWinMax.click();
        };
        window.embedAPI.onMaximizeChanged((maximized) => {
          btnWinMax.title = maximized ? '이전 크기로' : '최대화';
        });
        // 좌우반전(Ctrl+Alt+U) - 크로키·그리드·OBJ 배치 뷰어와 공통되는 단축키(2026-07-17 추가).
        // 처음엔 여기서 바로 window keydown으로 잡으려 했는데, 안의 iframe(핀터레스트/유튜브 등)이
        // 포커스를 가져간 상태에서는 부모 문서의 keydown 리스너로 전혀 전달되지 않아 안 먹혔다
        // (iframe은 별도의 브라우징 컨텍스트라 키 이벤트가 부모로 버블링되지 않음). 그래서 main
        // 프로세스가 before-input-event로 이 창의 입력을 통째로 가로채 신호를 보내주는 방식으로
        // 바꿨다(embed-preload.js의 embedAPI.onToggleMirror 참고).
        window.embedAPI.onToggleMirror(() => {
          const ifr = document.querySelector('#videoWrap iframe');
          if (!ifr) return;
          ifr.style.transform = ifr.style.transform === 'scaleX(-1)' ? '' : 'scaleX(-1)';
        });
      </script>
      </body></html>`;
    const server = await serveWrapperHtml(wrapperHtml);
    const port = server.address().port;

    const win = new BrowserWindow({
      width: 420, height: 650, title: title || '웹 임베드 재생', alwaysOnTop: true,
      ...(centeredPosOnMain(420, 650) || {}),
      frame: false, backgroundColor: '#000',
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, partition: 'persist:webembed',
        preload: path.join(__dirname, 'embed-preload.js')
      }
    });
    win.setMenuBarVisibility(false);
    win.webContents.setUserAgent(DESKTOP_CHROME_UA);
    win.loadURL(`http://127.0.0.1:${port}/`);
    win.on('maximize', () => win.webContents.send('window:maximize-changed', true));
    win.on('unmaximize', () => win.webContents.send('window:maximize-changed', false));
    // 좌우반전(Ctrl+Alt+U) - 안의 iframe이 포커스를 가진 상태에서도 확실히 잡히도록, DOM
    // keydown이 아니라 이 창의 입력 전체를 가로채는 before-input-event를 쓴다(iframe 포커스
    // 시 keydown이 부모 문서로 전달 안 되는 문제 회피).
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.control && input.alt && !input.meta && (input.key === 'u' || input.key === 'U')) {
        win.webContents.send('toggle-mirror');
      }
    });
    embedWindows.push(win);
    win.on('closed', () => {
      embedWindows = embedWindows.filter(w => w !== win);
      server.close();
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 그리드에서 동영상/웹 임베드를 여러 개 선택하고 "전체재생"을 누르면, 순서대로 이어서 재생되는 별도 창을 띄운다.
// 동영상(type:'video')은 file:// 주소를 그대로 재생하고 재생이 끝나면 자동으로 다음으로 넘어간다.
// 웹 임베드(type:'embed', 핀터레스트 등)는 외부 웹페이지를 iframe으로 불러오는 방식이라 재생 종료를 감지할 수 없으므로,
// 자동으로 넘어가지 않고 "다음" 버튼이나 목록 클릭으로만 넘어간다. (get-embed-preview-url과 같은 로컬 서버 감싸기 방식을 재사용)
let videoPlaylistWindows = [];
ipcMain.handle('open-video-playlist', async (e, items) => {
  try {
    if (!Array.isArray(items) || !items.length) return { success: false, error: '재생할 항목이 없습니다.' };
    const servers = [];
    const resolved = [];
    for (const it of items) {
      if (it.type === 'embed') {
        const wrapperHtml = `<!DOCTYPE html><html><head><style>html,body{margin:0;height:100%;background:#000;overflow:hidden;}iframe{width:100%;height:100%;border:0;}</style></head><body><iframe src="${String(it.embedUrl || '').replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>`;
        const server = await serveWrapperHtml(wrapperHtml);
        servers.push(server);
        resolved.push({ type: 'embed', url: `http://127.0.0.1:${server.address().port}/`, name: it.name });
      } else {
        resolved.push({ type: 'video', url: it.url, name: it.name });
      }
    }
    const listJson = JSON.stringify(resolved).replace(/</g, '\\u003c');
    // 상단 타이틀바/오른쪽 목록/하단 컨트롤은 동영상 위에 겹쳐지는 오버레이로 만들고, 평소엔 투명하게 숨겨뒀다가
    // 마우스가 움직일 때만 잠깐 나타나게 한다(움직임이 멈추면 다시 사라짐) - 이렇게 하면 마우스를 치우면 동영상만 보인다.
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:"Malgun Gothic",system-ui,sans-serif;}
      body{position:relative;cursor:default;}
      #stage{position:absolute;inset:0;background:#000;}
      video, #frame{width:100%;height:100%;border:0;background:#000;object-fit:contain;}

      .overlay{position:absolute;opacity:0;pointer-events:none;transition:opacity .18s ease;}
      .overlay.show{opacity:1;pointer-events:auto;}

      #titlebar{top:0;left:0;right:0;height:34px;display:flex;align-items:center;background:rgba(20,22,26,.92);border-bottom:1px solid rgba(255,255,255,.08);-webkit-app-region:drag;z-index:20;}
      #titlebarTitle{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#c7cad3;font-size:12px;padding-left:10px;-webkit-app-region:drag;}
      #titlebarControls{display:flex;height:100%;-webkit-app-region:no-drag;}
      .tb-btn{width:38px;height:100%;border:0;background:transparent;color:#a7abb8;cursor:pointer;font-size:12px;
        line-height:1;display:flex;align-items:center;justify-content:center;transition:background .1s ease,color .1s ease;
        -webkit-app-region:no-drag;}
      .tb-btn:hover{background:#2e3038;color:#eceef3;}
      .tb-btn.tb-close:hover{background:#e5595e;color:#fff;}
      #pinBtn.tb-btn{font-size:13px;}
      #pinBtn.off{opacity:.45;}

      #sidebar{top:0;right:0;bottom:0;width:280px;overflow-y:auto;background:rgba(15,15,15,.94);border-left:1px solid rgba(255,255,255,.08);padding-top:34px;z-index:16;}
      .item{padding:9px 12px;font-size:12.5px;color:#ccc;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .item:hover{background:rgba(255,255,255,.06);}
      .item.active{background:#2b3a52;color:#fff;}

      #controls{left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;padding:14px;background:linear-gradient(transparent, rgba(0,0,0,.85));z-index:15;}
      #controls button{background:rgba(255,255,255,.1);color:#eee;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;}
      #controls button:hover{background:rgba(255,255,255,.18);}
      #counter{font-size:12px;color:#ccc;margin-left:auto;}
      </style></head><body>
      <div id="stage">
        <video id="vid" controls style="display:none;"></video>
        <iframe id="frame" style="display:none;" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>
      </div>

      <div id="titlebar" class="overlay">
        <button id="pinBtn" class="tb-btn" title="항상 위로 표시 켜기/끄기">📌</button>
        <div id="titlebarTitle"></div>
        <div id="titlebarControls">
          <button id="btnWinMin" class="tb-btn" title="최소화">&#xFF0D;</button>
          <button id="btnWinMax" class="tb-btn" title="최대화">&#x25A1;</button>
          <button id="btnWinClose" class="tb-btn tb-close" title="닫기">&#xD7;</button>
        </div>
      </div>
      <div id="sidebar" class="overlay"></div>
      <div id="controls" class="overlay">
        <button id="btnPrev">◀ 이전</button>
        <button id="btnNext">다음 ▶</button>
        <span id="counter"></span>
      </div>

      <script>
        const items = ${listJson};
        let idx = 0;
        const vid = document.getElementById('vid');
        const frame = document.getElementById('frame');
        const sidebar = document.getElementById('sidebar');
        const counter = document.getElementById('counter');
        const titlebarTitle = document.getElementById('titlebarTitle');
        function renderSidebar() {
          sidebar.innerHTML = items.map((it,i) => '<div class="item' + (i===idx?' active':'') + '" data-i="' + i + '">' + (i+1) + '. ' + (it.type==='embed'?'🔗 ':'▶ ') + it.name.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</div>').join('');
          sidebar.querySelectorAll('.item').forEach(el => el.onclick = () => { idx = parseInt(el.dataset.i); load(); });
        }
        function load() {
          const it = items[idx];
          if (it.type === 'embed') {
            vid.pause(); vid.removeAttribute('src'); vid.style.display = 'none';
            frame.style.display = 'block';
            frame.src = it.url;
          } else {
            frame.style.display = 'none'; frame.src = 'about:blank';
            vid.style.display = 'block';
            vid.src = it.url;
            vid.play().catch(()=>{});
          }
          counter.textContent = (idx+1) + ' / ' + items.length + (it.type==='embed' ? ' · 임베드(수동 이동)' : '');
          titlebarTitle.textContent = (idx+1) + '/' + items.length + ' · ' + it.name;
          renderSidebar();
        }
        // 동영상이 끝나면 자동으로 다음으로 넘어간다. 임베드는 재생 종료를 알 수 없어 자동으로 넘기지 않는다.
        vid.addEventListener('ended', () => { if (idx < items.length - 1) { idx++; load(); } });
        document.getElementById('btnPrev').onclick = () => { idx = Math.max(0, idx-1); load(); };
        document.getElementById('btnNext').onclick = () => { idx = Math.min(items.length-1, idx+1); load(); };
        load();

        // ---- 마우스를 움직일 때만 타이틀바/목록/컨트롤을 잠깐 보여주고, 가만히 있으면 동영상만 남기고 사라진다 ----
        const overlays = [document.getElementById('titlebar'), sidebar, document.getElementById('controls')];
        let hideTimer = null;
        function scheduleHide() {
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            if (overlays.some(el => el.matches(':hover'))) { scheduleHide(); return; }
            overlays.forEach(el => el.classList.remove('show'));
          }, 2200);
        }
        function showOverlays() {
          overlays.forEach(el => el.classList.add('show'));
          scheduleHide();
        }
        document.addEventListener('mousemove', showOverlays);
        showOverlays();

        // ---- 커스텀 타이틀바 버튼(핀/최소화/최대화/닫기) - embed-preload.js가 열어둔 window.embedAPI 재사용 ----
        const pinBtn = document.getElementById('pinBtn');
        pinBtn.onclick = async () => {
          const onTop = await window.embedAPI.toggleAlwaysOnTop();
          pinBtn.classList.toggle('off', !onTop);
        };
        document.getElementById('btnWinMin').onclick = () => window.embedAPI.minimize();
        document.getElementById('btnWinClose').onclick = () => window.embedAPI.close();
        const btnWinMax = document.getElementById('btnWinMax');
        btnWinMax.onclick = async () => {
          const maximized = await window.embedAPI.toggleMaximize();
          btnWinMax.title = maximized ? '이전 크기로' : '최대화';
        };
        document.getElementById('titlebar').ondblclick = (ev) => {
          if (ev.target.closest('.tb-btn')) return;
          btnWinMax.click();
        };
        window.embedAPI.onMaximizeChanged((maximized) => {
          btnWinMax.title = maximized ? '이전 크기로' : '최대화';
        });
      </script>
      </body></html>`;
    const win = new BrowserWindow({
      width: 980, height: 640, title: '전체재생 (' + resolved.length + '개)', backgroundColor: '#000', frame: false,
      ...(centeredPosOnMain(980, 640) || {}),
      // 메인 창처럼 file:// 로컬 동영상을 문제없이 재생하려면 webSecurity를 꺼야 하고,
      // 커스텀 타이틀바(핀/최소화/최대화/닫기)가 동작하려면 embed-preload.js가 열어둔 window.embedAPI가 필요하다.
      webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: false, preload: path.join(__dirname, 'embed-preload.js') }
    });
    win.setMenuBarVisibility(false);
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.on('maximize', () => win.webContents.send('window:maximize-changed', true));
    win.on('unmaximize', () => win.webContents.send('window:maximize-changed', false));
    videoPlaylistWindows.push(win);
    win.on('closed', () => {
      videoPlaylistWindows = videoPlaylistWindows.filter(w => w !== win);
      servers.forEach(s => { try { s.close(); } catch {} });
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('toggle-embed-always-on-top', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'screen-saver');
  return next;
});

// 상세 패널의 인라인 미리보기용 - 팝업 창과 같은 이유(file:// 출처 문제)로 같은 로컬 서버 방식을 재사용한다.
// 상세 패널은 한 번에 하나만 보이므로, 새 항목을 선택하면 이전 서버는 닫고 새 서버 하나만 유지한다.
let currentDetailEmbedServer = null;
ipcMain.handle('get-embed-preview-url', async (e, { embedUrl }) => {
  try {
    if (currentDetailEmbedServer) {
      try { currentDetailEmbedServer.close(); } catch {}
      currentDetailEmbedServer = null;
    }
    const wrapperHtml = `<!DOCTYPE html><html><head><style>html,body{margin:0;height:100%;background:#000;overflow:hidden;}iframe{width:100%;height:100%;border:0;}</style></head><body><iframe src="${embedUrl.replace(/"/g, '&quot;')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>`;
    const server = await serveWrapperHtml(wrapperHtml);
    currentDetailEmbedServer = server;
    const port = server.address().port;
    return { success: true, url: `http://127.0.0.1:${port}/` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- 저장해둔 링크(기사 등)를 "읽기 모드" 창으로 열기 ----
// 여기서 보여주는 내용은 저장 시점에 추출해둔 우리 자신의 텍스트/이미지일 뿐이라(제3자 iframe이 아님),
// 유튜브 때와 달리 로컬 서버로 감쌀 필요 없이 data: URL로 바로 띄워도 문제 없다.
function escapeHtmlMain(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- 문서/기사 읽기 창용 TTS(음성 읽기) ----
// "읽기 모드" 창(open-text-window/open-link-window)이 data: URL로 뜨는 별도 창이라 렌더러
// 프로세스 코드를 공유하기 어렵다. 대신 각 창의 HTML에 그대로 심을 수 있는 문자열(CSS/버튼바/스크립트)을
// 만드는 공용 함수로 빼서 두 창(txt/md/docx 읽기 창, 저장된 기사 읽기 창)이 똑같이 재사용한다.
function ttsCss() {
  return `.ttsBar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:0 0 14px;margin-bottom:14px;border-bottom:1px solid #333;}
    .ttsBar button{background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;font-family:inherit;}
    .ttsBar button:hover:not(:disabled){background:#3a3a3a;}
    .ttsBar button:disabled{opacity:.4;cursor:default;}
    .ttsBar button.active{background:#3a5a8a;border-color:#5a80c0;}
    .ttsStatus{font-size:12px;color:#999;}
    .ttsSnippet{font-size:12.5px;color:#aaa;margin:-6px 0 14px;line-height:1.6;min-height:1.6em;word-break:break-word;}
    mark.ttsHi{background:#3a5a8a;color:#fff;padding:0 1px;border-radius:2px;}
    .ttsSettings{display:none;flex-direction:column;gap:10px;background:#232323;border:1px solid #3a3a3a;border-radius:10px;padding:12px 14px;margin:-4px 0 14px;font-size:13px;}
    .ttsSettings.show{display:flex;}
    .ttsSettings label{display:flex;flex-direction:column;gap:4px;color:#bbb;font-size:12px;}
    .ttsSettings select{background:#2a2a2a;border:1px solid #444;color:#eee;border-radius:6px;padding:6px;font-size:12.5px;font-family:inherit;}
    .ttsSettings .row{display:flex;align-items:center;gap:10px;}
    .ttsSettings .row input[type=range]{flex:1;}
    .ttsSettings .rowVal{min-width:32px;text-align:right;color:#ccc;font-variant-numeric:tabular-nums;font-size:12px;}
    .ttsDownload{display:flex;flex-direction:column;gap:6px;padding-top:6px;border-top:1px solid #3a3a3a;}
    .ttsDownload p{margin:0;font-size:11.5px;color:#888;line-height:1.5;}
    .ttsDownload button{align-self:flex-start;background:#3a2a1a;border-color:#7a5a2a;}
    .ttsDownload button:hover{background:#4a3520;}`;
}
function ttsBarHtml() {
  return `<div class="ttsBar">
      <button id="ttsPlay">▶ 읽기</button>
      <button id="ttsPause" disabled>⏸ 일시정지</button>
      <button id="ttsStop" disabled>■ 정지</button>
      <button id="ttsSettingsBtn" title="음성/속도 설정">⚙ 설정</button>
      <span class="ttsStatus" id="ttsStatus"></span>
    </div>
    <div class="ttsSnippet" id="ttsSnippet"></div>
    <div class="ttsSettings" id="ttsSettings">
      <label>음성(엔진)
        <select id="ttsVoice"><option value="">불러오는 중...</option></select>
      </label>
      <div class="row"><span style="width:52px;color:#bbb;font-size:12px;">속도</span><input type="range" id="ttsRate" min="0.5" max="2" step="0.1" value="0.95"><span class="rowVal" id="ttsRateVal">0.95x</span></div>
      <div class="row"><span style="width:52px;color:#bbb;font-size:12px;">음높이</span><input type="range" id="ttsPitch" min="0" max="2" step="0.1" value="0.85"><span class="rowVal" id="ttsPitchVal">0.85</span></div>
      <p style="margin:0;font-size:11px;color:#777;">쇳소리가 심하면 음높이를 더 내려보세요(0.7~0.8 권장 구간).</p>
      <div class="row"><span style="width:52px;color:#bbb;font-size:12px;">볼륨</span><input type="range" id="ttsVolume" min="0" max="1" step="0.05" value="1"><span class="rowVal" id="ttsVolumeVal">100%</span></div>
      <div class="ttsDownload">
        <p>이 목록은 브라우저가 아니라 윈도우에 설치된 모든 음성(PowerShell과 동일한 방식)을 직접 읽어옵니다. 윈도우 설정에서 새 음성을 받은 뒤 이 창을 다시 열면 목록에 자동으로 나타납니다.</p>
        <button type="button" id="ttsGetVoice">고음질 음성 받기 (Windows 설정 열기)</button>
      </div>
    </div>`;
}
function ttsScript(text) {
  // 문서 내용 안에 "</script>" 같은 문자열이 섞여 있으면 HTML 파서가 스크립트 태그를 거기서
  // 조기 종료시켜버린다. JSON.stringify로 안전하게 문자열화한 뒤 '<'만 유니코드 이스케이프로
  // 바꿔서 심으면(런타임엔 정상적으로 '<' 문자로 해석됨) 이 문제를 막을 수 있다.
  const safe = JSON.stringify(text || '').replace(/</g, '\\u003C');
  return `<script>(function(){
      var fullText = ${safe};
      var playBtn = document.getElementById('ttsPlay');
      var pauseBtn = document.getElementById('ttsPause');
      var stopBtn = document.getElementById('ttsStop');
      var settingsBtn = document.getElementById('ttsSettingsBtn');
      var settingsPanel = document.getElementById('ttsSettings');
      var voiceSel = document.getElementById('ttsVoice');
      var rateRange = document.getElementById('ttsRate');
      var pitchRange = document.getElementById('ttsPitch');
      var volRange = document.getElementById('ttsVolume');
      var rateVal = document.getElementById('ttsRateVal');
      var pitchVal = document.getElementById('ttsPitchVal');
      var volVal = document.getElementById('ttsVolumeVal');
      var getVoiceBtn = document.getElementById('ttsGetVoice');
      var statusEl = document.getElementById('ttsStatus');
      var snippetEl = document.getElementById('ttsSnippet');
      // txt/md 읽기 창(open-text-window)에는 <pre>가 있어 그 안에서 실제로 하이라이트할 수 있지만,
      // 저장된 기사 읽기 창(open-link-window)은 <p> 여러 개로 구조가 달라 <pre>가 없다 - 그런 경우엔
      // preEl이 null이 되어 아래에서 자동으로 건너뛰고, 버튼바 밑 한 줄짜리 스니펫(ttsSnippet)만 쓴다.
      var preEl = document.querySelector('pre');
      var preOriginalHtml = preEl ? preEl.innerHTML : null;
      // 2026-07-28: 편집 모드(아래 별도 스크립트)가 저장에 성공하면 이 함수로 방금 저장한 내용을
      // 알려준다 - fullText(TTS가 읽는 대상)와 pre 원본(하이라이트 초기화 기준)을 새 내용으로 갱신해서,
      // 창을 새로 열지 않고도 그 자리에서 바로 수정된 내용을 읽을 수 있게 한다.
      window.__ttsSetText = function(t){
        fullText = t;
        if (preEl) { preEl.textContent = t; preOriginalHtml = preEl.innerHTML; }
      };
      var saved = {}; // ttsAPI(설정 저장 통로)가 없는 예전 창/오류 상황에서도 안전하게 동작하도록 빈 값으로 시작
      var hasNativeApi = !!(window.ttsAPI && window.ttsAPI.nativeSpeak);

      function setStatus(t){ statusEl.textContent = t; }
      function escapeForHi(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
      function clearHighlight(){
        if (preEl && preOriginalHtml !== null) preEl.innerHTML = preOriginalHtml;
        if (snippetEl) snippetEl.innerHTML = '';
      }
      function highlightRange(pos, len){
        if (!fullText) return;
        pos = Math.max(0, Math.min(pos, fullText.length));
        len = Math.max(0, Math.min(len, fullText.length - pos));
        var before = fullText.slice(0, pos);
        var chunk = fullText.slice(pos, pos + len);
        var after = fullText.slice(pos + len);
        if (snippetEl) {
          var ctxBefore = before.slice(-30).replace(/\\s+/g, ' ');
          var shown = chunk.length > 90 ? chunk.slice(0, 90).replace(/\\s+/g, ' ') + '…' : chunk.replace(/\\s+/g, ' ');
          snippetEl.innerHTML = '…' + escapeForHi(ctxBefore) + '<mark class="ttsHi">' + escapeForHi(shown) + '</mark>';
        }
        if (preEl) {
          preEl.innerHTML = escapeForHi(before) + '<mark class="ttsHi" id="ttsHiMark">' + escapeForHi(chunk) + '</mark>' + escapeForHi(after);
          var markEl = document.getElementById('ttsHiMark');
          if (markEl) {
            var r = markEl.getBoundingClientRect();
            if (r.top < 80 || r.bottom > window.innerHeight - 40) markEl.scrollIntoView({ block: 'center', behavior: 'auto' });
          }
        }
      }
      // 2026-07-22(4차): "읽는 위치 표시"를 문장/줄 단위로 잘라 조각마다 SPEAK를 반복 호출하고
      // PowerShell의 State 폴링(DONE 감지)으로 진행을 따라가는 방식으로 두 번 만들었는데, 둘 다
      // 결국 문제가 있었다. 짧은 조각(제목 한 줄, "①" 같은 표시 등)은 실제 재생이 순식간에 끝나서
      // 폴링 주기(30ms)보다 빨리 끝나버리면, PowerShell 쪽이 "재생 중"이라는 상태 자체를 한 번도
      // 못 보고 지나친다. 그 사이 일시정지를 누르면 "지금 재생 중인 게 없다"는 오류가 돌아와
      // 화면이 초기화되고, 결국 일시정지가 안 먹는 것처럼 보였다. 조각을 굵게 잘라도, PC 성능이나
      // 음성 엔진에 따라 같은 문제가 다시 나타날 수 있는 구조적인 한계였다.
      // 그래서 이번엔 접근을 바꾼다: PowerShell 쪽에는 조각 없이 문서 전체를 한 번에 읽게 하고(이
      // 방식은 지금까지 한 번도 문제가 없었다), "지금 읽는 위치"는 재생 속도로 추정한 위치를
      // 타이머로 따라가며 표시한다. 정확히 단어 단위까지 딱 맞지는 않지만, 재생 자체(재생/일시정지/
      // 정지)는 PowerShell의 정밀한 조각별 상태 추적에 더 이상 의존하지 않으므로 훨씬 안정적이다.
      function resetUi(){ playBtn.disabled = false; pauseBtn.disabled = true; stopBtn.disabled = true; pauseBtn.textContent = '⏸ 일시정지'; stopEstimate(); }

      // 한국어 TTS 기준 대략적인 초당 글자 수 - 정확한 값이 아니라 "위치를 대충 따라가기" 위한 추정치.
      var ESTIMATE_CPS_BASE = 7;
      var estTimer = null;
      var estStartTs = 0;      // 이번에 재생/재개된 시점(Date.now())
      var estElapsedMs = 0;    // 일시정지 이전까지 누적된 재생 시간(ms)
      function estimatedCps(){
        var rate = parseFloat(rateRange.value); if (isNaN(rate) || rate <= 0) rate = 1;
        return ESTIMATE_CPS_BASE * rate;
      }
      function tickEstimate(){
        if (!fullText) return;
        var elapsedMs = estElapsedMs + (Date.now() - estStartTs);
        var pos = Math.floor((elapsedMs / 1000) * estimatedCps());
        if (pos >= fullText.length) return; // 문서 끝을 넘어서면(추정이라 DONE보다 먼저 넘을 수 있음) 더는 갱신 안 함
        try { highlightRange(pos, Math.min(40, fullText.length - pos)); } catch (err) { console.log('[HIGHLIGHT-ERR]', err); }
      }
      function startEstimate(){
        estStartTs = Date.now();
        if (estTimer) clearInterval(estTimer);
        estTimer = setInterval(tickEstimate, 200);
        tickEstimate();
      }
      function pauseEstimate(){
        if (estTimer) { clearInterval(estTimer); estTimer = null; }
        estElapsedMs += Date.now() - estStartTs;
      }
      function stopEstimate(){
        if (estTimer) { clearInterval(estTimer); estTimer = null; }
        estElapsedMs = 0;
        clearHighlight();
      }
      function speakAll(){
        var rate = parseFloat(rateRange.value); if (isNaN(rate)) rate = 1;
        var pitch = parseFloat(pitchRange.value); if (isNaN(pitch)) pitch = 1;
        var volume = parseFloat(volRange.value); if (isNaN(volume)) volume = 1;
        window.ttsAPI.nativeSpeak({ text: fullText, voiceName: voiceSel.value, rate: rate, pitch: pitch, volume: volume }).then(function(res){
          if (!res || !res.success) { resetUi(); setStatus('재생 실패: ' + ((res && res.error) || '')); }
        });
      }

      settingsBtn.addEventListener('click', function(){
        settingsPanel.classList.toggle('show');
        settingsBtn.classList.toggle('active', settingsPanel.classList.contains('show'));
      });

      // 음성 목록을 브라우저(speechSynthesis.getVoices)가 아니라 윈도우에 설치된 SAPI5 음성
      // 전체를 PowerShell로 직접 조회해서 채운다 - 크롬이 걸러내는 음성도 여기엔 다 나온다.
      function populateVoices(){
        if (!hasNativeApi) return;
        window.ttsAPI.nativeListVoices().then(function(res){
          var names = (res && res.success && res.voices) ? res.voices : [];
          var sorted = names.slice().sort(function(a, b){ return a.localeCompare(b); });
          var prevValue = voiceSel.value || saved.voiceName || '';
          voiceSel.innerHTML = '<option value="">(시스템 기본 음성)</option>' + sorted.map(function(name){
            var esc = name.replace(/"/g,'&quot;').replace(/</g,'&lt;');
            return '<option value="' + esc + '">' + esc + '</option>';
          }).join('');
          if (prevValue && sorted.indexOf(prevValue) >= 0) voiceSel.value = prevValue;
          if (!res || !res.success) setStatus('음성 목록을 불러오지 못했습니다: ' + ((res && res.error) || ''));
        }).catch(function(){ setStatus('음성 목록을 불러오지 못했습니다.'); });
      }
      populateVoices();

      function applyLoadedSettings(cfg){
        saved = cfg || {};
        if (saved.rate) { rateRange.value = saved.rate; }
        if (saved.pitch) { pitchRange.value = saved.pitch; }
        if (typeof saved.volume === 'number') { volRange.value = saved.volume; }
        rateVal.textContent = parseFloat(rateRange.value).toFixed(1) + 'x';
        pitchVal.textContent = parseFloat(pitchRange.value).toFixed(1);
        volVal.textContent = Math.round(parseFloat(volRange.value) * 100) + '%';
        if (saved.voiceName) populateVoices();
      }
      // 지난번에 저장해둔 음성/속도/음높이/볼륨을 불러와 이 창에도 그대로 적용한다(설정은 문서마다가 아니라 앱 전체 공용).
      if (window.ttsAPI && window.ttsAPI.getConfig) {
        window.ttsAPI.getConfig().then(applyLoadedSettings).catch(function(){});
      }

      function persist(partial){
        Object.assign(saved, partial);
        if (window.ttsAPI && window.ttsAPI.setConfig) window.ttsAPI.setConfig(partial).catch(function(){});
      }
      rateRange.addEventListener('input', function(){ rateVal.textContent = parseFloat(rateRange.value).toFixed(1) + 'x'; });
      rateRange.addEventListener('change', function(){ persist({ rate: parseFloat(rateRange.value) }); });
      pitchRange.addEventListener('input', function(){ pitchVal.textContent = parseFloat(pitchRange.value).toFixed(1); });
      pitchRange.addEventListener('change', function(){ persist({ pitch: parseFloat(pitchRange.value) }); });
      volRange.addEventListener('input', function(){ volVal.textContent = Math.round(parseFloat(volRange.value) * 100) + '%'; });
      volRange.addEventListener('change', function(){ persist({ volume: parseFloat(volRange.value) }); });
      voiceSel.addEventListener('change', function(){ persist({ voiceName: voiceSel.value }); });
      getVoiceBtn.addEventListener('click', function(){
        if (window.ttsAPI && window.ttsAPI.openVoiceSettings) window.ttsAPI.openVoiceSettings();
        else setStatus('이 창에서는 윈도우 설정을 열 수 없습니다.');
      });

      if (!hasNativeApi || !fullText.trim()) {
        playBtn.disabled = true;
        setStatus(fullText.trim() ? '이 창에서는 음성 읽기를 지원하지 않습니다.' : '읽을 내용이 없습니다.');
      } else {
        if (window.ttsAPI.onNativeStatus) {
          window.ttsAPI.onNativeStatus(function(status){
            console.log('[tts-native-status]', status);
            if (status === 'SPEAKING') {
              playBtn.disabled = true; pauseBtn.disabled = false; stopBtn.disabled = false;
              pauseBtn.textContent = '⏸ 일시정지'; setStatus('읽는 중...');
              startEstimate(); // 재생 시작이든, 일시정지 후 재개든 여기서 공통으로 처리된다
            } else if (status === 'PAUSED') {
              pauseBtn.textContent = '▶ 이어읽기'; setStatus('일시정지됨');
              pauseEstimate();
            } else if (status === 'DONE') {
              resetUi(); setStatus('읽기 완료');
            } else if (status === 'STOPPED') {
              resetUi(); setStatus('정지됨');
            } else if (status && status.indexOf('ERROR') === 0) {
              resetUi(); setStatus('오류: ' + status.slice(status.indexOf(':') + 1));
            }
          });
        }
        playBtn.addEventListener('click', function(){
          setStatus('읽는 중...');
          playBtn.disabled = true; pauseBtn.disabled = false; stopBtn.disabled = false;
          speakAll();
        });
        pauseBtn.addEventListener('click', function(){
          // 클릭 자체가 안 먹히는 건지, 클릭은 되는데 뒷단이 문제인 건지 구분하려는 진단용 로그 -
          // IPC 응답을 기다리지 않고 클릭 즉시 무조건 찍힌다.
          console.log('[PAUSE-CLICKED] disabled=', pauseBtn.disabled, 'label=', pauseBtn.textContent);
          var call = (pauseBtn.textContent.indexOf('이어읽기') >= 0) ? window.ttsAPI.nativeResume() : window.ttsAPI.nativePause();
          // 실패했을 때 오류 문구만 띄우고 버튼 상태는 그대로 두면, 재생 중이던 모습(비활성화된
          // 버튼들) 그대로 멈춰버린다. 뒷단 세션 상태를 더는 신뢰할 수 없으니, 실패 시엔 무조건
          // 처음(정지된) 상태로 되돌려 최소한 "읽기"는 다시 누를 수 있게 한다.
          call.then(function(res){
            console.log('[PAUSE-RESULT]', res);
            if (res && res.success === false) { setStatus('오류: ' + res.error); resetUi(); }
          }).catch(function(err){
            console.log('[PAUSE-ERR]', err); setStatus('오류: ' + err.message); resetUi();
          });
        });
        stopBtn.addEventListener('click', function(){
          console.log('[STOP-CLICKED] disabled=', stopBtn.disabled);
          // "정지"는 사용자 입장에서 결과가 항상 "안 읽는 상태"여야 하므로, 백엔드 응답을 기다리지
          // 않고 클릭 즉시 화면부터 정리한다(낙관적 갱신) - 실제 백엔드 정지는 그 뒤에 이어서
          // 요청하되, 거기서 나는 오류는 화면에 영향 없이 콘솔에만 남긴다.
          resetUi();
          setStatus('정지됨');
          window.ttsAPI.nativeStop().then(function(res){
            console.log('[STOP-RESULT]', res);
            if (res && res.success === false) console.log('[STOP-SOFT-ERR]', res.error);
          }).catch(function(err){ console.log('[STOP-ERR]', err); });
        });
        window.addEventListener('beforeunload', function(){ window.ttsAPI.nativeStop(); });
      }
    })();<\/script>`;
}

// 2026-07-28: "읽기 모드" 창에 편집 기능 추가 - txt/md 문서를 다른 프로그램으로 안 옮기고 이 창에서
// 바로 고칠 수 있게 한다. open-text-window에서 ext가 txt/md일 때만(editable) 이 스크립트를 붙인다.
// 미리보기(readDocText)는 큰 파일이면 앞부분만 잘라서 보여주므로, 편집 시작 시점에는 항상
// read-text-full로 전체 내용을 다시 받아온다 - 그래야 저장할 때 뒷부분이 잘려나가지 않는다.
function docEditScript(filePath) {
  const safePath = JSON.stringify(filePath);
  return `<script>(function(){
      var filePath = ${safePath};
      var editBtn = document.getElementById('docEditBtn');
      if (!editBtn) return;
      var preEl = document.getElementById('docPre');
      var editor = document.getElementById('docEditor');
      var editBar = document.getElementById('docEditBar');
      var saveBtn = document.getElementById('docSaveBtn');
      var cancelBtn = document.getElementById('docCancelBtn');
      var statusEl = document.getElementById('docEditStatus');
      var ttsBar = document.querySelector('.ttsBar');
      var ttsSnippet = document.querySelector('.ttsSnippet');
      var ttsSettings = document.getElementById('ttsSettings');
      var editing = false;

      function enterEdit(content){
        editor.value = content;
        preEl.style.display = 'none';
        editor.style.display = 'block';
        editBar.style.display = 'flex';
        editBtn.style.display = 'none';
        if (ttsBar) ttsBar.style.display = 'none';
        if (ttsSnippet) ttsSnippet.style.display = 'none';
        if (ttsSettings) ttsSettings.classList.remove('show');
        editing = true;
        editor.focus();
      }
      function exitEdit(){
        preEl.style.display = '';
        editor.style.display = 'none';
        editBar.style.display = 'none';
        editBtn.style.display = '';
        if (ttsBar) ttsBar.style.display = '';
        if (ttsSnippet) ttsSnippet.style.display = '';
        editing = false;
        statusEl.textContent = '';
      }

      editBtn.addEventListener('click', function(){
        // 편집하는 동안 TTS가 옛 내용을 계속 읽고 있으면 혼란스러우니 먼저 멈춘다.
        window.ttsAPI.nativeStop().catch(function(){});
        editBtn.disabled = true;
        window.ttsAPI.readTextFull(filePath).then(function(res){
          editBtn.disabled = false;
          if (!res || !res.success) { alert('불러오기 실패: ' + ((res && res.error) || '알 수 없는 오류')); return; }
          enterEdit(res.content);
        });
      });
      cancelBtn.addEventListener('click', exitEdit);
      saveBtn.addEventListener('click', function(){
        saveBtn.disabled = true;
        statusEl.textContent = '저장 중...';
        window.ttsAPI.writeTextFile({ filePath: filePath, content: editor.value }).then(function(res){
          saveBtn.disabled = false;
          if (!res || !res.success) { statusEl.textContent = '저장 실패: ' + ((res && res.error) || '알 수 없는 오류'); return; }
          if (window.__ttsSetText) window.__ttsSetText(editor.value);
          exitEdit();
        });
      });
      // 저장하지 않고 창을 닫으면 수정 내용을 잃으니, 편집 중일 때만 확인을 한 번 받는다.
      window.addEventListener('beforeunload', function(e){
        if (editing) { e.preventDefault(); e.returnValue = ''; }
      });
    })();<\/script>`;
}

let linkWindows = [];
ipcMain.handle('open-link-window', (e, { filePath }) => {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const bodyHtml = (data.paragraphs && data.paragraphs.length)
      ? data.paragraphs.map(p => `<p>${escapeHtmlMain(p)}</p>`).join('\n')
      : `<p class="muted">${escapeHtmlMain(data.excerpt || '본문을 자동으로 가져오지 못했습니다. 아래 원문 링크에서 확인해 주세요.')}</p>`;
    // TTS로 읽을 순수 텍스트 - 제목 + 문단(있으면)만. 요약(excerpt)만 있는 경우엔 그것만 읽는다.
    const ttsText = [data.title, ...((data.paragraphs && data.paragraphs.length) ? data.paragraphs : (data.excerpt ? [data.excerpt] : []))]
      .filter(Boolean).join('\n\n');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#1b1b1b;color:#e8e8e8;font-family:"Malgun Gothic",system-ui,sans-serif;line-height:1.7;}
      .wrap{max-width:720px;margin:0 auto;padding:28px 24px 60px;}
      h1{font-size:22px;line-height:1.4;margin:0 0 14px;}
      img.hero{width:100%;border-radius:8px;margin-bottom:16px;background:#111;}
      p{font-size:15px;margin:0 0 14px;color:#ddd;}
      p.muted{color:#999;font-style:italic;}
      a.src{display:inline-block;margin-top:10px;color:#6a9bd8;text-decoration:none;font-size:13px;}
      a.src:hover{text-decoration:underline;}
      ${ttsCss()}
      </style></head><body><div class="wrap">
      <h1>${escapeHtmlMain(data.title || '')}</h1>
      ${ttsBarHtml()}
      ${data.image ? `<img class="hero" src="${escapeHtmlMain(data.image)}">` : ''}
      ${bodyHtml}
      <a class="src" href="${escapeHtmlMain(data.url)}" target="_blank">원문에서 보기 ↗</a>
      </div>${ttsScript(ttsText)}</body></html>`;

    const win = new BrowserWindow({
      width: 760, height: 880, title: data.title || '읽기 모드',
      ...(centeredPosOnMain(760, 880) || {}),
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'tts-reader-preload.js') }
    });
    win.setMenuBarVisibility(false);
    // 본문 안의 "원문에서 보기" 링크(target=_blank)는 앱 안에 새 창을 띄우는 대신 기본 브라우저로 연다
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    linkWindows.push(win);
    const wcId2 = win.webContents.id;
    win.on('closed', () => { linkWindows = linkWindows.filter(w => w !== win); killTtsNativeProcess(wcId2); });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- 파일 작업 ----
ipcMain.handle('show-in-explorer', (e, filePath) => { shell.showItemInFolder(filePath); return true; });
ipcMain.handle('trash-file', async (e, filePath) => {
  try { await shell.trashItem(filePath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('create-folder', (e, { parentDir, name }) => {
  const full = path.join(parentDir, name);
  try { fs.mkdirSync(full); return { success: true, path: full }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('delete-folder', async (e, folderPath) => {
  try { await shell.trashItem(folderPath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});
ipcMain.handle('rename-folder', (e, { oldPath, newName }) => {
  const newPath = path.join(path.dirname(oldPath), newName);
  try { fs.renameSync(oldPath, newPath); return { success: true, path: newPath }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('rename-file', (e, { oldPath, newName }) => {
  try {
    const destPath = path.join(path.dirname(oldPath), newName);
    if (destPath === oldPath) return { success: true, path: destPath };
    if (fs.existsSync(destPath)) return { success: false, error: '같은 이름의 파일이 이미 있습니다.' };
    fs.renameSync(oldPath, destPath);
    // 웹 임베드(.pinembed)/링크(.weblink)는 그리드에 실제 파일명 대신 파일 안에 저장된 title을 보여주므로,
    // 파일명만 바꾸면 그리드에는 반영되지 않는다. 이름을 바꿀 때 안의 title도 같이 맞춰준다.
    const ext = path.extname(destPath).toLowerCase();
    if (ext === EMBED_EXT || ext === LINK_EXT) {
      try {
        const meta = JSON.parse(fs.readFileSync(destPath, 'utf-8'));
        meta.title = path.basename(destPath, ext);
        fs.writeFileSync(destPath, JSON.stringify(meta, null, 2));
      } catch {}
    }
    return { success: true, path: destPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 폴더를 드래그해서 다른 폴더 안으로 옮기기(같은 이름이 이미 있으면 실패 처리)
ipcMain.handle('move-folder', (e, { srcPath, destParentDir }) => {
  try {
    const destPath = path.join(destParentDir, path.basename(srcPath));
    if (fs.existsSync(destPath)) return { success: false, error: '같은 이름의 폴더/파일이 이미 있습니다.' };
    fs.renameSync(srcPath, destPath);
    return { success: true, path: destPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 다른 폴더에서 파일 가져오기(복사) - 이미지/3D모델/문서
ipcMain.handle('import-images', async (e, destDir) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '레퍼런스 파일', extensions: SUPPORTED.map(ext => ext.slice(1)) },
      { name: '모든 파일', extensions: ['*'] }
    ]
  });
  if (result.canceled) return [];
  const copied = [];
  for (const src of result.filePaths) {
    const dest = path.join(destDir, path.basename(src));
    try { fs.copyFileSync(src, dest); copied.push(dest); } catch {}
  }
  return copied;
});

// 외부 OS 드래그로 들어온 파일 경로들을 destDir로 복사
ipcMain.handle('copy-dropped-files', (e, { paths: srcPaths, destDir }) => {
  const copied = [];
  for (const src of srcPaths) {
    try {
      const stat = fs.statSync(src);
      // 확장자 제한 없이 드래그해서 넣은 파일은 그대로 복사 (문서 등도 누락 없이 들어오도록)
      if (stat.isFile()) {
        const dest = path.join(destDir, path.basename(src));
        fs.copyFileSync(src, dest);
        copied.push(dest);
      }
    } catch {}
  }
  return copied;
});

// 다른 앱으로 드래그 아웃(네이티브 드래그)
// drag-icon.png 파일이 실제로 존재하지 않아서 startDrag가 아이콘 로드에 실패해 "A JavaScript error occurred
// in the main process" 크래시 다이얼로그가 뜨던 문제 - 파일 경로 대신 즉석에서 만든 1x1 투명 아이콘(NativeImage)을 사용
const DRAG_ICON = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
ipcMain.on('start-native-drag', (e, filePathOrPaths) => {
  // 여러 개를 선택한 상태로 드래그하면 배열로 넘어옴 - 전부 함께 내보낸다
  if (Array.isArray(filePathOrPaths)) {
    e.sender.startDrag({ file: filePathOrPaths[0], files: filePathOrPaths, icon: DRAG_ICON });
  } else {
    e.sender.startDrag({ file: filePathOrPaths, icon: DRAG_ICON });
  }
});

// 중앙 그리드에서 파일을 왼쪽 폴더 트리로 드래그해서 옮기기 - 같은 이름 파일이 있으면 자동으로 "(1)" 등을 붙여 구분
ipcMain.handle('move-files', (e, { paths: srcPaths, destDir }) => {
  const moved = [];
  const errors = [];
  for (const src of srcPaths) {
    try {
      if (path.dirname(src) === destDir) continue; // 이미 그 폴더 안에 있으면 건너뜀
      const ext = path.extname(src);
      const stem = path.basename(src, ext);
      let dest = path.join(destDir, stem + ext);
      let n = 1;
      while (fs.existsSync(dest)) { dest = path.join(destDir, `${stem} (${n})${ext}`); n++; }
      fs.renameSync(src, dest);
      moved.push({ from: src, to: dest });
    } catch (err) {
      errors.push({ path: src, error: err.message });
    }
  }
  return { moved, errors };
});

// Ctrl+C / Ctrl+V로 파일 복사 - 원본은 그대로 두고 사본을 만든다. 같은 폴더에 붙여넣으면(복제) move-files와 같은
// 규칙으로 "(1)", "(2)"... 를 자동으로 붙여 이름이 겹치지 않게 한다.
ipcMain.handle('copy-files', (e, { paths: srcPaths, destDir }) => {
  const copied = [];
  const errors = [];
  for (const src of srcPaths) {
    try {
      const ext = path.extname(src);
      const stem = path.basename(src, ext);
      let dest = path.join(destDir, stem + ext);
      let n = 1;
      while (fs.existsSync(dest)) { dest = path.join(destDir, `${stem} (${n})${ext}`); n++; }
      fs.copyFileSync(src, dest);
      copied.push({ from: src, to: dest });
    } catch (err) {
      errors.push({ path: src, error: err.message });
    }
  }
  return { copied, errors };
});

// Ctrl+C를 눌렀을 때, 앱 내부 복사(위 copy-files)뿐 아니라 실제 윈도우 클립보드에도 파일을 올려서
// 탐색기·워드·포스트잇 등 "다른 프로그램"에 Ctrl+V 했을 때도 그대로 붙을 수 있게 한다.
// Electron의 clipboard 모듈은 텍스트/이미지(비트맵)까지만 지원하고 "파일 자체"를 클립보드에 올리는 기능
// (윈도우의 CF_HDROP 파일 드롭 형식)은 지원하지 않는다. 그래서 윈도우에 이미 내장된 PowerShell
// (System.Windows.Forms.Clipboard)을 통해 우회한다. 한 번의 DataObject에 아래 3가지를 함께 실어서,
// 붙여넣는 프로그램의 종류에 따라 알아서 맞는 형식을 골라 쓰게 한다.
// - 파일 목록(SetFileDropList): 탐색기에 붙여넣으면 실제 파일이 복사됨(문서 포함 모든 파일 대상)
// - 이미지 비트맵(SetImage): 그림판/워드/포스트잇처럼 "이미지"로 받는 프로그램에 그림 파일이 그대로 붙게 함(단일 이미지 파일일 때만)
// - 텍스트(SetText): 메모장/워드 등에 txt/md 내용이 텍스트로 바로 붙게 함(단일 txt/md 파일일 때만)
function psQuote(str) {
  return "'" + String(str).replace(/'/g, "''") + "'";
}
ipcMain.handle('write-files-to-os-clipboard', (e, filePaths) => {
  try {
    const list = (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean);
    if (!list.length) return { success: false, error: '복사할 파일이 없습니다.' };
    const missing = list.filter(p => !fs.existsSync(p));
    if (missing.length) return { success: false, error: '파일을 찾을 수 없습니다: ' + missing[0] };

    const fileArrayLiteral = '@(' + list.map(psQuote).join(',') + ')';
    const first = list[0];
    const ext = path.extname(first).toLowerCase();
    const isSingleImage = list.length === 1 && IMAGE_EXTS.includes(ext);
    const isSingleText = list.length === 1 && (ext === '.txt' || ext === '.md');

    let script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$dataObj = New-Object System.Windows.Forms.DataObject
$files = New-Object System.Collections.Specialized.StringCollection
foreach ($f in ${fileArrayLiteral}) { $files.Add($f) }
$dataObj.SetFileDropList($files)
`;
    if (isSingleImage) {
      script += `
try {
  $img = [System.Drawing.Image]::FromFile(${psQuote(first)})
  $dataObj.SetImage($img)
} catch {}
`;
    }
    if (isSingleText) {
      script += `
try {
  $textContent = Get-Content -LiteralPath ${psQuote(first)} -Raw -Encoding UTF8
  if ($null -eq $textContent) { $textContent = '' }
  $dataObj.SetText($textContent)
} catch {}
`;
    }
    script += `
[System.Windows.Forms.Clipboard]::SetDataObject($dataObj, $true)
`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf-8' });
    if (result.error) return { success: false, error: result.error.message };
    if (result.status !== 0) return { success: false, error: (result.stderr || '').toString().trim().slice(0, 300) || 'PowerShell 실행 실패' };
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- 웹페이지(핀터레스트 등)에서 이미지를 끌어다 놓으면 다운로드해서 저장 ----
function buildDownloadCandidates(url) {
  const candidates = [url];
  try {
    const u = new URL(url);
    // 핀터레스트 썸네일 URL(예: /236x/...)은 원본 화질(/originals/)이 있으면 그쪽을 우선 시도
    if (u.hostname.includes('pinimg.com')) {
      const upgraded = url.replace(/\/\d+x\d*\//, '/originals/');
      if (upgraded !== url) candidates.unshift(upgraded);
    }
  } catch {}
  return candidates;
}

function fetchOnce(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        fetchOnce(nextUrl, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('status ' + res.statusCode)); return; }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function saveDataUrl(url, destDir) {
  const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return null;
  const mime = m[1] || 'image/png';
  const isBase64 = !!m[2];
  const payload = m[3];
  const buf = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'binary');
  const extMap = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp' };
  const ext = extMap[mime] || '.png';
  let dest = path.join(destDir, 'image' + ext);
  let i = 1;
  while (fs.existsSync(dest)) { dest = path.join(destDir, `image_${i}${ext}`); i++; }
  fs.writeFileSync(dest, buf);
  return dest;
}

async function downloadOne(url, destDir) {
  if (url.startsWith('data:')) {
    try { return saveDataUrl(url, destDir); } catch { return null; }
  }
  const candidates = buildDownloadCandidates(url);
  for (const candidateUrl of candidates) {
    let dest = null;
    try {
      const res = await fetchOnce(candidateUrl);
      const ct = res.headers['content-type'] || '';
      // content-type이 이미지/동영상이 아니면(에러 페이지, svg 아이콘 등) 이 후보는 건너뛴다 - 빈 파일/깨진 파일로 저장되는 것 방지
      const mediaExtFromCt = {
        'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp',
        'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov'
      };
      let ext = mediaExtFromCt[ct.split(';')[0].trim()];
      if (!ext) {
        const m = candidateUrl.match(/\.(jpe?g|png|gif|webp|bmp|mp4|webm|mov|m4v)(\?|$)/i);
        if (m) ext = '.' + (m[1].toLowerCase() === 'm4v' ? 'mp4' : m[1].toLowerCase());
      }
      if (!ext) { res.resume(); throw new Error('이미지/동영상 형식이 아님 (content-type: ' + ct + ')'); }
      let base = 'image';
      try {
        const u = new URL(candidateUrl);
        base = path.basename(u.pathname).replace(/\.[a-zA-Z0-9]+$/, '') || 'image';
        base = base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
      } catch {}
      dest = path.join(destDir, base + ext);
      let i = 1;
      while (fs.existsSync(dest)) { dest = path.join(destDir, `${base}_${i}${ext}`); i++; }
      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(dest);
        res.pipe(fileStream);
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
        res.on('error', reject);
      });
      // 다운로드는 됐지만 내용이 거의 없는(에러 응답을 이미지로 착각해 저장한) 경우 빈 파일로 남기지 않고 실패 처리
      const stat = fs.statSync(dest);
      if (stat.size < 300) { fs.unlinkSync(dest); throw new Error('다운로드된 파일이 너무 작음 (' + stat.size + ' bytes) - 유효한 이미지가 아닌 것으로 보임'); }
      return dest;
    } catch (err) {
      if (dest) { try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {} }
      continue; // 다음 후보(원본 화질 실패 시 원래 URL 등)로 재시도
    }
  }
  return null;
}

ipcMain.handle('download-images', async (e, { urls, destDir }) => {
  const saved = [];
  const failed = [];
  for (const url of urls) {
    const r = await downloadOne(url, destDir);
    if (r) saved.push(r); else failed.push(url);
  }
  return { saved, failed };
});

// ---- 더블클릭 -> 크로키 앱(항상 위 뷰어)으로 이미지 열기 ----
function getConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch { return {}; }
}
function setConfig(cfg) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); }

async function resolveCroquisDir() {
  const cfg = getConfig();
  if (cfg.croquisDir && fs.existsSync(path.join(cfg.croquisDir, 'main.js'))) return cfg.croquisDir;
  if (fs.existsSync(path.join(DEFAULT_CROQUIS_DIR, 'main.js'))) {
    setConfig({ ...cfg, croquisDir: DEFAULT_CROQUIS_DIR });
    return DEFAULT_CROQUIS_DIR;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '크로키 앱 폴더를 선택하세요 (main.js가 있는 폴더)',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const dir = result.filePaths[0];
  if (!fs.existsSync(path.join(dir, 'main.js'))) {
    dialog.showErrorBox('크로키 앱을 찾을 수 없음', '선택한 폴더에 main.js가 없습니다.');
    return null;
  }
  setConfig({ ...cfg, croquisDir: dir });
  return dir;
}

ipcMain.handle('open-in-croquis', async (e, payload) => {
  // 이전 방식(파일 경로 문자열 하나만 전달)도 계속 지원
  const { filePath, folderImages, startIndex } = typeof payload === 'string' ? { filePath: payload } : (payload || {});
  const dir = await resolveCroquisDir();
  if (!dir) return { success: false, error: '크로키 앱 위치를 찾지 못함' };
  try {
    let args;
    if (Array.isArray(folderImages) && folderImages.length) {
      // 폴더 안 이미지 목록 전체 + 시작 위치를 임시 매니페스트 파일로 넘겨서, 크로키 앱의 '다음/이전'이
      // 지금 보고 있던 폴더 안에서만 순서대로 넘어가게 한다 (파일 하나만 넘기면 크로키 쪽에 예전에
      // 쌓여있던 다른 폴더 이미지들 사이에서 다음/이전이 뒤섞이는 문제가 있었음)
      const manifestPath = path.join(os.tmpdir(), `reflib-croquis-${Date.now()}.json`);
      fs.writeFileSync(manifestPath, JSON.stringify({ images: folderImages, startIndex: startIndex || 0 }));
      args = [dir, manifestPath];
    } else {
      args = [dir, filePath];
    }
    // 2026-07-18: 크로키 창이 처음 뜰 때(콜드 스타트) 이 레퍼런스 라이브러리 창의 정중앙에 오도록,
    // 이 창의 화면 좌표 중심점을 넘겨준다. 이미 크로키가 실행 중이면 크로키 쪽 single-instance-lock이
    // 새 창을 안 띄우고 기존 창에 이미지만 전달하므로 이 값은 무시된다(기존 위치 유지가 맞음).
    if (mainWindow) {
      const rb = mainWindow.getBounds();
      const centerX = Math.round(rb.x + rb.width / 2);
      const centerY = Math.round(rb.y + rb.height / 2);
      args.push(`--reflib-center=${centerX},${centerY}`);
    }
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- 더블클릭 -> obj 뷰어로 3D 파일 열기 ----
// objViewerDir 설정값은 두 가지 형태를 지원한다.
// 1) 소스 폴더 (main.js가 있는 폴더) -> 이 앱(reference-library) 자신의 electron 런타임으로 실행
// 2) 패키징된 .exe 파일 경로 -> 그 exe를 직접 실행
function isValidObjViewerTarget(p) {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return p.toLowerCase().endsWith('.exe');
    if (st.isDirectory()) return fs.existsSync(path.join(p, 'main.js'));
  } catch {}
  return false;
}

async function resolveObjViewerDir() {
  const cfg = getConfig();
  if (cfg.objViewerDir && isValidObjViewerTarget(cfg.objViewerDir)) return cfg.objViewerDir;
  if (fs.existsSync(path.join(DEFAULT_OBJVIEWER_DIR, 'main.js'))) {
    setConfig({ ...cfg, objViewerDir: DEFAULT_OBJVIEWER_DIR });
    return DEFAULT_OBJVIEWER_DIR;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'obj 뷰어 앱을 선택하세요 (실행 파일 .exe 또는 main.js가 있는 폴더)',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: '실행 파일', extensions: ['exe'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const picked = result.filePaths[0];
  if (!isValidObjViewerTarget(picked)) {
    dialog.showErrorBox('obj 뷰어 앱을 찾을 수 없음', '선택한 항목이 .exe 파일이거나, main.js가 있는 폴더가 아닙니다.');
    return null;
  }
  setConfig({ ...cfg, objViewerDir: picked });
  return picked;
}

// ---- 작가실 바로가기에서 클릭하면 바로 실행되는 독립 exe 유틸리티들(워크 타이머, 시계 등) ----
// configKey별로 마지막에 확인된 경로를 기억해뒀다가, 기본 위치에 없으면 한 번만 물어보고 그다음부터는 기억한 경로를 쓴다.
async function resolveExePath(configKey, defaultPath, dialogTitle) {
  const cfg = getConfig();
  if (cfg[configKey] && fs.existsSync(cfg[configKey])) return cfg[configKey];
  if (defaultPath && fs.existsSync(defaultPath)) {
    setConfig({ ...cfg, [configKey]: defaultPath });
    return defaultPath;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: dialogTitle,
    properties: ['openFile'],
    filters: [{ name: '실행 파일', extensions: ['exe'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const picked = result.filePaths[0];
  setConfig({ ...cfg, [configKey]: picked });
  return picked;
}
function launchExe(exePath) {
  // 설정 파일 등을 exe와 같은 폴더에서 찾을 수 있도록 실행 위치(cwd)를 exe가 있는 폴더로 맞춰준다
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exePath) });
  child.unref();
}

ipcMain.handle('open-work-timer', async () => {
  const exePath = await resolveExePath('workTimerExe', DEFAULT_WORK_TIMER_EXE, '워크 타이머 실행 파일(Work.exe)을 선택하세요');
  if (!exePath) return { success: false, error: '워크 타이머 실행 파일 위치를 찾지 못함' };
  try { launchExe(exePath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('open-clock-app', async () => {
  const exePath = await resolveExePath('clockAppExe', DEFAULT_CLOCK_EXE, '시계 앱 실행 파일(DesktopClock.exe)을 선택하세요');
  if (!exePath) return { success: false, error: '시계 앱 실행 파일 위치를 찾지 못함' };
  try { launchExe(exePath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('open-upscayl', async () => {
  const exePath = await resolveExePath('upscaylExe', DEFAULT_UPSCAYL_EXE, '업스케일 실행 파일(Upscayl.exe)을 선택하세요');
  if (!exePath) return { success: false, error: '업스케일 실행 파일 위치를 찾지 못함' };
  try { launchExe(exePath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('open-designdoll', async () => {
  const exePath = await resolveExePath('designDollExe', DEFAULT_DESIGNDOLL_EXE, 'DesignDoll 실행 파일(DesignDollLauncher.exe)을 선택하세요');
  if (!exePath) return { success: false, error: 'DesignDoll 실행 파일 위치를 찾지 못함' };
  try { launchExe(exePath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

// ---- DesignDoll 창 "항상 위" 토글 ----
// DesignDoll은 남이 만든 별도 실행 파일이라 우리 창처럼 직접 제어할 수 없다. 그래서 창을 우리 프레임
// 안에 넣는(임베드) 대신, Windows API(SetWindowPos)를 PowerShell로 호출해서 그 창에 "항상 위" 속성만
// 걸어준다 - 창 옵션 하나를 켜고 끄는 정도라 임베딩보다 훨씬 안정적이다.
function setDesignDollTopmost(value) {
  return new Promise((resolve) => {
    const flag = value ? '1' : '0';
    const psScript = [
      'Add-Type @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class RefLibWin32 {',
      '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
      '}',
      '"@',
      "$procs = Get-Process | Where-Object { $_.MainWindowTitle -match 'DesignDoll' -and $_.MainWindowHandle -ne [IntPtr]::Zero }",
      `$target = if ('${flag}' -eq '1') { [IntPtr]::new(-1) } else { [IntPtr]::new(-2) }`,
      'foreach ($p in $procs) { [RefLibWin32]::SetWindowPos($p.MainWindowHandle, $target, 0, 0, 0, 0, 0x0003) | Out-Null }',
      "if ($procs.Count -eq 0) { Write-Output 'NOTFOUND' } else { Write-Output ('OK:' + $procs.Count) }"
    ].join('\n');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.on('close', () => resolve({ found: out.includes('OK'), raw: out.trim() }));
    child.on('error', () => resolve({ found: false, raw: 'powershell 실행 실패' }));
  });
}

ipcMain.handle('toggle-designdoll-topmost', async (_e, value) => {
  const result = await setDesignDollTopmost(!!value);
  return { success: true, applied: !!value, found: result.found };
});

ipcMain.handle('open-yes24ebook', async () => {
  const exePath = await resolveExePath('yes24EbookExe', DEFAULT_YES24EBOOK_EXE, '예스24 이북 실행 파일(YES24eBook.exe)을 선택하세요');
  if (!exePath) return { success: false, error: '예스24 이북 실행 파일 위치를 찾지 못함' };
  try { launchExe(exePath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('open-pureref', async () => {
  const exePath = await resolveExePath('purerefExe', DEFAULT_PUREREF_EXE, 'PureRef 실행 파일(PureRef.exe)을 선택하세요');
  if (!exePath) return { success: false, error: 'PureRef 실행 파일 위치를 찾지 못함' };
  try { launchExe(exePath); return { success: true }; }
  catch (err) { return { success: false, error: err.message }; }
});

// ---- 예스24 이북 창 "항상 위" 토글 (DesignDoll과 같은 방식 - 창을 프레임에 넣는 게 아니라
// Windows API로 그 창에 항상 위 속성만 걸어준다) ----
// 프로세스명(YES24eBook)으로 찾는다 - 업데이터(YES24eBookUpdater)·삭제 프로그램(uninst)·
// 내장 WebView2 도우미 프로세스와 헷갈리지 않도록 정확한 이름으로 매칭한다.
function setYes24Topmost(value) {
  return new Promise((resolve) => {
    const flag = value ? '1' : '0';
    const psScript = [
      'Add-Type @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class RefLibWin32Y {',
      '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
      '}',
      '"@',
      "$procs = Get-Process | Where-Object { $_.ProcessName -eq 'YES24eBook' -and $_.MainWindowHandle -ne [IntPtr]::Zero }",
      `$target = if ('${flag}' -eq '1') { [IntPtr]::new(-1) } else { [IntPtr]::new(-2) }`,
      'foreach ($p in $procs) { [RefLibWin32Y]::SetWindowPos($p.MainWindowHandle, $target, 0, 0, 0, 0, 0x0003) | Out-Null }',
      "if ($procs.Count -eq 0) { Write-Output 'NOTFOUND' } else { Write-Output ('OK:' + $procs.Count) }"
    ].join('\n');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.on('close', () => resolve({ found: out.includes('OK'), raw: out.trim() }));
    child.on('error', () => resolve({ found: false, raw: 'powershell 실행 실패' }));
  });
}

ipcMain.handle('toggle-yes24-topmost', async (_e, value) => {
  const result = await setYes24Topmost(!!value);
  return { success: true, applied: !!value, found: result.found };
});

// ---- 사이트 미니 창 (콜로소 전용이 아니라, 아무 주소나 넣어서 쓸 수 있는 범용 기능) ----
// 임베드가 막힌 사이트(setpose.com, 콜로소 등)나 그냥 항상 띄워두고 싶은 사이트를, 크롬을 탭/주소창
// 없는 "앱 모드" 작은 창으로 열어서 화면 구석에 띄운다. 항상 위 고정은 이 창 자체가 아니라 전역
// 단축키(Ctrl+Alt+Y, toggleFocusedWindowTopmost 참고)로 한다 - 어떤 사이트를 넣든 똑같이 동작한다.
const DEFAULT_CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// 미니 창을 크로키앱/동영상 플레이어처럼 어두운 톤으로 보이게 하는 처리.
//
// 처음에는 --force-dark-mode / --enable-features=WebContentsForceDark 플래그로 페이지 내용까지
// 어둡게 만들려고 했는데, 실제로는 거의 항상 안 먹힌다는 걸 확인했다: 이 플래그들은 크롬 "프로세스가
// 새로 시작될 때"만 적용되는데, 사용자가 크롬을 이미 켜놓은 상태(거의 항상 그렇다)에서
// chrome.exe --app=... 을 또 실행하면 새 프로세스를 안 띄우고 이미 떠 있는 크롬에 "이 주소로 창 하나
// 열어줘"라고 요청만 전달하고 끝난다 - 그래서 그때 같이 넘긴 플래그는 무시된다. 크롬을 완전히 다 끄고
// 열어야만 먹히는데, 그러면 미니창 하나 열자고 사용자가 보던 다른 크롬 탭들을 다 닫아야 해서 본말이
// 전도된다. 그렇다고 별도 프로필(--user-data-dir)을 쓰면 이번엔 로그인 세션이 안 걸려서 콜로소 같은
// 로그인 필요한 사이트가 무용지물이 된다. 그래서 페이지 내용 자체를 강제로 어둡게 하는 건 포기했다 -
// 사이트 원본 디자인 그대로 뜨는 게 정상이다.
//
// 대신 제목표시줄(타이틀바)만 어둡게 한다. 이건 창 자체의 OS 속성이라 페이지 내용과 무관하게
// DesignDoll/예스24 항상위와 같은 방식(PowerShell로 Win32 API 직접 호출)으로 걸 수 있다.
// 방금 띄운 창을 찾을 때 "화면 좌표"로 찾으면 안 된다 - 크롬은 이미 같은 사이트(app)를 예전에 연
// 적이 있으면 그때 사용자가 옮겨놓은 위치/크기를 기억했다가 그대로 복원해버려서, 우리가 --window-
// position으로 지정한 좌표에 뜬다는 보장이 없다(실제로 이 문제로 처음 버전은 타이틀바를 못 찾았다).
// 그래서 "새 창을 열기 전/후의 크롬 창 목록을 비교해서 새로 생긴 것"을 찾는 방식으로 바꿨다 - 창이
// 어디에 뜨든 상관없이 정확히 찾는다.
function listChromeWindowHandles() {
  return new Promise((resolve) => {
    const psScript = [
      'Add-Type @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class RefLibEnumChrome {',
      '  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);',
      '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);',
      '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
      '  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);',
      '}',
      '"@',
      '$list = New-Object System.Collections.Generic.List[string]',
      '$cb = {',
      '  param($hWnd, $lParam)',
      '  if ([RefLibEnumChrome]::IsWindowVisible($hWnd)) {',
      '    $procId = 0',
      '    [RefLibEnumChrome]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null',
      '    try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $name = "" }',
      '    if ($name -eq "chrome") { $list.Add([string][int64]$hWnd) }',
      '  }',
      '  return $true',
      '}',
      '[RefLibEnumChrome]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null',
      '$list -join ","'
    ].join('\n');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
  });
}

// 2026-07-22: --window-size/--window-position 플래그가 신뢰할 수 없다는 게 재확인됐다(크기를 바꿔도
// 안 바뀐다는 피드백). 위 주석에 이미 적어뒀듯 이유는 두 가지 - (1) 크롬이 이미 켜져 있으면 새
// 프로세스가 안 뜨고 기존 크롬에 "창 하나 열어줘"라고 요청만 전달되어 그때 넘긴 플래그 자체가
// 무시되고, (2) 새 프로세스로 뜨더라도 같은 사이트를 예전에 연 적이 있으면 그때 기억해둔 크기/위치를
// 그대로 복원한다. 그래서 크기/위치도 다크 타이틀바와 똑같은 방식(새로 생긴 크롬 창을 찾아 Win32
// SetWindowPos로 강제 적용)으로 처리한다 - 이러면 크롬이 플래그를 무시하든 예전 크기를 기억하든
// 상관없이 항상 우리가 원하는 크기/위치로 맞춰진다.
function positionNewMiniWindow(beforeHandles, x, y, w, h) {
  const psScript = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class RefLibMiniDark {',
    '  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);',
    '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttributeFlag(IntPtr hwnd, int attr, ref int value, int size);',
    '  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttributeColor(IntPtr hwnd, int attr, ref uint value, int size);',
    '}',
    '"@',
    `$before = [string[]]@(${JSON.stringify((beforeHandles || '').split(',').filter(Boolean).join(','))} -split "," | Where-Object { $_ -ne "" })`,
    'function Find-NewChromeWindow {',
    '  $found = [IntPtr]::Zero',
    '  $cb = {',
    '    param($hWnd, $lParam)',
    '    if (-not [RefLibMiniDark]::IsWindowVisible($hWnd)) { return $true }',
    '    $procId = 0',
    '    [RefLibMiniDark]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null',
    '    try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { return $true }',
    "    if ($name -ne 'chrome') { return $true }",
    '    $hwndStr = [string][int64]$hWnd',
    '    if ($script:before -notcontains $hwndStr) { $script:found = $hWnd; return $false }',
    '    return $true',
    '  }',
    '  for ($i = 0; $i -lt 20; $i++) {',
    '    $script:found = [IntPtr]::Zero',
    '    [RefLibMiniDark]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null',
    '    if ($script:found -ne [IntPtr]::Zero) { return $script:found }',
    '    Start-Sleep -Milliseconds 150',
    '  }',
    '  return [IntPtr]::Zero',
    '}',
    '$hwnd = Find-NewChromeWindow',
    'if ($hwnd -eq [IntPtr]::Zero) { Write-Output "NOTFOUND"; exit }',
    // SWP_NOZORDER(0x0004) - 다른 창들과의 위/아래 순서는 건드리지 않고 위치·크기만 강제로 맞춘다
    `[RefLibMiniDark]::SetWindowPos($hwnd, [IntPtr]::Zero, ${Math.round(x)}, ${Math.round(y)}, ${Math.round(w)}, ${Math.round(h)}, 0x0004) | Out-Null`,
    '$dark = 1',
    '[RefLibMiniDark]::DwmSetWindowAttributeFlag($hwnd, 20, [ref]$dark, 4) | Out-Null', // DWMWA_USE_IMMERSIVE_DARK_MODE
    '$bg = [uint32]0x001c1817',  // COLORREF(BGR) - 앱 배경색 #17181c
    '[RefLibMiniDark]::DwmSetWindowAttributeColor($hwnd, 35, [ref]$bg, 4) | Out-Null', // DWMWA_CAPTION_COLOR (Win11 전용, 실패해도 무시)
    'Write-Output "OK"'
  ].join('\n');
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true });
  child.on('error', () => {}); // 실패해도 미니 창 자체는 이미 열려 있으니 조용히 무시
}

ipcMain.handle('open-mini-window', async (_e, url) => {
  if (!/^https?:\/\//i.test(url || '')) return { success: false, error: 'http:// 또는 https://로 시작하는 주소를 입력해 주세요' };
  const exePath = await resolveExePath('chromeExe', DEFAULT_CHROME_EXE, '크롬 실행 파일(chrome.exe)을 선택하세요');
  if (!exePath) return { success: false, error: '크롬 실행 파일 위치를 찾지 못함' };
  try {
    // 2026-07-22: 화면 우측 하단에 세로로 길게(420x700) 고정되던 걸, 사용자가 보여준 참고 크기
    // (유튜브 등 가로형 콘텐츠에 맞는 약 530x430)로 바꾸고, 위치도 화면 구석이 아니라 레퍼런스
    // 라이브러리 창(mainWindow) 정중앙에 뜨도록 변경. 모니터 경계를 벗어나지 않게 clamp하는 방식은
    // 크로키 앱 등 다른 창들의 computeCenteredPosition과 동일하다.
    const w = 530, h = 430;
    const mb = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    const cx = mb ? mb.x + mb.width / 2 : null;
    const cy = mb ? mb.y + mb.height / 2 : null;
    const display = mb ? screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }) : screen.getPrimaryDisplay();
    const work = display.workArea; // 작업표시줄 등을 뺀 실제 화면 영역
    let x = mb ? Math.round(cx - w / 2) : Math.round(work.x + work.width - w - 10);
    let y = mb ? Math.round(cy - h / 2) : Math.round(work.y + work.height - h - 10);
    x = Math.max(work.x, Math.min(x, work.x + work.width - w));
    y = Math.max(work.y, Math.min(y, work.y + work.height - h));
    const beforeHandles = await listChromeWindowHandles(); // 새 창을 찾기 위한 "열기 전" 스냅샷
    const child = spawn(exePath, [
      `--app=${url}`,
      `--window-size=${w},${h}`,
      `--window-position=${x},${y}`,
      '--force-dark-mode',
      '--enable-features=WebContentsForceDark'
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    // --window-size/position은 크롬이 이미 켜져 있거나 같은 사이트를 예전에 연 적이 있으면 무시되므로,
    // 새로 생긴 창을 찾아 Win32 SetWindowPos로 크기/위치를 다시 한번 강제로 맞춘다(다크 타이틀바와 함께 처리).
    positionNewMiniWindow(beforeHandles, x, y, w, h); // 결과를 기다리지 않는다 - 실패해도 미니 창은 이미 정상적으로 열려 있다
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ComfyUI 워크플로우 버튼 - 2026-07-23 추가
// 서버(127.0.0.1:8188)가 켜져 있는지 먼저 확인하고, 꺼져 있으면 ComfyUI실행.bat으로 켠 뒤 준비될 때까지
// 기다렸다가, 미니창과 같은 방식(크롬 앱모드 창)으로 열어준다. 그래프 작업 공간이라 미니창보다 크게 띄운다.
function checkComfyUIAlive() {
  return new Promise((resolve) => {
    const req = http.get(COMFYUI_URL, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitForComfyUI(maxWaitMs) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkComfyUIAlive()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
// 펜터치 웹 서버 - 꺼져 있으면 켜기만 하고 뜰 때까지 기다리지 않는다(폰 원격용 부가 서비스라
// ComfyUI/펜터치 앱을 여는 주된 동작을 이것 때문에 지연시키거나 실패시키지 않으려는 의도).
// 이미 켜져 있으면 중복으로 새 서버 프로세스를 띄우지 않도록 먼저 살아있는지 확인한다.
function checkPentouchWebAlive() {
  return new Promise((resolve) => {
    const req = http.get(PENTOUCH_WEB_URL, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function ensurePentouchWebServer() {
  try {
    const alreadyRunning = await checkPentouchWebAlive();
    if (alreadyRunning) return;
    if (!fs.existsSync(PENTOUCH_WEB_BAT)) return; // 조용히 무시 - 부가 서비스라 없어도 메인 동작을 막지 않는다
    const serverProc = spawn('cmd.exe', ['/c', PENTOUCH_WEB_BAT], {
      cwd: PENTOUCH_WEB_DIR, detached: true, stdio: 'ignore'
    });
    serverProc.unref();
  } catch (err) {
    // 부가 서비스이므로 실패해도 호출한 쪽(ComfyUI/펜터치 앱 열기)에는 영향을 주지 않는다
  }
}
ipcMain.handle('open-comfyui', async () => {
  try {
    ensurePentouchWebServer(); // 기다리지 않고 백그라운드로 같이 켠다
    const alreadyRunning = await checkComfyUIAlive();
    if (!alreadyRunning) {
      if (!fs.existsSync(COMFYUI_BAT)) {
        return { success: false, error: 'ComfyUI 실행 파일을 찾을 수 없습니다: ' + COMFYUI_BAT };
      }
      const serverProc = spawn('cmd.exe', ['/c', COMFYUI_BAT], {
        cwd: COMFYUI_DIR, detached: true, stdio: 'ignore'
      });
      serverProc.unref();
      const ready = await waitForComfyUI(60000); // 모델 로딩 등으로 시간이 걸릴 수 있어 최대 60초 대기
      if (!ready) {
        return { success: false, error: 'ComfyUI 서버가 60초 안에 켜지지 않았습니다. 켜지는 중이라면 잠시 후 다시 눌러주세요.' };
      }
    }
    const exePath = await resolveExePath('chromeExe', DEFAULT_CHROME_EXE, '크롬 실행 파일(chrome.exe)을 선택하세요');
    if (!exePath) return { success: false, error: '크롬 실행 파일 위치를 찾지 못함' };
    const w = 1600, h = 960;
    const mb = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    const cx = mb ? mb.x + mb.width / 2 : null;
    const cy = mb ? mb.y + mb.height / 2 : null;
    const display = mb ? screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }) : screen.getPrimaryDisplay();
    const work = display.workArea;
    let x = mb ? Math.round(cx - w / 2) : Math.round(work.x + (work.width - w) / 2);
    let y = mb ? Math.round(cy - h / 2) : Math.round(work.y + (work.height - h) / 2);
    x = Math.max(work.x, Math.min(x, work.x + work.width - w));
    y = Math.max(work.y, Math.min(y, work.y + work.height - h));
    const beforeHandles = await listChromeWindowHandles();
    const child = spawn(exePath, [
      `--app=${COMFYUI_URL}`,
      `--window-size=${w},${h}`,
      `--window-position=${x},${y}`,
      '--force-dark-mode',
      '--enable-features=WebContentsForceDark'
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    positionNewMiniWindow(beforeHandles, x, y, w, h);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function checkHunyuanMvAlive() {
  return new Promise((resolve) => {
    const req = http.get(HUNYUAN_MV_URL, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitForHunyuanMv(maxWaitMs) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkHunyuanMvAlive()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
function checkWebtoon3dAlive() {
  return new Promise((resolve) => {
    const req = http.get(WEBTOON3D_URL, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitForWebtoon3d(maxWaitMs) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkWebtoon3dAlive()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
// 웹툰 3D: Hunyuan3D-2mv 서버 -> webtoon_3d_app.py(Gradio 웹앱) 순서로 켜고(이미 켜져 있으면
// 그대로 넘어감) 마지막에 브라우저 창을 연다. Hunyuan3D-2mv는 모델 로딩 때문에 켜지는 데
// 시간이 오래 걸릴 수 있어(과거에 몇 분 걸린 적도 있음) ComfyUI보다 넉넉하게 최대 3분 기다린다.
ipcMain.handle('open-webtoon3d', async () => {
  try {
    // 2026-08-22: Hunyuan3D-2.1 연동은 제거했습니다(사용자 요청). 이 버튼은 다시
    // Hunyuan3D-2mv(2.0)만 자동으로 켭니다.
    const hunyuanAlreadyRunning = await checkHunyuanMvAlive();
    if (!hunyuanAlreadyRunning) {
      if (!fs.existsSync(HUNYUAN_MV_BAT)) {
        return { success: false, error: 'Hunyuan3D-2mv 실행 파일을 찾을 수 없습니다: ' + HUNYUAN_MV_BAT };
      }
      const hunyuanProc = spawn('cmd.exe', ['/c', HUNYUAN_MV_BAT], {
        cwd: HUNYUAN_MV_DIR, detached: true, stdio: 'ignore'
      });
      hunyuanProc.unref();
      const hunyuanReady = await waitForHunyuanMv(180000); // 모델 로딩에 시간이 걸릴 수 있어 최대 3분 대기
      if (!hunyuanReady) {
        return { success: false, error: 'Hunyuan3D-2mv 서버가 3분 안에 켜지지 않았습니다. 켜지는 중이라면 잠시 후 다시 눌러주세요.' };
      }
    }

    const webtoonAlreadyRunning = await checkWebtoon3dAlive();
    if (!webtoonAlreadyRunning) {
      if (!fs.existsSync(WEBTOON3D_BAT)) {
        return { success: false, error: '웹툰 3D 앱 실행 파일을 찾을 수 없습니다: ' + WEBTOON3D_BAT };
      }
      const webtoonProc = spawn('cmd.exe', ['/c', WEBTOON3D_BAT], {
        cwd: WEBTOON3D_DIR, detached: true, stdio: 'ignore'
      });
      webtoonProc.unref();
      const webtoonReady = await waitForWebtoon3d(60000);
      if (!webtoonReady) {
        return { success: false, error: '웹툰 3D 앱이 60초 안에 켜지지 않았습니다. 켜지는 중이라면 잠시 후 다시 눌러주세요.' };
      }
    }

    const exePath = await resolveExePath('chromeExe', DEFAULT_CHROME_EXE, '크롬 실행 파일(chrome.exe)을 선택하세요');
    if (!exePath) return { success: false, error: '크롬 실행 파일 위치를 찾지 못함' };
    const w = 1600, h = 960;
    const mb = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
    const cx = mb ? mb.x + mb.width / 2 : null;
    const cy = mb ? mb.y + mb.height / 2 : null;
    const display = mb ? screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }) : screen.getPrimaryDisplay();
    const work = display.workArea;
    let x = mb ? Math.round(cx - w / 2) : Math.round(work.x + (work.width - w) / 2);
    let y = mb ? Math.round(cy - h / 2) : Math.round(work.y + (work.height - h) / 2);
    x = Math.max(work.x, Math.min(x, work.x + work.width - w));
    y = Math.max(work.y, Math.min(y, work.y + work.height - h));
    const beforeHandles = await listChromeWindowHandles();
    const child = spawn(exePath, [
      `--app=${WEBTOON3D_URL}`,
      `--window-size=${w},${h}`,
      `--window-position=${x},${y}`,
      '--force-dark-mode',
      '--enable-features=WebContentsForceDark'
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    positionNewMiniWindow(beforeHandles, x, y, w, h);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 한글(콜로소) 문자열을 PowerShell 인자로 그대로 넘기면 시스템 코드페이지에 따라 깨질 수 있어서,
// -EncodedCommand(UTF-16LE + Base64)로 넘긴다 - 이렇게 하면 어떤 환경에서도 한글이 깨지지 않는다.
function runPowerShellUnicodeSafe(scriptText) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(scriptText, 'utf16le').toString('base64');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
  });
}

// ---- "지금 선택된(포커스된) 창" 항상 위 토글 - 전역 단축키 ----
// 콜로소 주소를 미리 정해두거나 창 제목으로 찾는 대신, 단축키를 누르는 순간 실제로 포커스되어 있는
// 창(어떤 프로그램이든)을 그대로 대상으로 삼는다. 레퍼런스 라이브러리 창에서 버튼을 누르면 그 순간
// 레퍼런스 라이브러리 자신이 포커스된 창이 되어버리므로 이 방식은 안 되고, 반드시 전역 단축키로 만들어야
// 한다 - 단축키는 다른 창에 포커스가 가 있는 상태 그대로 눌리기 때문에 GetForegroundWindow가 그
// 창(크롬이든 뭐든)을 그대로 가리킨다.
// 이미 항상 위인지 여부는 따로 상태를 기억하지 않고, 그 순간 창의 실제 스타일(WS_EX_TOPMOST)을
// Windows에 직접 물어봐서 켜져 있으면 끄고, 꺼져 있으면 켠다 - 그래서 여러 창을 오가며 눌러도 항상
// "지금 그 창" 기준으로 정확히 토글된다.
function toggleFocusedWindowTopmost() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class RefLibWin32F {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@
$hwnd = [RefLibWin32F]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { Write-Output 'NOTFOUND'; exit }
$GWL_EXSTYLE = -20
$WS_EX_TOPMOST = 0x00000008
$style = [RefLibWin32F]::GetWindowLong($hwnd, $GWL_EXSTYLE)
$isTop = ($style -band $WS_EX_TOPMOST) -ne 0
$target = if ($isTop) { [IntPtr]::new(-2) } else { [IntPtr]::new(-1) }
[RefLibWin32F]::SetWindowPos($hwnd, $target, 0, 0, 0, 0, 0x0003) | Out-Null
$sb = New-Object StringBuilder 256
[RefLibWin32F]::GetWindowText($hwnd, $sb, 256) | Out-Null
$newState = if ($isTop) { 'OFF' } else { 'ON' }
Write-Output ($newState + ':' + $sb.ToString())
`;
  return runPowerShellUnicodeSafe(script);
}

// 포스트잇 앱: exe가 아니라 소스 폴더(package.json)를 이 앱의 electron 런타임으로 직접 실행한다 (크로키 앱과 같은 방식)
async function resolveStickyNotesDir() {
  const cfg = getConfig();
  if (cfg.stickyNotesDir && fs.existsSync(path.join(cfg.stickyNotesDir, 'package.json'))) return cfg.stickyNotesDir;
  if (fs.existsSync(path.join(DEFAULT_STICKY_NOTES_DIR, 'package.json'))) {
    setConfig({ ...cfg, stickyNotesDir: DEFAULT_STICKY_NOTES_DIR });
    return DEFAULT_STICKY_NOTES_DIR;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '포스트잇 앱 폴더를 선택하세요 (package.json이 있는 폴더)',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const dir = result.filePaths[0];
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    dialog.showErrorBox('포스트잇 앱을 찾을 수 없음', '선택한 폴더에 package.json이 없습니다.');
    return null;
  }
  setConfig({ ...cfg, stickyNotesDir: dir });
  return dir;
}

ipcMain.handle('open-sticky-notes', async () => {
  const dir = await resolveStickyNotesDir();
  if (!dir) return { success: false, error: '포스트잇 앱 위치를 찾지 못함' };
  try {
    const child = spawn(process.execPath, [dir], { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 펜터치 로컬 앱: 포스트잇과 같은 방식(소스 폴더를 이 앱의 electron 런타임으로 직접 실행)
async function resolvePentouchDir() {
  const cfg = getConfig();
  if (cfg.pentouchDir && fs.existsSync(path.join(cfg.pentouchDir, 'package.json'))) return cfg.pentouchDir;
  if (fs.existsSync(path.join(DEFAULT_PENTOUCH_DIR, 'package.json'))) {
    setConfig({ ...cfg, pentouchDir: DEFAULT_PENTOUCH_DIR });
    return DEFAULT_PENTOUCH_DIR;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '펜터치 앱 폴더를 선택하세요 (package.json이 있는 폴더)',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const dir = result.filePaths[0];
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    dialog.showErrorBox('펜터치 앱을 찾을 수 없음', '선택한 폴더에 package.json이 없습니다.');
    return null;
  }
  setConfig({ ...cfg, pentouchDir: dir });
  return dir;
}
ipcMain.handle('open-pentouch', async () => {
  const dir = await resolvePentouchDir();
  if (!dir) return { success: false, error: '펜터치 앱 위치를 찾지 못함' };
  try {
    ensurePentouchWebServer(); // 기다리지 않고 백그라운드로 같이 켠다
    const child = spawn(process.execPath, [dir], { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 곡선 원근 그리드 앱: 포스트잇과 같은 방식(소스 폴더를 이 앱의 electron 런타임으로 직접 실행)
async function resolveGridDir() {
  const cfg = getConfig();
  if (cfg.gridDir && fs.existsSync(path.join(cfg.gridDir, 'package.json'))) return cfg.gridDir;
  if (fs.existsSync(path.join(DEFAULT_GRID_DIR, 'package.json'))) {
    setConfig({ ...cfg, gridDir: DEFAULT_GRID_DIR });
    return DEFAULT_GRID_DIR;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '곡선 원근 그리드 앱 폴더를 선택하세요 (package.json이 있는 폴더)',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const dir = result.filePaths[0];
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    dialog.showErrorBox('곡선 원근 그리드 앱을 찾을 수 없음', '선택한 폴더에 package.json이 없습니다.');
    return null;
  }
  setConfig({ ...cfg, gridDir: dir });
  return dir;
}

ipcMain.handle('open-perspective-grid', async () => {
  const dir = await resolveGridDir();
  if (!dir) return { success: false, error: '곡선 원근 그리드 앱 위치를 찾지 못함' };
  try {
    // 2026-07-18: 새 창이 이 창 정중앙에 뜨도록 중심좌표를 같이 넘긴다(그리드 앱 main.js가 처리).
    const args = [dir];
    const centerArg = reflibCenterArg();
    if (centerArg) args.push(centerArg);
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// OBJ 배치 뷰어 앱: 곡선 원근 그리드와 같은 방식(소스 폴더를 이 앱의 electron 런타임으로 직접 실행).
async function resolveObjPlacerDir() {
  const cfg = getConfig();
  if (cfg.objPlacerDir && fs.existsSync(path.join(cfg.objPlacerDir, 'package.json'))) return cfg.objPlacerDir;
  if (fs.existsSync(path.join(DEFAULT_OBJPLACER_DIR, 'package.json'))) {
    setConfig({ ...cfg, objPlacerDir: DEFAULT_OBJPLACER_DIR });
    return DEFAULT_OBJPLACER_DIR;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'OBJ 배치 뷰어 앱 폴더를 선택하세요 (package.json이 있는 폴더)',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const dir = result.filePaths[0];
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    dialog.showErrorBox('OBJ 배치 뷰어 앱을 찾을 수 없음', '선택한 폴더에 package.json이 없습니다.');
    return null;
  }
  setConfig({ ...cfg, objPlacerDir: dir });
  return dir;
}

// 빠른 실행 패널의 "OBJ 배치" 버튼 - 파일 없이 그냥 앱만 켠다(원근 그리드 버튼과 같은 방식).
ipcMain.handle('open-obj-placer', async () => {
  const dir = await resolveObjPlacerDir();
  if (!dir) return { success: false, error: 'OBJ 배치 뷰어 앱 위치를 찾지 못함' };
  try {
    // 2026-07-18: 새 창이 이 창 정중앙에 뜨도록 중심좌표를 같이 넘긴다(뷰어 쪽 main.js가 처리).
    const args = [dir];
    const centerArg = reflibCenterArg();
    if (centerArg) args.push(centerArg);
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 레퍼런스 라이브러리에서 선택한 .obj 파일(여러 개 가능)을 커맨드라인 인자로 그대로 넘겨 OBJ 배치 뷰어를 연다.
// 뷰어 쪽에 single-instance-lock을 걸어뒀으므로, 이미 켜져 있으면 새 창을 또 띄우지 않고
// 기존 창에 넘긴 파일들이 추가로 불러와진다(뷰어 쪽 main.js 참고).
ipcMain.handle('open-in-obj-placer', async (e, filePaths) => {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  if (!paths.length) return { success: false, error: '열 파일이 없습니다.' };
  const dir = await resolveObjPlacerDir();
  if (!dir) return { success: false, error: 'OBJ 배치 뷰어 앱 위치를 찾지 못함' };
  try {
    const args = [dir, ...paths];
    const centerArg = reflibCenterArg();
    if (centerArg) args.push(centerArg);
    const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 설정창의 "OBJ 뷰어 재연결" 버튼에서 호출 - 기존 연결을 지우고 바로 선택 다이얼로그를 띄운다.
ipcMain.handle('reconnect-objviewer', async () => {
  const cfg = getConfig();
  const { objViewerDir, ...rest } = cfg;
  setConfig(rest);
  const dir = await resolveObjViewerDir();
  return dir ? { success: true, path: dir } : { success: false };
});

ipcMain.handle('open-in-objviewer', async (e, filePath) => {
  const target = await resolveObjViewerDir();
  if (!target) return { success: false, error: 'obj 뷰어 앱 위치를 찾지 못함' };
  try {
    const isExe = fs.statSync(target).isFile();
    // 2026-07-18: 소스 폴더로 직접 실행하는 경우(우리가 만든 앱)는 그쪽 main.js가
    // "--reflib-center=x,y"를 읽어 이 창 중앙에 뜨도록 처리한다. 이미 빌드된 exe는 우리가
    // 만든 코드가 아니라 이 인자를 처리할 수 없으므로 넘기지 않는다(위치 제어 불가).
    const centerArg = reflibCenterArg();
    const child = isExe
      ? spawn(target, [filePath], { detached: true, stdio: 'ignore' })
      : spawn(process.execPath, centerArg ? [target, filePath, centerArg] : [target, filePath], { detached: true, stdio: 'ignore' });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- 문서 등 그 외 파일: OS 기본 프로그램으로 열기 ----
ipcMain.handle('open-with-default', async (e, filePath) => {
  try {
    const err = await shell.openPath(filePath);
    return err ? { success: false, error: err } : { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
