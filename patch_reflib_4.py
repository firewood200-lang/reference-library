# -*- coding: utf-8 -*-
"""reference-library/main.js 패치: 밑색/웹툰3D 전용 크롬 프로필(.appwindow_reflib)에
저장된 마지막 창 위치/크기 기록이 --window-size/--window-position 명령줄 값보다
우선 적용되는 문제 수정(2026-09-06, 사용자 실측 -- "마찬가지야. 스크롤을 내리면
최근결과가 보여야 하는데 안보여. 창을 키워야 하는데 거의 끝까지 키워야 해").

실측: .appwindow_reflib/Default/Preferences 안 browser.app_window_placement에
work_area=2560x1392인데 저장된 창 크기는 1370x680(left=624,top=237,right=1994,
bottom=917)로 남아있었다 -- 오늘 앞서 실행.bat에서 찾은 것과 같은 크롬의 알려진
동작(_window_size.py 참고). open-flatcolor/open-webtoon3d(전용 프로필을 쓰는
두 곳)에 크롬을 새로 띄우기 직전 이 저장 기록을 지우는 처리를 추가한다.
ComfyUI는 전용 프로필이 없어(--user-data-dir 자체를 안 씀) 이 문제와 무관하므로
건드리지 않는다."""
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


# ------------------------------------------------------------------
# 1) 공용 헬퍼 함수 추가 (killChromeUsingProfile 바로 앞)
# ------------------------------------------------------------------
helper_src = '''// (2026-09-06, 사용자 실측 -- "마찬가지야. 스크롤을 내리면 최근결과가
// 보여야 하는데 안보여. 창을 키워야 하는데 거의 끝까지 키워야 해") 크롬은
// --app 모드 창의 마지막 위치/크기를 그 프로필 안 Default/Preferences에
// URL별로 저장해뒀다가, 다음 실행 때 --window-size/--window-position보다 그
// 저장값을 우선 적용한다(실행.bat 쪽 문제를 고쳤던 _window_size.py와 동일한
// 원인 -- 거기서는 파이썬으로, 여기서는 이 프로필을 직접 다루는 main.js에서
// 처리해야 해서 같은 역할의 함수를 JS로 다시 둔다). 크롬을 새로 띄우기
// 직전에 그 저장 기록을 지워서, 매번 명령줄 값(작업영역 전체 크기)이
// 항상 이기게 한다.
function clearAppWindowPlacement(profileDir) {
  const prefPath = path.join(profileDir, 'Default', 'Preferences');
  try {
    const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
    if (prefs.browser && prefs.browser.app_window_placement) {
      delete prefs.browser.app_window_placement;
      fs.writeFileSync(prefPath, JSON.stringify(prefs));
    }
  } catch (e) {
    // 프로필이 아직 없거나(첫 실행) 파일이 잠겨 있어도 무시한다 -- 이 지우기는
    // "다음 실행부터 더 잘 맞기 위한" 보정일 뿐이라 실패해도 이번 실행을 막을
    // 이유는 없다.
  }
}

'''
replace_once(
    'function killChromeUsingProfile(profileDir) {\n',
    helper_src + 'function killChromeUsingProfile(profileDir) {\n',
    'add clearAppWindowPlacement helper',
)

# ------------------------------------------------------------------
# 2) open-flatcolor: 킬 직후 저장 기록도 지움
# ------------------------------------------------------------------
replace_once(
    "    await killChromeUsingProfile(FLATCOLOR_PROFILE_DIR);\n",
    "    await killChromeUsingProfile(FLATCOLOR_PROFILE_DIR);\n"
    "    clearAppWindowPlacement(FLATCOLOR_PROFILE_DIR);\n",
    'open-flatcolor -> clear saved window placement',
)

# ------------------------------------------------------------------
# 3) open-webtoon3d: 킬 직후 저장 기록도 지움
# ------------------------------------------------------------------
replace_once(
    "    await killChromeUsingProfile(WEBTOON3D_PROFILE_DIR);\n",
    "    await killChromeUsingProfile(WEBTOON3D_PROFILE_DIR);\n"
    "    clearAppWindowPlacement(WEBTOON3D_PROFILE_DIR);\n",
    'open-webtoon3d -> clear saved window placement',
)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCH REFLIB 4 APPLIED')
