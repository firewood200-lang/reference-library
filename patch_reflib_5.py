# -*- coding: utf-8 -*-
"""reference-library/main.js 패치: 메인 창을 매번 강제로 maximize()하던 것을
되돌리고, 사용자가 손으로 조절한 마지막 창 크기/위치/최대화 여부를 기억해서
다음 실행 때 그대로 열리도록 수정(2026-09-06, 사용자 실측 -- "레퍼런스앱도
창 크기가 너무 크게 떠. 줄이는 과정을 반복하고 있어").

경위: 원래는 width/height가 1400x900 고정값이라 화면보다 작아서 매번 손으로
늘려야 했다(사용자 실측 "또 창을 조정해야 되잖아") -- 그래서 생성 직후
maximize()를 호출해 항상 화면 전체로 뜨게 고쳤는데, 이번엔 반대로 사용자가
원하는 크기로 줄여놔도 다음에 켤 때마다 다시 전체 화면으로 뜨는 문제가 됐다
(같은 계열의 문제를 밑색/웹툰3D 전용 창에서도 겪고 사용자가 "1번: 사용자가
한 번 맞춰두면 그 크기 그대로 열림"을 선택했음 -- 여기도 같은 방식으로
맞춘다).

기존에 있던 getConfig()/setConfig()(reflib-config.json 저장 파일, '마지막
라이브러리 경로' 등을 저장하던 것과 같은 파일)에 windowBounds를 같이
저장한다. 저장된 기록이 있으면 그 크기/위치로 창을 만들고(최대화 상태였으면
maximize()도 같이), 없으면(정말 처음 실행) 예전처럼 maximize()로 시작한다.
크기/위치가 바뀔 때마다(resize/move/maximize/unmaximize) 잠깐 뒤(500ms)
저장해서 다음 실행에 그대로 이어지게 한다. getNormalBounds()로 저장하는 건
maximize된 채로 저장하면 다음에 "복원" 눌렀을 때 크기가 이상해지는 걸
막기 위해서다(Electron 28 지원 API)."""
import sys

PATH = 'main.js'
with open(PATH, encoding='utf-8') as f:
    content = f.read()


def replace_once(old, new, label):
    global content
    n = content.count(old)
    if n != 1:
        print('FAIL %s: expected 1 occurrence, found %d' % (label, n))
        sys.exit(1)
    content = content.replace(old, new, 1)
    print('OK: %s' % label)


old = (
    "function createWindow() {\n"
    "  mainWindow = new BrowserWindow({\n"
    "    width: 1400,\n"
    "    height: 900,\n"
    "    minWidth: 480,\n"
    "    minHeight: 360,\n"
    "    backgroundColor: '#17181c',\n"
    "    frame: false, // 회색 기본 제목표시줄/메뉴바 대신 index.html 안의 커스텀 타이틀바로 통일된 디자인을 준다\n"
    "    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }\n"
    "  });\n"
    "  // (2026-09-06, 사용자 실측 -- \"또 창을 조정해야 되잖아\") 위 width/height(1400x900)는\n"
    "  // 화면 크기와 무관한 고정값이라, 화면이 그보다 크면 매번 창을 손으로 늘려야 했다.\n"
    "  // 생성 직후 maximize()를 호출해 실제 작업영역 크기에 맞춰 뜨게 한다 -- 이미 있는\n"
    "  // 커스텀 타이틀바의 최대화/복원 토글(window:toggle-maximize, maximize/unmaximize\n"
    "  // 이벤트 리스너)과 그대로 호환된다.\n"
    "  mainWindow.maximize();\n"
    "  // 상세 패널 안의 웹 임베드 미리보기(iframe)도 이 창의 UA를 그대로 쓰므로, 유튜브 등이 낯선 UA를 다르게\n"
    "  // 취급하지 않도록 데스크톱 크롬 UA로 맞춰둔다.\n"
    "  mainWindow.webContents.setUserAgent(DESKTOP_CHROME_UA);\n"
    "  mainWindow.loadFile('index.html');\n"
    "\n"
    "  // 최대화/복원 시 커스텀 타이틀바의 □/⧉ 아이콘을 맞춰 바꿔주기 위해 렌더러에 상태를 알려준다\n"
    "  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximize-changed', true));\n"
    "  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximize-changed', false));\n"
)

