@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title TrendScope
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

rem --- find Python (py launcher -> python -> python3) ---
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY ( where python3 >nul 2>nul && set "PY=python3" )
if not defined PY (
  echo [ERROR] Python not found. Install it from https://www.python.org/downloads/
  echo         and check "Add python.exe to PATH" during install.
  start https://www.python.org/downloads/
  pause
  exit /b 1
)

rem --- create venv on first run (no packages needed: standard library only) ---
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  %PY% -m venv .venv
)
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" server.py
) else (
  echo venv could not be created - running with system Python.
  %PY% server.py
)
pause
