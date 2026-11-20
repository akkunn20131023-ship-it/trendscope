@echo off
chcp 65001 >nul
echo Stopping TrendScope on port 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr LISTENING') do (
  taskkill /F /PID %%a >nul 2>nul && echo   stopped PID %%a
)
timeout /t 2 /nobreak >nul
