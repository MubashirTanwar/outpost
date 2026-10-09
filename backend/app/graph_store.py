"""Knowledge graph of a player's games, mistakes, motifs, positions, openings and puzzles.

Neo4j is the real backend. `MemoryGraphStore` mirrors the same API in-process so the app
(and the tests) work without a database; it does not persist across restarts.

Graph model (Neo4j):

    (:Player)-[:PLAYED {color, result, accuracy, rating}]->(:Game)-[:IN_OPENING]->(:Opening)
    (:Player)-[:MADE]->(:Mistake)-[:IN_GAME]->(:Game)
    (:Mistake)-[:AT_POSITION]->(:Position)      # same position across games = recurring hole
    (:Mistake)-[:HAS_MOTIF]->(:Motif)           # fork, hanging_piece, back_rank, ...
    (:Puzzle)-[:FROM_MISTAKE]->(:Mistake)
    (:Player)-[:ATTEMPTED {solved, attempts, streak, last_at}]->(:Puzzle)
    (:Player)-[:STUDIED {stage, due, reviews, lapses}]->(:CourseLine {id, course})
"""

from __future__ import annotations

import json
import threading
import time
from collections import Counter, defaultdict
from typing import Protocol

from .config import get_settings
from .review import ERRORS


def position_key(fen: str) -> str:
    """FEN without the move counters, so transpositions from different games match."""
    return " ".join(fen.split()[:4])


def _puzzle_solution(move: dict) -> list[str]:
    """The line the solver has to find. Always ends on the solver's move (odd length)."""
    pv = move.get("best_pv") or []
    if not pv:
        return []
    motifs = set(move.get("motifs", []))
    if "missed_mate" in motifs:
        plies = 5  # the whole mating sequence, up to three of your moves
    elif motifs & {"missed_tactic", "hanging_piece", "fork", "pin", "allowed_mate"}:
        plies = 3  # you, their reply, your follow-up
    else:
        plies = 1  # positional: find the move (the app still plays their reply)
    plies = min(plies, len(pv))
    return pv[: plies if plies % 2 == 1 else plies - 1]


def extract_records(username: str, game: dict, review: dict) -> dict:
    """Turn a reviewed game into the mistake and puzzle records the graph stores."""
    color = review.get("player_color") or game.get("player_color")
    mistakes, puzzles = [], []
    for move in review["moves"]:
        if move["color"] != color or move["classification"] not in ERRORS:
            continue
        mistake_id = f"{game['id']}:{move['ply']}"
        mistakes.append({
            "id": mistake_id,
            "game_id": game["id"],
            "ply": move["ply"],
            "san": move["san"],
            "best_san": move["best_san"],
            "classification": move["classification"],
            "win_loss": move["win_loss"],
            "phase": move["phase"],
            "fen": move["fen_before"],
            "position": position_key(move["fen_before"]),
            "motifs": [m for m in move["motifs"] if not m.endswith("_phase")],
        })
        solution = _puzzle_solution(move)
        if solution and move["classification"] in {"mistake", "blunder", "miss"}:
            motifs = mistakes[-1]["motifs"] or ["positional"]
            puzzles.append({
                "id": f"pz-{mistake_id}",
                "mistake_id": mistake_id,
                "game_id": game["id"],
                "fen": move["fen_before"],
                "solution": solution,
                "played": move["san"],
                "best_san": move["best_san"],
                "motifs": motifs,
                "theme": motifs[0],
                "win_loss": move["win_loss"],
                "phase": move["phase"],
            })
    return {"color": color, "mistakes": mistakes, "puzzles": puzzles}


class GraphStore(Protocol):
    backend: str

    def save_review(self, username: str, game: dict, review: dict) -> None: ...
    def get_review(self, game_id: str) -> dict | None: ...
    def list_games(self, username: str, since: int | None = None, until: int | None = None) -> list[dict]: ...
    def weakness_profile(self, username: str) -> dict: ...
    def puzzles(self, username: str, motif: str | None = None, limit: int = 20) -> list[dict]: ...
    def record_attempt(self, username: str, puzzle_id: str, solved: bool) -> dict: ...
    def get_progress(self, username: str) -> dict | None: ...
    def save_progress(self, username: str, progress: dict) -> None: ...
    def close(self) -> None: ...


