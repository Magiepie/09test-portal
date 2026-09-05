#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node.js 20 or newer is required."; exit 1; }
command -v npm >/dev/null || { echo "npm is required."; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required."; exit 1; }

if [[ ! -f .env ]]; then
  echo "Copy .env.example to .env and configure its paths and password first."
  exit 1
fi
[[ -d node_modules ]] || npm install
[[ -x .venv/bin/python3 ]] || python3 -m venv .venv
.venv/bin/python3 -c 'import requests' 2>/dev/null || .venv/bin/python3 -m pip install 'requests~=2.32.3'

echo "Starting 09Test Portal at http://localhost:24247"
exec npm start
