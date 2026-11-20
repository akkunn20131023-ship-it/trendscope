@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Stopping TrendScope on port 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>nul && echo   stopped PID %%a
)
timeout /t 1 /nobreak >nul
call "%~dp0start.bat"
