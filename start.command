#!/bin/bash
cd "$(dirname "$0")"
export PYTHONIOENCODING=utf-8
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "Python 3 が見つかりません。https://www.python.org/downloads/ からインストールしてください。"
  open "https://www.python.org/downloads/"; read -p "Enterで閉じる"; exit 1
fi
[ -x .venv/bin/python ] || "$PY" -m venv .venv
if [ -x .venv/bin/python ]; then .venv/bin/python server.py; else "$PY" server.py; fi
