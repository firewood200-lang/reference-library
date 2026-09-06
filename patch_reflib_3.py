# -*- coding: utf-8 -*-
"""reference-library/main.js 패치: open-flatcolor/open-comfyui/open-webtoon3d가
크롬 앱 창을 띄울 때 크기(w,h)를 화면 작업영역과 무관한 고정값(1500x950 /
1600x960)으로 쓰던 문제 수정(2026-09-06, 사용자 실측 -- "밑색앱 마찬가지야.
스크롤 내려도 최근결과는 보이지 않아", 이어서 "왜 스크롤이 최근결과까지
내려가지 않는거야?").

기존 코드는 창 '위치'(x,y)만 작업영역 안으로 clamp하고 '크기'는 그대로 뒀다.
그래서 작업영역 높이가 950/960보다 작은 화면에서는 창 아랫부분이 항상 화면
(또는 작업표시줄) 밖으로 나가버려, 그 안에서 페이지를 아무리 스크롤해도
맨 아래쪽 요소(밑색앱의 "최근 결과" 등)는 애초에 화면에 뜰 수 없었다.

레퍼런스앱 메인창에 이미 적용한 방식(mainWindow.maximize())과 같은 접근으로,
창 크기를 그 디스플레이의 작업영역 크기 그대로 쓰도록 바꾼다 -- 화면이 얼마든
항상 화면 전체(작업표시줄 제외)를 채운다."""
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


def sizing_block(w_h_line, tail_marker):
    return (
        "    %s\n"
        "    const mb = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;\n"
        "    const cx = mb ? mb.x + mb.width / 2 : null;\n"
        "    const cy = mb ? mb.y + mb.height / 2 : null;\n"
        "    const display = mb ? screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }) : screen.getPrimaryDisplay();\n"
        "    const work = display.workArea;\n"
        "    let x = mb ? Math.round(cx - w / 2) : Math.round(work.x + (work.width - w) / 2);\n"
        "    let y = mb ? Math.round(cy - h / 2) : Math.round(work.y + (work.height - h) / 2);\n"
        "    x = Math.max(work.x, Math.min(x, work.x + work.width - w));\n"
        "    y = Math.max(work.y, Math.min(y, work.y + work.height - h));\n"
        "    %s\n"
    ) % (w_h_line, tail_marker)


new_comment = (
    "    // (2026-09-06, 사용자 실측 -- \"밑색앱 마찬가지야. 스크롤 내려도\n"
    "    // 최근결과는 보이지 않아\", \"왜 스크롤이 최근결과까지 내려가지\n"
    "    // 않는거야?\") w/h를 고정값으로 뒀던 게 원인 -- 아래에서 구하는 작업영역\n"
    "    // (work)보다 그 값이 크면, 위치(x,y)만 화면 안으로 당겨질 뿐 창 크기\n"
    "    // 자체는 줄지 않아 창 아랫부분이 화면(또는 작업표시줄) 밖으로 나가버렸다\n"
    "    // -- 그 안에서는 페이지를 아무리 스크롤해도 맨 아래쪽 요소가 화면에 뜰 수\n"
    "    // 없었다. 메인창의 maximize()와 같은 접근으로, 창 크기를 그 디스플레이의\n"
    "    // 작업영역 크기 그대로 써서 화면이 얼마든 항상 전체가 보이게 한다.\n"
    "    const mb = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;\n"
    "    const cx = mb ? mb.x + mb.width / 2 : null;\n"
    "    const cy = mb ? mb.y + mb.height / 2 : null;\n"
    "    const display = mb ? screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) }) : screen.getPrimaryDisplay();\n"
    "    const work = display.workArea;\n"
    "    const w = work.width, h = work.height;\n"
    "    const x = work.x, y = work.y;\n"
    "    %s\n"
)

# ------------------------------------------------------------------
# 1) open-comfyui (w=1600,h=960, 뒤에 killChromeUsingProfile 없음)
# ------------------------------------------------------------------
replace_once(
    sizing_block('const w = 1600, h = 960;', 'const beforeHandles = await listChromeWindowHandles();'),
    new_comment % 'const beforeHandles = await listChromeWindowHandles();',
    'open-comfyui -> fill work area',
)

# ------------------------------------------------------------------
# 2) open-flatcolor (w=1500,h=950, 뒤에 killChromeUsingProfile(FLATCOLOR_PROFILE_DIR))
# ------------------------------------------------------------------
replace_once(
    sizing_block('const w = 1500, h = 950;', 'await killChromeUsingProfile(FLATCOLOR_PROFILE_DIR);'),
    new_comment % 'await killChromeUsingProfile(FLATCOLOR_PROFILE_DIR);',
    'open-flatcolor -> fill work area',
)

# ------------------------------------------------------------------
# 3) open-webtoon3d (w=1600,h=960, 뒤에 killChromeUsingProfile(WEBTOON3D_PROFILE_DIR))
# ------------------------------------------------------------------
replace_once(
    sizing_block('const w = 1600, h = 960;', 'await killChromeUsingProfile(WEBTOON3D_PROFILE_DIR);'),
    new_comment % 'await killChromeUsingProfile(WEBTOON3D_PROFILE_DIR);',
    'open-webtoon3d -> fill work area',
)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCH REFLIB 3 APPLIED')
