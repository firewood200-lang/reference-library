@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo  reference-library 코드 변경사항을 GitHub에 저장합니다
echo ================================================
echo.
set /p MSG="이번에 뭘 고쳤는지 한 줄로 적어주세요 (그냥 엔터만 눌러도 됩니다): "
if "%MSG%"=="" set MSG=수정 %date% %time%

git add -A
git commit -m "%MSG%"
git push

echo.
echo ================================================
echo  완료되었습니다. 위에 빨간 오류 문구가 없으면 정상입니다.
echo  창을 닫으셔도 됩니다.
echo ================================================
pause
