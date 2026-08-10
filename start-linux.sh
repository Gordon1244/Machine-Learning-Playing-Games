#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8765
URL="http://localhost:${PORT}"
OUT_LOG="${SCRIPT_DIR}/.local-server.out.log"
ERR_LOG="${SCRIPT_DIR}/.local-server.err.log"

is_our_server() {
  if command -v curl >/dev/null 2>&1; then
    curl --max-time 1 -fsS "${URL}/api/health" 2>/dev/null | grep -q '"switch2-ai-local"'
  elif command -v wget >/dev/null 2>&1; then
    wget -T 1 -qO- "${URL}/api/health" 2>/dev/null | grep -q '"switch2-ai-local"'
  else
    return 1
  fi
}

if ! is_our_server; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON=python3
  elif command -v python >/dev/null 2>&1; then
    PYTHON=python
  else
    echo "Python 3 is required."
    exit 1
  fi

  nohup "${PYTHON}" "${SCRIPT_DIR}/server/app.py" --host 127.0.0.1 --port "${PORT}" >"${OUT_LOG}" 2>"${ERR_LOG}" &

  for _ in {1..20}; do
    sleep 0.25
    if is_our_server; then
      break
    fi
  done
fi

if ! is_our_server; then
  echo "Failed to start the local app server. Check ${ERR_LOG}."
  exit 1
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${URL}" >/dev/null 2>&1 &
elif command -v gio >/dev/null 2>&1; then
  gio open "${URL}" >/dev/null 2>&1 &
else
  echo "Open this URL in your browser: ${URL}"
fi

echo "Local app is ready: ${URL}"
