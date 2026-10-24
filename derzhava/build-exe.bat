@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Устанавливаю зависимости...
  call npm install
)
set ELECTRON_RUN_AS_NODE=
echo.
echo Собираю программу для Windows — это займёт пару минут...
echo.
call npm run exe
echo.
echo Готово! Файлы в папке release:
echo   Derzhava-Setup-0.1.0.exe       — установщик (ярлык на рабочем столе и в меню Пуск)
echo   Derzhava-0.1.0-portable.exe    — запуск без установки (можно скинуть на флешку)
echo.
explorer release
pause
