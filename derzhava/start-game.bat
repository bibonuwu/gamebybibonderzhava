@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Устанавливаю зависимости...
  call npm install
)
echo.
echo Игра запускается. На компьютере откройте http://localhost:5173
echo На телефоне (та же Wi-Fi сеть) откройте адрес из строки "Network" ниже.
echo Чтобы остановить игру — закройте это окно.
echo.
call npm run dev
pause
