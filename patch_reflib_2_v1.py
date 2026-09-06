# -*- coding: utf-8 -*-
"""reference-library/main.js 패치: 전용 --user-data-dir 프로필을 쓰는 앱
링크(밑색·웹툰 3D)가, 그 프로필을 물고 있는 크롬 프로세스가 이미 떠 있으면
새로 실행해도 진짜 새 프로세스가 아니라 기존 프로세스에 위임만 되어(주석에
이미 문서화된 크롬의 알려진 동작) 코드/화면을 고쳐도 반영되지 않는 문제
수정(2026-09-06, 사용자 실측 -- "레퍼런스앱 앱링크들이 앱들을 수정한 뒤에
열면 수정한 UI 등을 반영하지 않는 문제", "조금 전에도 반영안해서 수정했잖아").

크롬을 새로 띄우기 직전에 그 프로필을 물고 있는 기존 chrome.exe를 찾아
먼저 강제 종료해서, 매번 확실히 새 프로세스로 뜨게 한다.

주의(사용자에게 안내 필요): 이러면 그 앱 창이 이미 열려 작업 중이었어도
"밑색"/"웹툰 3D"를 다시 누르면 그 창이 강제로 닫히고 새로 뜬다 -- 기존에는
그냥 기존 창을 그대로 두고 위임만 됐다(포커스 이동 정도). flatcolor는 이미
창을 닫으면 서버까지 같이 강제 종료되는 걸 감수하는 설계라 이 변경도 같은
위험 수준이지만, 진행 중이던 작업(예: 명암 프롬프트 입력만 하고 실행은
안 누른 상태)이 있으면 그 내용이 날아갈 수 있다."""
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
# 1) 공용 헬퍼 함수 추가 (listChromeWindowHandles 바로 앞)
# ------------------------------------------------------------------
helper_src = '''// (2026-09-06, 사용자 실측 -- "레퍼런스앱 앱링크들이 앱들을 수정한 뒤에 열면
// 수정한 UI 등을 반영하지 않는 문제") 전용 --user-data-dir 프로필(밑색·웹툰 3D)을
// 쓰는 앱 링크는, 그 프로필을 물고 있는 크롬 프로세스가 이미 떠 있으면 새로 실행해도
// 진짜 새 프로세스가 뜨는 게 아니라 기존 프로세스에 "창 하나 열어줘"라고 위임만
// 되어(위 listChromeWindowHandles 주석에 이미 나오는 크롬의 알려진 동작) 그 사이에
// 고친 코드/화면이 반영되지 않는 문제가 있었다. 크롬을 새로 띄우기 직전에 그 프로필을
// 물고 있는 기존 chrome.exe를 찾아 먼저 강제 종료해서, 매번 확실히 새 프로세스로
// 뜨게 한다(경로에 특수문자가 있어도 안전하도록 커맨드라인 비교값은 환경변수로
// 넘긴다 -- PowerShell 문자열 이스케이프를 피하기 위함).
function killChromeUsingProfile(profileDir) {
  return new Promise((resolve) => {
    const psScript = [
      '$procs = Get-CimInstance Win32_Process -Filter "Name=\\'chrome.exe\\'"',
      'foreach ($p in $procs) {',
      '  if ($p.CommandLine -and $p.CommandLine.Contains($env:REFLIB_KILL_PROFILE)) {',
      '    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue',
      '  }',
      '}'
    ].join('\\n');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      windowsHide: true,
      env: Object.assign({}, process.env, { REFLIB_KILL_PROFILE: profileDir })
    });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}

'''
replace_once(
    'function listChromeWindowHandles() {\n',
    helper_src + 'function listChromeWindowHandles() {\n',
    'add killChromeUsingProfile helper',
)

# ------------------------------------------------------------------
# 2) open-flatcolor: 크롬 스폰 직전에 기존 프로세스 종료
# ------------------------------------------------------------------
replace_once(
    "    const beforeHandles = await listChromeWindowHandles();\n"
    "    const child = spawn(exePath, [\n"
    "      `--app=${FLATCOLOR_URL}`,\n",
    "    await killChromeUsingProfile(FLATCOLOR_PROFILE_DIR);\n"
    "    const beforeHandles = await listChromeWindowHandles();\n"
    "    const child = spawn(exePath, [\n"
    "      `--app=${FLATCOLOR_URL}`,\n",
    'open-flatcolor -> kill stale profile process before spawn',
)

# ------------------------------------------------------------------
# 3) open-webtoon3d: 크롬 스폰 직전에 기존 프로세스 종료
# ------------------------------------------------------------------
replace_once(
    "    const beforeHandles = await listChromeWindowHandles();\n"
    "    const child = spawn(exePath, [\n"
    "      `--app=${WEBTOON3D_URL}`,\n",
    "    await killChromeUsingProfile(WEBTOON3D_PROFILE_DIR);\n"
    "    const beforeHandles = await listChromeWindowHandles();\n"
    "    const child = spawn(exePath, [\n"
    "      `--app=${WEBTOON3D_URL}`,\n",
    'open-webtoon3d -> kill stale profile process before spawn',
)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)
print('PATCH REFLIB 2 APPLIED')