def _game_row(game: dict, review: dict, color: str | None) -> dict:
    summary = review["summary"].get(color or "white", {})
    return {
        **{k: v for k, v in game.items() if k != "pgn"},
        "player_color": color,
        "accuracy": summary.get("accuracy"),
        "counts": summary.get("counts", {}),
    }


def _opening_key(game: dict) -> tuple[str, str]:
    return game.get("eco") or "?", game.get("opening") or "Unknown opening"


def _player_result(game: dict, color: str | None) -> str:
    code = game.get(f"{color}_result", "") if color else ""
    if code == "win":
        return "win"
    if code in {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}:
        return "draw"
    return "loss" if code else "unknown"


class MemoryGraphStore:
    backend = "memory"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._reviews: dict[str, dict] = {}
        self._games: dict[str, dict] = {}  # game_id -> row
        self._player_games: dict[str, set[str]] = defaultdict(set)
        self._mistakes: dict[str, list[dict]] = defaultdict(list)
        self._puzzles: dict[str, dict] = {}
        self._player_puzzles: dict[str, list[str]] = defaultdict(list)
        self._attempts: dict[tuple[str, str], dict] = {}
        self._progress: dict[str, dict] = {}

    def save_review(self, username: str, game: dict, review: dict) -> None:
        user = username.lower()
        records = extract_records(user, game, review)
        with self._lock:
            self._reviews[game["id"]] = review
            row = _game_row(game, review, records["color"])
            row["result"] = _player_result(game, records["color"])
            self._games[game["id"]] = row
            if game["id"] not in self._player_games[user]:
                self._player_games[user].add(game["id"])
                self._mistakes[user].extend(records["mistakes"])
                for pz in records["puzzles"]:
                    self._puzzles[pz["id"]] = pz
                    self._player_puzzles[user].append(pz["id"])

    def get_review(self, game_id: str) -> dict | None:
        return self._reviews.get(game_id)

    def list_games(self, username: str, since: int | None = None, until: int | None = None) -> list[dict]:
        rows = [self._games[g] for g in self._player_games.get(username.lower(), ())]
        rows = [r for r in rows if (since is None or r["end_time"] >= since) and (until is None or r["end_time"] < until)]
        return sorted(rows, key=lambda r: r["end_time"], reverse=True)

    def weakness_profile(self, username: str) -> dict:
        user = username.lower()
        mistakes = self._mistakes.get(user, [])
        motif_stats: dict[str, list[float]] = defaultdict(list)
        for m in mistakes:
            for motif in m["motifs"]:
                motif_stats[motif].append(m["win_loss"])
        phase_stats: dict[str, list[float]] = defaultdict(list)
        for m in mistakes:
            phase_stats[m["phase"]].append(m["win_loss"])
        positions = Counter(m["position"] for m in mistakes)
        recurring = []
        for key, times in positions.most_common():
            if times < 2:
                break
            sample = next(m for m in mistakes if m["position"] == key)
            recurring.append({"fen": sample["fen"], "times": times, "best_san": sample["best_san"]})

        openings: dict[tuple[str, str], dict] = {}
        for row in self.list_games(user):
            key = _opening_key(row)
            o = openings.setdefault(key, {"eco": key[0], "name": key[1], "games": 0, "win": 0, "draw": 0, "loss": 0, "acc": []})
            o["games"] += 1
            if row["result"] in ("win", "draw", "loss"):
                o[row["result"]] += 1
            if row["accuracy"] is not None:
                o["acc"].append(row["accuracy"])
        opening_rows = []
        for o in openings.values():
            acc = o.pop("acc")
            o["avg_accuracy"] = round(sum(acc) / len(acc), 1) if acc else None
            opening_rows.append(o)

        return _profile(
            games=len(self._player_games.get(user, ())),
            motifs=[{"motif": k, "count": len(v), "avg_loss": round(sum(v) / len(v), 1)} for k, v in motif_stats.items()],
            phases=[{"phase": k, "count": len(v), "avg_loss": round(sum(v) / len(v), 1)} for k, v in phase_stats.items()],
            openings=opening_rows,
            recurring=recurring,
            classifications=Counter(m["classification"] for m in mistakes),
        )

    def puzzles(self, username: str, motif: str | None = None, limit: int = 20) -> list[dict]:
        user = username.lower()
        out = []
        for pid in self._player_puzzles.get(user, []):
            pz = self._puzzles[pid]
            if motif and motif not in pz["motifs"]:
                continue
            attempt = self._attempts.get((user, pid))
            out.append({**pz, "attempt": attempt})
        return sorted(out, key=_puzzle_priority)[:limit]

    def record_attempt(self, username: str, puzzle_id: str, solved: bool) -> dict:
        key = (username.lower(), puzzle_id)
        with self._lock:
            prev = self._attempts.get(key) or {"attempts": 0, "streak": 0}
            att = {
                "attempts": prev["attempts"] + 1,
                "streak": prev["streak"] + 1 if solved else 0,
                "solved": solved,
                "last_at": int(time.time()),
            }
            self._attempts[key] = att
        return att

    def get_progress(self, username: str) -> dict | None:
        return self._progress.get(username.lower())

    def save_progress(self, username: str, progress: dict) -> None:
        with self._lock:
            self._progress[username.lower()] = progress

    def close(self) -> None:
        pass


