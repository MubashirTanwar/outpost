# ChessCoach

A free, self-hosted alternative to chess.com's premium features. Enter your chess.com username and get:

- **Day Review**: every game you played on a given day, analysed by Stockfish and reviewed move by move with chess.com-style classifications (Brilliant `!!`, Great `!`, Best, Excellent, Good, Book, Inaccuracy `?!`, Mistake `?`, Miss, Blunder `??`), accuracy scores, key moments, and a written lesson from an AI coach.
- **Game Review**: a chess.com-style review screen with eval bar, advantage graph, move list with classification icons, best-move arrows, a "Retry" mode for your mistakes, and an AI "Explain" button.
- **Your Puzzles**: every mistake you make becomes a puzzle, served with spaced repetition and filterable by theme (forks, hanging pieces, back-rank, missed mates…).
- **AI Coach chat**: ask about your weaknesses, openings, or a specific position.
- **Opening trainer**: drill 28 repertoire lines move by move.
- **Endgame trainer**: Lucena, Philidor, basic mates and more, played out against Stockfish.
- **Analysis board**: Stockfish 17.1 running in your browser, with three lines.

The UI copies the look of chess.com: dark theme, cream-and-brown board, animated pieces, and move/capture/check sounds. The sounds are synthesised in the browser and the piece set is the open-licensed one bundled with react-chessboard; chess.com's own artwork and audio are not included.

## Architecture

```
                 ┌──────────────────────── web (Next.js, Vercel-ready) ────────────────────────┐
                 │  React UI · react-chessboard · chess.js · Stockfish WASM in a Web Worker    │
                 │  Browser-only mode: in-browser review + localStorage when no API is set     │
                 └───────────────────────────────┬─────────────────────────────────────────────┘
                                                 │ REST (NEXT_PUBLIC_API_URL)
┌──────────────────────────────────── api (FastAPI) ───────────────────────────────────────────┐
│  chess.com public API → review.py (native Stockfish, multipv 2) → classifications/motifs     │
│                                                                                              │
│  LangGraph agents                                                                            │
│   day_review:  fetch_games → analyze_games → summarize_day → mine_patterns → coach_lesson    │
│                → training_plan                                                               │
│   coach chat:  classify_intent → [analyze_position] → [load_profile] → [load_openings]       │
│                → respond                                                                     │
│                                                                                              │
│  LLM: Claude (Anthropic API) · Ollama (free, local) · or none (template coaching)            │
└───────────────────────────────┬──────────────────────────────────────────────────────────────┘
                                │ Bolt
                ┌───────────── Neo4j knowledge graph ─────────────┐
                │ (Player)-[:PLAYED]->(Game)-[:IN_OPENING]->(Opening)
                │ (Player)-[:MADE]->(Mistake)-[:AT_POSITION]->(Position)
                │ (Mistake)-[:HAS_MOTIF]->(Motif)
                │ (Puzzle)-[:FROM_MISTAKE]->(Mistake)
                │ (Player)-[:ATTEMPTED {streak}]->(Puzzle)
                └──────────────────────────────────────────────────┘
```

The graph lets the coach tell a one-off slip from a habit. It can see, for example, that you keep hanging pieces, or that you have gone wrong in the same position more than once across different games, because positions are stored by FEN and shared between games.

### How moves are classified

Each position is analysed with MultiPV 2. Evaluations are converted to winning chances with Lichess' curve (`50 + 50·(2/(1+e^(−0.00368·cp)) − 1)`). The drop in winning chances decides the class: <2 excellent, <5 good, <10 inaccuracy, <20 mistake, otherwise blunder. On top of that:

- **Best**: you played the engine's top move.
- **Great**: the top move, where the second-best move was at least 15% worse (the only good move).
- **Brilliant**: a near-best move that sacrifices material (checked along the engine line, or by leaving a piece en prise) and still leaves you at least equal.
- **Miss**: a mistake or blunder that failed to punish your opponent's own mistake.
- **Book / Forced**: opening theory, or the only legal move.

Accuracy uses Lichess' per-move formula, blended from the arithmetic and harmonic means. Mistakes are tagged with motifs: `hanging_piece`, `fork`, `pin`, `allowed_mate`, `back_rank`, `missed_mate`, `missed_tactic`, `weakened_king`, `time_pressure`, plus the game phase. The same logic runs in Python (`backend/app/review.py`) and TypeScript (`web/src/lib/classify.ts`), and both have the same tests.

## Run it locally (full stack)

```bash
cd chess-coach
docker compose up --build                    # Neo4j + API + web, template coaching
# or with a free local LLM:
docker compose --profile ollama up --build
docker compose exec ollama ollama pull llama3.1
# or with Claude:
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

Open http://localhost:3000. Neo4j's browser is at http://localhost:7474 (user `neo4j`, password `chesscoach`). Try `MATCH (p:Player)-[:MADE]->(m)-[:HAS_MOTIF]->(mo) RETURN mo.name, count(*)`.

### Without Docker

```bash
# Backend
brew install stockfish          # or: apt install stockfish
cd chess-coach/backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env            # set STOCKFISH_PATH, NEO4J_URI (blank = in-memory), LLM_PROVIDER
uvicorn app.main:app --reload

# Frontend
cd ../web
npm install                     # also copies the Stockfish WASM build into public/
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

## Deploy the frontend to Vercel

1. Import the repo in Vercel and set **Root Directory** to `chess-coach/web`.
2. Optionally set `NEXT_PUBLIC_API_URL` to a backend you host (any machine running the Docker image, or your own computer through a tunnel such as `cloudflared tunnel --url http://localhost:8000`). Set `CORS_ORIGINS` on the backend to your Vercel URL.

With no backend, the Vercel deploy runs in **browser-only mode**. Game and day reviews run with Stockfish WASM in your browser and are stored in `localStorage`, and puzzles from your mistakes, the opening and endgame trainers and the analysis board all work. The AI coach and the cross-game pattern graph need the backend.

## Configuration (backend)

| Variable | Default | |
|---|---|---|
| `STOCKFISH_PATH` | `stockfish` | Binary path, or a command such as `node /path/stockfish.js` |
| `ENGINE_DEPTH` | `14` | Depth per position. 16-18 gives better reviews but is slower |
| `NEO4J_URI` | *(empty)* | Empty = in-memory graph (lost on restart) |
| `LLM_PROVIDER` | `none` | `anthropic`, `ollama`, or `none` |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Effort is set by `ANTHROPIC_EFFORT` (default `medium`) |
| `OLLAMA_MODEL` | `llama3.1` | Any model you have pulled |

With `LLM_PROVIDER=anthropic`, requests opt into server-side refusal fallbacks (`fallbacks: "default"`). Whatever the provider, if the LLM is unreachable the agents fall back to template coaching, so a review never fails because of the LLM.

## Tests

```bash
cd backend && pytest                       # classifier, agents (fake engine), API
STOCKFISH_PATH=/usr/games/stockfish pytest # + real-engine test
NEO4J_TEST_URI=bolt://localhost:7687 pytest tests/test_neo4j.py
cd ../web && npm test && npm run typecheck && npm run build
```

CI (`.github/workflows/chess-coach.yml`) runs all of these against real Stockfish and Neo4j.
