@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem --- Run TrendScope in the background with a tray icon (no black window) ---
if not exist ".venv\Scripts\pythonw.exe" (
  where py >nul 2>nul && (py -3 -m venv .venv) || (python -m venv .venv)
)
if exist ".venv\Scripts\pythonw.exe" (
  start "" ".venv\Scripts\pythonw.exe" server.py --tray
) else (
  start "" pythonw server.py --tray
)
