# -*- coding: utf-8 -*-
"""main.js에서 ipcMain.handle('open-flatcolor', ...) 핸들러 전체 본문을
중괄호 짝을 실제로 세어 정확히 추출한다(grep -A N 같은 줄수 기반 비교는
앞쪽에 한 줄만 추가돼도 뒤쪽이 밀려서 오탐이 나므로 쓰지 않는다).
사용법: python3 extract_handler.py <main.js 경로> <출력 파일 경로>"""
import sys

src_path = sys.argv[1]
out_path = sys.argv[2]

with open(src_path, encoding='utf-8') as f:
    content = f.read()

marker = "ipcMain.handle('open-flatcolor'"
start = content.find(marker)
if start == -1:
    print('FAIL: marker not found in %s' % src_path)
    sys.exit(1)

# marker 위치부터 첫 '{' 찾기
brace_start = content.find('{', start)
if brace_start == -1:
    print('FAIL: no opening brace found')
    sys.exit(1)

depth = 0
i = brace_start
end = None
while i < len(content):
    c = content[i]
    if c == '{':
        depth += 1
    elif c == '}':
        depth -= 1
        if depth == 0:
            end = i
            break
    i += 1

if end is None:
    print('FAIL: matching closing brace not found')
    sys.exit(1)

# 핸들러 전체(ipcMain.handle(... ) 호출 끝 ');'까지 몇 글자 더 포함)
tail = content[end:end+5]
full = content[start:end+1]

with open(out_path, 'w', encoding='utf-8') as f:
    f.write(full)

print('OK: extracted %d chars, tail after closing brace: %r' % (len(full), tail))
