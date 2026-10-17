#!/usr/bin/env bash
# Mac / Linux: run with  ./start.sh  (or: bash start.sh)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again."
  echo
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing, this takes about a minute the first time..."
  npm install --no-audit --no-fund || { echo "Install failed. Check your internet connection."; exit 1; }
fi

[ -f .env ] || cp .env.example .env

( sleep 3
  if command -v open >/dev/null 2>&1; then open http://localhost:3000
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3000; fi ) &

node server.js
