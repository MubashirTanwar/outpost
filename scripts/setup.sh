#!/usr/bin/env bash
# One-time local setup without Docker: Python venv for the API, npm deps for the web app.
# Usage: ./scripts/setup.sh   then follow the printed "run" commands.
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1 ($2)"; exit 1; }; }
need python3 "Python 3.11+"
need node "Node.js 24 (https://nodejs.org)"
need npm "comes with Node.js"

if ! command -v stockfish >/dev/null 2>&1 && [ ! -x /usr/games/stockfish ]; then
  echo "Stockfish not found. Install it:  macOS: brew install stockfish   Ubuntu: sudo apt install stockfish"
  echo "Windows: download from https://stockfishchess.org/download/ and set STOCKFISH_PATH in backend/.env"
fi

echo "==> Backend (Python)"
python3 -m venv backend/.venv
backend/.venv/bin/pip install -q --upgrade pip
backend/.venv/bin/pip install -q -r backend/requirements-dev.txt
[ -f backend/.env ] || cp backend/.env.example backend/.env

echo "==> Course data"
backend/.venv/bin/python courses/build.py --check >/dev/null || backend/.venv/bin/python courses/build.py

echo "==> Web (Next.js)"
(cd web && npm install --no-fund --no-audit)
[ -f web/.env.local ] || echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > web/.env.local

cat <<MSG

Done. To run:
  1. Graph DB (optional, needs Docker):  docker run -d -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/chesscoach neo4j:5.26-community
     (or leave NEO4J_URI empty in backend/.env to use the in-memory graph)
  2. API:  cd backend && .venv/bin/uvicorn app.main:app --reload
  3. Web:  cd web && npm run dev     -> http://localhost:3000

Or run everything with Docker:  docker compose up --build
MSG
