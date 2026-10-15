#!/bin/zsh
set -e
cd -- "${0:A:h}"

if [[ ! -x .venv/bin/python ]]; then
  bootstrap_python=""
  for candidate in python3.12 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && \
       "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
      bootstrap_python="$candidate"
      break
    fi
  done
  if [[ -z "$bootstrap_python" ]]; then
    print -u2 'Python 3.10 이상을 먼저 설치하세요. Python 3.12를 권장합니다.'
    exit 1
  fi
  "$bootstrap_python" -m venv .venv
fi

if ! .venv/bin/python -c 'from importlib.metadata import version; import PySide6.QtWidgets; assert version("PySide6-Essentials") == "6.12.0"' >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r requirements.txt
fi

exec .venv/bin/python desktop_main.py