def _puzzle_priority(pz: dict) -> tuple:
    """Spaced repetition-ish: unseen first, then failed, then solved ones whose streak is short."""
    att = pz.get("attempt")
    if not att:
        return (0, -pz["win_loss"])
    if not att["solved"]:
        return (1, att["last_at"])
    return (2, att["streak"], att["last_at"])


def _profile(*, games: int, motifs: list, phases: list, openings: list, recurring: list, classifications) -> dict:
    motifs.sort(key=lambda m: (-m["count"], -m["avg_loss"]))
    phases.sort(key=lambda p: -p["count"])
    openings.sort(key=lambda o: -o["games"])
    return {
        "games_analyzed": games,
        "motifs": motifs,
        "phases": phases,
        "openings": openings,
        "recurring_positions": recurring[:10],
        "error_totals": dict(classifications),
    }


class Neo4jGraphStore:
    backend = "neo4j"

    def __init__(self, uri: str, user: str, password: str) -> None:
        from neo4j import GraphDatabase

        self._driver = GraphDatabase.driver(uri, auth=(user, password))
        self._driver.verify_connectivity()
        with self._driver.session() as s:
            for stmt in (
                "CREATE CONSTRAINT player_name IF NOT EXISTS FOR (p:Player) REQUIRE p.username IS UNIQUE",
                "CREATE CONSTRAINT game_id IF NOT EXISTS FOR (g:Game) REQUIRE g.id IS UNIQUE",
                "CREATE CONSTRAINT mistake_id IF NOT EXISTS FOR (m:Mistake) REQUIRE m.id IS UNIQUE",
                "CREATE CONSTRAINT position_key IF NOT EXISTS FOR (p:Position) REQUIRE p.key IS UNIQUE",
                "CREATE CONSTRAINT motif_name IF NOT EXISTS FOR (m:Motif) REQUIRE m.name IS UNIQUE",
                "CREATE CONSTRAINT puzzle_id IF NOT EXISTS FOR (p:Puzzle) REQUIRE p.id IS UNIQUE",
                "CREATE CONSTRAINT opening_key IF NOT EXISTS FOR (o:Opening) REQUIRE o.key IS UNIQUE",
            ):
                s.run(stmt)

    def save_review(self, username: str, game: dict, review: dict) -> None:
        user = username.lower()
        records = extract_records(user, game, review)
        color = records["color"]
        row = _game_row(game, review, color)
        eco, opening = _opening_key(game)
        opponent = (game.get("black") if color == "white" else game.get("white")) or "?"
        with self._driver.session() as s:
            s.execute_write(
                lambda tx: tx.run(
                    """
                    MERGE (p:Player {username: $user})
                    MERGE (opp:Player {username: $opponent})
                    MERGE (g:Game {id: $id})
                    SET g += $props, g.review = $review
                    MERGE (p)-[r:PLAYED]->(g)
                    SET r.color = $color, r.result = $result, r.accuracy = $accuracy, r.rating = $rating
                    MERGE (opp)-[:PLAYED {color: $opp_color}]->(g)
                    MERGE (o:Opening {key: $eco + '|' + $opening})
                    SET o.eco = $eco, o.name = $opening
                    MERGE (g)-[:IN_OPENING]->(o)
                    WITH p, g
                    UNWIND $mistakes AS m
                    MERGE (mk:Mistake {id: m.id})
                    SET mk.ply = m.ply, mk.san = m.san, mk.best_san = m.best_san,
                        mk.classification = m.classification, mk.win_loss = m.win_loss,
                        mk.phase = m.phase, mk.fen = m.fen
                    MERGE (p)-[:MADE]->(mk)
                    MERGE (mk)-[:IN_GAME]->(g)
                    MERGE (pos:Position {key: m.position})
                    MERGE (mk)-[:AT_POSITION]->(pos)
                    FOREACH (name IN m.motifs |
                        MERGE (mo:Motif {name: name})
                        MERGE (mk)-[:HAS_MOTIF]->(mo))
                    """,
                    user=user,
                    opponent=opponent.lower(),
                    id=game["id"],
                    props={k: v for k, v in row.items() if isinstance(v, (str, int, float, bool)) or v is None},
                    review=json.dumps(review),
                    color=color,
                    opp_color="black" if color == "white" else "white",
                    result=_player_result(game, color),
                    accuracy=row["accuracy"],
                    rating=game.get(f"{color}_rating") if color else None,
                    eco=eco,
                    opening=opening,
                    mistakes=records["mistakes"],
                ).consume()
            )
            if records["puzzles"]:
                s.execute_write(
                    lambda tx: tx.run(
                        """
                        UNWIND $puzzles AS pz
                        MATCH (mk:Mistake {id: pz.mistake_id})
                        MERGE (z:Puzzle {id: pz.id})
                        SET z += pz
                        MERGE (z)-[:FROM_MISTAKE]->(mk)
                        """,
                        puzzles=records["puzzles"],
                    ).consume()
                )

    def get_review(self, game_id: str) -> dict | None:
        with self._driver.session() as s:
            rec = s.run("MATCH (g:Game {id: $id}) RETURN g.review AS review", id=game_id).single()
        return json.loads(rec["review"]) if rec and rec["review"] else None

    def list_games(self, username: str, since: int | None = None, until: int | None = None) -> list[dict]:
        with self._driver.session() as s:
            result = s.run(
                """
                MATCH (:Player {username: $user})-[r:PLAYED]->(g:Game)
                WHERE ($since IS NULL OR g.end_time >= $since) AND ($until IS NULL OR g.end_time < $until)
                RETURN g {.*, review: null} AS game, r.result AS result
                ORDER BY g.end_time DESC
                """,
                user=username.lower(), since=since, until=until,
            )
            return [{**{k: v for k, v in rec["game"].items() if k != "review"}, "result": rec["result"]} for rec in result]

    def weakness_profile(self, username: str) -> dict:
        user = username.lower()
        with self._driver.session() as s:
            games = s.run("MATCH (:Player {username: $u})-[:PLAYED]->(g) RETURN count(g) AS n", u=user).single()["n"]
            motifs = s.run(
                """
                MATCH (:Player {username: $u})-[:MADE]->(mk)-[:HAS_MOTIF]->(mo)
                RETURN mo.name AS motif, count(mk) AS count, round(avg(mk.win_loss), 1) AS avg_loss
                """, u=user).data()
            phases = s.run(
                """
                MATCH (:Player {username: $u})-[:MADE]->(mk)
                RETURN mk.phase AS phase, count(mk) AS count, round(avg(mk.win_loss), 1) AS avg_loss
                """, u=user).data()
            openings = s.run(
                """
                MATCH (:Player {username: $u})-[r:PLAYED]->(g)-[:IN_OPENING]->(o)
                RETURN o.eco AS eco, o.name AS name, count(g) AS games,
                       sum(CASE r.result WHEN 'win' THEN 1 ELSE 0 END) AS win,
                       sum(CASE r.result WHEN 'draw' THEN 1 ELSE 0 END) AS draw,
                       sum(CASE r.result WHEN 'loss' THEN 1 ELSE 0 END) AS loss,
                       round(avg(r.accuracy), 1) AS avg_accuracy
                """, u=user).data()
            recurring = s.run(
                """
                MATCH (:Player {username: $u})-[:MADE]->(mk)-[:AT_POSITION]->(pos)
                WITH pos, collect(mk) AS ms WHERE size(ms) >= 2
                RETURN ms[0].fen AS fen, size(ms) AS times, ms[0].best_san AS best_san
                ORDER BY times DESC LIMIT 10
                """, u=user).data()
            totals = s.run(
                "MATCH (:Player {username: $u})-[:MADE]->(mk) RETURN mk.classification AS c, count(*) AS n", u=user
            ).data()
        return _profile(
            games=games, motifs=motifs, phases=phases, openings=openings, recurring=recurring,
            classifications=Counter({t["c"]: t["n"] for t in totals}),
        )

    def puzzles(self, username: str, motif: str | None = None, limit: int = 20) -> list[dict]:
        with self._driver.session() as s:
            rows = s.run(
                """
                MATCH (p:Player {username: $u})-[:MADE]->(:Mistake)<-[:FROM_MISTAKE]-(z:Puzzle)
                WHERE $motif IS NULL OR $motif IN z.motifs
                OPTIONAL MATCH (p)-[a:ATTEMPTED]->(z)
                RETURN z {.*} AS puzzle, a {.*} AS attempt
                """, u=username.lower(), motif=motif).data()
        out = [{**r["puzzle"], "attempt": r["attempt"] or None} for r in rows]
        return sorted(out, key=_puzzle_priority)[:limit]

    def record_attempt(self, username: str, puzzle_id: str, solved: bool) -> dict:
        with self._driver.session() as s:
            rec = s.execute_write(
                lambda tx: tx.run(
                    """
                    MATCH (p:Player {username: $u}), (z:Puzzle {id: $id})
                    MERGE (p)-[a:ATTEMPTED]->(z)
                    SET a.attempts = coalesce(a.attempts, 0) + 1,
                        a.streak = CASE WHEN $solved THEN coalesce(a.streak, 0) + 1 ELSE 0 END,
                        a.solved = $solved, a.last_at = timestamp() / 1000
                    RETURN a {.*} AS attempt
                    """, u=username.lower(), id=puzzle_id, solved=solved).single()
            )
        return rec["attempt"] if rec else {}

    def get_progress(self, username: str) -> dict | None:
        with self._driver.session() as s:
            rec = s.run("MATCH (p:Player {username: $u}) RETURN p.course_progress AS progress", u=username.lower()).single()
        return json.loads(rec["progress"]) if rec and rec["progress"] else None

    def save_progress(self, username: str, progress: dict) -> None:
        lines = [
            {"id": key, "course": key.split("/", 1)[0], "stage": lp.get("stage", 0), "due": lp.get("due", 0),
             "reviews": lp.get("reviews", 0), "lapses": lp.get("lapses", 0)}
            for key, lp in progress.get("lines", {}).items()
        ]
        with self._driver.session() as s:
            s.execute_write(
                lambda tx: tx.run(
                    """
                    MERGE (p:Player {username: $u})
                    SET p.course_progress = $blob, p.xp = $xp
                    WITH p
                    UNWIND $lines AS l
                    MERGE (cl:CourseLine {id: l.id})
                    SET cl.course = l.course
                    MERGE (p)-[r:STUDIED]->(cl)
                    SET r.stage = l.stage, r.due = l.due, r.reviews = l.reviews, r.lapses = l.lapses
                    """,
                    u=username.lower(), blob=json.dumps(progress), xp=progress.get("xp", 0), lines=lines,
                ).consume()
            )

    def close(self) -> None:
        self._driver.close()


_store: GraphStore | None = None


def get_store() -> GraphStore:
    global _store
    if _store is None:
        settings = get_settings()
        if settings.neo4j_uri:
            _store = Neo4jGraphStore(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
        else:
            _store = MemoryGraphStore()
    return _store