new = (
    "function createWindow() {\n"
    "  // (2026-09-06, 사용자 실측 -- \"레퍼런스앱도 창 크기가 너무 크게 떠. 줄이는 과정을\n"
    "  // 반복하고 있어\") 이전엔 여기서 항상 maximize()를 불러 매번 화면 전체로 띄웠는데,\n"
    "  // 그러면 사용자가 원하는 크기로 줄여놔도 다음 실행 때 다시 전체 화면이 되어버렸다.\n"
    "  // reflib-config.json(getConfig/setConfig, 기존에 '마지막 라이브러리 경로' 등을\n"
    "  // 저장하던 파일)에 windowBounds를 같이 저장해뒀다가, 있으면 그 크기/위치로 창을\n"
    "  // 만들고 없으면(정말 처음 실행) 예전처럼 maximize()로 시작한다. 밑색/웹툰3D\n"
    "  // 전용 창도 같은 방식(사용자가 조절한 크기를 기억)으로 맞춰뒀다.\n"
    "  const _cfg0 = getConfig();\n"
    "  const _wb = _cfg0.windowBounds;\n"
    "  const winOpts = {\n"
    "    width: 1400,\n"
    "    height: 900,\n"
    "    minWidth: 480,\n"
    "    minHeight: 360,\n"
    "    backgroundColor: '#17181c',\n"
    "    frame: false, // 회색 기본 제목표시줄/메뉴바 대신 index.html 안의 커스텀 타이틀바로 통일된 디자인을 준다\n"
    "    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }\n"
    "  };\n"
    "  if (_wb && Number.isFinite(_wb.width) && Number.isFinite(_wb.height)) {\n"
    "    winOpts.width = _wb.width;\n"
    "    winOpts.height = _wb.height;\n"
    "    if (Number.isFinite(_wb.x) && Number.isFinite(_wb.y)) {\n"
    "      winOpts.x = _wb.x;\n"
    "      winOpts.y = _wb.y;\n"
    "    }\n"
    "  }\n"
    "  mainWindow = new BrowserWindow(winOpts);\n"
    "  if (_wb ? _wb.maximized : true) {\n"
    "    // 저장된 기록이 최대화 상태였거나, 저장된 기록 자체가 없는(정말 처음 실행) 경우만\n"
    "    // maximize() -- 저장된 기록이 있는데 최대화가 아니었다면 위에서 준 winOpts.width/\n"
    "    // height/x/y 그대로 둔다.\n"
    "    mainWindow.maximize();\n"
    "  }\n"
    "  // 상세 패널 안의 웹 임베드 미리보기(iframe)도 이 창의 UA를 그대로 쓰므로, 유튜브 등이 낯선 UA를 다르게\n"
    "  // 취급하지 않도록 데스크톱 크롬 UA로 맞춰둔다.\n"
    "  mainWindow.webContents.setUserAgent(DESKTOP_CHROME_UA);\n"
    "  mainWindow.loadFile('index.html');\n"
    "\n"
    "  // (2026-09-06) 크기/위치/최대화 여부가 바뀔 때마다 잠깐 뒤(500ms, 드래그 중 매\n"
    "  // 프레임 디스크에 쓰지 않도록) reflib-config.json에 저장해서 다음 실행에 이어지게\n"
    "  // 한다. getNormalBounds()를 쓰는 건 최대화된 채로 저장해버리면 다음에 '복원'\n"
    "  // 눌렀을 때 크기가 이상해지기 때문이다.\n"
    "  let _persistTimer = null;\n"
    "  function _persistWindowBounds() {\n"
    "    try {\n"
    "      const c = getConfig();\n"
    "      const nb = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();\n"
    "      c.windowBounds = { width: nb.width, height: nb.height, x: nb.x, y: nb.y, maximized: mainWindow.isMaximized() };\n"
    "      setConfig(c);\n"
    "    } catch (e) {\n"
    "      // 창이 이미 파괴됐거나 파일 쓰기가 잠깐 실패해도 무시 -- 다음 변경 때 다시 시도된다.\n"
    "    }\n"
    "  }\n"
    "  function _scheduleWindowBoundsPersist() {\n"
    "    clearTimeout(_persistTimer);\n"
    "    _persistTimer = setTimeout(_persistWindowBounds, 500);\n"
    "  }\n"
    "  mainWindow.on('resize', _scheduleWindowBoundsPersist);\n"
    "  mainWindow.on('move', _scheduleWindowBoundsPersist);\n"
    "\n"
    "  // 최대화/복원 시 커스텀 타이틀바의 □/⧉ 아이콘을 맞춰 바꿔주기 위해 렌더러에 상태를 알려준다\n"
    "  mainWindow.on('maximize', () => { mainWindow.webContents.send('window:maximize-changed', true); _persistWindowBounds(); });\n"
    "  mainWindow.on('unmaximize', () => { mainWindow.webContents.send('window:maximize-changed', false); _persistWindowBounds(); });\n"
)

replace_once(old, new, 'remember window bounds instead of forcing maximize')

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCH REFLIB 5 APPLIED')
