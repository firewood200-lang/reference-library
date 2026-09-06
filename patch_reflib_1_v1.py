# -*- coding: utf-8 -*-
"""reference-library/main.js 패치: 메인 창이 항상 고정 1400x900로 뜨는
문제 수정(2026-09-06, 사용자 실측 -- "또 창을 조정해야 되잖아", flatcolor와는
별개의 원인 -- 여기는 저장된 창 위치를 덮어쓰는 게 아니라 애초에 화면
크기와 무관하게 1400x900으로 고정 생성하고 있었음). 창을 만든 직후
maximize()를 호출해 실제 화면(작업표시줄 제외 작업영역) 크기에 맞춰
뜨게 한다 -- 커스텀 타이틀바의 최대화/복원 토글(이미 있는 window:toggle-maximize,
maximize/unmaximize 이벤트 리스너)과 완전히 호환되므로 별도 처리가
필요 없다."""
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
    "    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }\n"
    "  });\n"
    "  // 상세 패널 안의 웹 임베드 미리보기(iframe)도 이 창의 UA를 그대로 쓰므로, 유튜브 등이 낯선 UA를 다르게\n"
    "  // 취급하지 않도록 데스크톱 크롬 UA로 맞춰둔다.\n"
    "  mainWindow.webContents.setUserAgent(DESKTOP_CHROME_UA);\n"
)

new = (
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
)

replace_once(old, new, 'maximize main window on create')

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCH REFLIB 1 APPLIED')
