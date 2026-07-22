@echo off
chcp 65001 > nul
cd /d "%~dp0"
node -v > nul 2>&1
if errorlevel 1 (
  echo Node.js 20 이상을 먼저 설치해 주세요.
  pause
  exit /b 1
)
if not exist data\model.json (
  call npm run build
)
call npm start
pause
