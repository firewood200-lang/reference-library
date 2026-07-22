이 폴더는 ai-webtoon studio "reference-library" 앱의 node_modules 실제 저장 위치입니다.

- 구글 드라이브 동기화 오류를 막기 위해 일부러 드라이브 폴더 밖(이 로컬 폴더)에 두었습니다.
- 원래 위치(구글 드라이브 안의 reference-library\node_modules)에는 이 폴더를 가리키는
  접합(junction)만 있고, 실제 파일은 전부 여기 있습니다. 지우지 마세요.
- 실수로 지워도 큰 문제는 없습니다: reference-library 폴더에서 "npm install"을
  다시 실행하면 이 폴더가 새로 만들어집니다.
- 다른 컴퓨터(노트북/작업용)에는 이 폴더가 없으므로, 그 컴퓨터의 reference-library
  폴더에서도 각각 한 번씩 npm install을 실행해 주세요.
