"""Knowledge graph of a player's games, mistakes, motifs, positions, openings and puzzles.

Neo4j is the real backend. `MemoryGraphStore` mirrors the same API in-process so the app
(and the tests) work without a database. Given a file path it saves itself there (a JSON
snapshot, written shortly after each change), so a restart or a `--reload` keeps your games.

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
import logging
import os
import threading
import time
from collections import Counter, defaultdict
from typing import Protocol

from .config import get_settings
from .review import ERRORS

log = logging.getLogger(__name__)


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
    # The saving player's side (the review may have been made from the opponent's side).
    color = game.get("player_color") or review.get("player_color")
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
    def list_reviews(self, username: str, since: int | None = None) -> list[tuple[dict, dict]]: ...
    def weakness_profile(self, username: str) -> dict: ...
    def puzzles(self, username: str, motif: str | None = None, limit: int = 20) -> list[dict]: ...
    def record_attempt(self, username: str, puzzle_id: str, solved: bool) -> dict: ...
    def get_progress(self, username: str) -> dict | None: ...
    def save_progress(self, username: str, progress: dict) -> None: ...
    def close(self) -> None: ...


def _game_row(game: dict, review: dict, color: str | None) -> dict:
    summary = review["summary"].get(color or "white", {})
    counts = summary.get("counts", {})
    return {
        **{k: v for k, v in game.items() if k != "pgn"},
        "player_color": color,
        "accuracy": summary.get("accuracy"),
        "counts": counts,
        # Flat copies (Neo4j properties can't hold maps) for the progress charts.
        "rating": game.get(f"{color}_rating") if color else None,
        "blunders": counts.get("blunder", 0),
        "mistakes": counts.get("mistake", 0),
        "inaccuracies": counts.get("inaccuracy", 0),
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
    FLUSH_DELAY_S = 1.0  # a 30-day analysis saves a game every few seconds; batch the writes

    def __init__(self, path: str | None = None) -> None:
        self._path = path
        self._flush_timer: threading.Timer | None = None
        self._lock = threading.Lock()
        self._reviews: dict[str, dict] = {}
        self._games: dict[tuple[str, str], dict] = {}  # (player, game_id) -> that player's row
        self._player_games: dict[str, set[str]] = defaultdict(set)
        self._mistakes: dict[str, list[dict]] = defaultdict(list)
        self._puzzles: dict[str, dict] = {}
        self._player_puzzles: dict[str, list[str]] = defaultdict(list)
        self._attempts: dict[tuple[str, str], dict] = {}
        self._progress: dict[str, dict] = {}
        if path:
            self._load(path)

    # Persistence: one JSON snapshot. Tuple keys are stored as [a, b] pairs.
    def _snapshot(self) -> dict:
        return {
            "version": 1,
            "reviews": self._reviews,
            "games": [[u, g, row] for (u, g), row in self._games.items()],
            "player_games": {u: sorted(ids) for u, ids in self._player_games.items()},
            "mistakes": self._mistakes,
            "puzzles": self._puzzles,
            "player_puzzles": self._player_puzzles,
            "attempts": [[u, p, a] for (u, p), a in self._attempts.items()],
            "progress": self._progress,
        }

    def _load(self, path: str) -> None:
        try:
            with open(path) as f:
                data = json.load(f)
        except FileNotFoundError:
            return
        except (OSError, ValueError) as e:
            # Keep the unreadable file for inspection rather than overwriting it with an empty store.
            log.warning("Could not read %s (%s); starting empty and moving it to %s.bad", path, e, path)
            try:
                os.replace(path, path + ".bad")
            except OSError:
                pass
            return
        self._reviews = data.get("reviews", {})
        self._games = {(u, g): row for u, g, row in data.get("games", [])}
        self._player_games = defaultdict(set, {u: set(ids) for u, ids in data.get("player_games", {}).items()})
        self._mistakes = defaultdict(list, data.get("mistakes", {}))
        self._puzzles = data.get("puzzles", {})
        self._player_puzzles = defaultdict(list, data.get("player_puzzles", {}))
        self._attempts = {(u, p): a for u, p, a in data.get("attempts", [])}
        self._progress = data.get("progress", {})
        log.info("Loaded %d reviewed games from %s", len(self._reviews), path)

    def _changed(self) -> None:
        """Schedule a save (call with the lock held)."""
        if not self._path or self._flush_timer is not None:
            return
        self._flush_timer = threading.Timer(self.FLUSH_DELAY_S, self.flush)
        self._flush_timer.daemon = True
        self._flush_timer.start()

    def flush(self) -> None:
        if not self._path:
            return
        with self._lock:
            self._flush_timer = None
            payload = json.dumps(self._snapshot(), separators=(",", ":"))
        os.makedirs(os.path.dirname(os.path.abspath(self._path)), exist_ok=True)
        tmp = f"{self._path}.tmp"
        with open(tmp, "w") as f:
            f.write(payload)
        os.replace(tmp, self._path)  # atomic: a crash mid-write never leaves half a file

    def save_review(self, username: str, game: dict, review: dict) -> None:
        user = username.lower()
        records = extract_records(user, game, review)
        gid = game["id"]
        with self._lock:
            self._reviews[gid] = review
            row = _game_row(game, review, records["color"])
            row["result"] = _player_result(game, records["color"])
            self._games[(user, gid)] = row
            self._player_games[user].add(gid)
            # A re-review (e.g. deeper) replaces this game's mistakes and puzzles instead of adding to them.
            self._mistakes[user] = [m for m in self._mistakes[user] if m["game_id"] != gid] + records["mistakes"]
            self._player_puzzles[user] = [p for p in self._player_puzzles[user] if self._puzzles[p]["game_id"] != gid]
            for pz in records["puzzles"]:
                self._puzzles[pz["id"]] = pz
                self._player_puzzles[user].append(pz["id"])
            self._changed()

    def get_review(self, game_id: str) -> dict | None:
        with self._lock:
            return self._reviews.get(game_id)

    def list_games(self, username: str, since: int | None = None, until: int | None = None) -> list[dict]:
        user = username.lower()
        with self._lock:  # job threads add games while requests read them
            rows = [self._games[(user, g)] for g in self._player_games.get(user, ())]
        rows = [r for r in rows if (since is None or r["end_time"] >= since) and (until is None or r["end_time"] < until)]
        return sorted(rows, key=lambda r: r["end_time"], reverse=True)

    def list_reviews(self, username: str, since: int | None = None) -> list[tuple[dict, dict]]:
        """(game row, full review) for each game this player reviewed, newest first."""
        rows = self.list_games(username, since)
        with self._lock:
            return [(r, self._reviews[r["id"]]) for r in rows if r["id"] in self._reviews]

    def weakness_profile(self, username: str) -> dict:
        user = username.lower()
        with self._lock:
            mistakes = list(self._mistakes.get(user, []))
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
        with self._lock:
            pids = list(self._player_puzzles.get(user, []))
        for pid in pids:
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
            self._changed()
        return att

    def get_progress(self, username: str) -> dict | None:
        return self._progress.get(username.lower())

    def save_progress(self, username: str, progress: dict) -> None:
        with self._lock:
            self._progress[username.lower()] = progress
            self._changed()

    def close(self) -> None:
        with self._lock:
            timer, self._flush_timer = self._flush_timer, None
        if timer:
            timer.cancel()
        self.flush()


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
                    SET r.color = $color, r.result = $result, r.accuracy = $accuracy, r.rating = $rating,
                        r.blunders = $blunders, r.mistakes = $mistake_count, r.inaccuracies = $inaccuracies
                    MERGE (opp)-[:PLAYED {color: $opp_color}]->(g)
                    MERGE (o:Opening {key: $eco + '|' + $opening})
                    SET o.eco = $eco, o.name = $opening
                    MERGE (g)-[:IN_OPENING]->(o)
                    WITH p, g
                    // A re-review replaces this player's mistakes (and their puzzles) in this game.
                    OPTIONAL MATCH (p)-[:MADE]->(old:Mistake)-[:IN_GAME]->(g)
                    WHERE NOT old.id IN [m IN $mistakes | m.id]
                    OPTIONAL MATCH (oldpz:Puzzle)-[:FROM_MISTAKE]->(old)
                    DETACH DELETE oldpz, old
                    WITH DISTINCT p, g
                    UNWIND $mistakes AS m
                    MERGE (mk:Mistake {id: m.id})
                    SET mk.ply = m.ply, mk.san = m.san, mk.best_san = m.best_san,
                        mk.classification = m.classification, mk.win_loss = m.win_loss,
                        mk.phase = m.phase, mk.fen = m.fen
                    MERGE (p)-[:MADE]->(mk)
                    MERGE (mk)-[:IN_GAME]->(g)
                    MERGE (pos:Position {key: m.position})
                    MERGE (mk)-[:AT_POSITION]->(pos)
                    WITH mk, m
                    OPTIONAL MATCH (mk)-[stale:HAS_MOTIF]->()
                    DELETE stale
                    WITH DISTINCT mk, m
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
                    blunders=row["blunders"], mistake_count=row["mistakes"], inaccuracies=row["inaccuracies"],
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
                WHERE r.result IS NOT NULL
                  AND ($since IS NULL OR g.end_time >= $since) AND ($until IS NULL OR g.end_time < $until)
                RETURN g {.*, review: null} AS game, r {.*} AS edge,
                       CASE WHEN r.blunders IS NULL THEN g.review END AS old_review
                ORDER BY g.end_time DESC
                """,
                user=username.lower(), since=since, until=until,
            )
            rows = []
            for rec in result:
                edge = rec["edge"]
                # The game node is shared by both players; this player's side lives on their PLAYED edge.
                row = {**{k: v for k, v in rec["game"].items() if k != "review"}, "result": edge.get("result"),
                       "player_color": edge.get("color"), "accuracy": edge.get("accuracy"), "rating": edge.get("rating")}
                if rec["old_review"]:  # saved before the per-player chart fields existed
                    row = {**row, **{k: v for k, v in _game_row(row, json.loads(rec["old_review"]), edge.get("color")).items()
                                     if k in {"blunders", "mistakes", "inaccuracies", "counts"}}}
                else:
                    row.update(blunders=edge.get("blunders"), mistakes=edge.get("mistakes"), inaccuracies=edge.get("inaccuracies"))
                rows.append(row)
            return rows

    def list_reviews(self, username: str, since: int | None = None) -> list[tuple[dict, dict]]:
        with self._driver.session() as s:
            result = s.run(
                """
                MATCH (:Player {username: $user})-[r:PLAYED]->(g:Game)
                WHERE r.result IS NOT NULL AND ($since IS NULL OR g.end_time >= $since) AND g.review IS NOT NULL
                RETURN g.id AS id, g.review AS review
                """,
                user=username.lower(), since=since,
            )
            reviews = {rec["id"]: json.loads(rec["review"]) for rec in result}
        return [(row, reviews[row["id"]]) for row in self.list_games(username, since) if row["id"] in reviews]

    def weakness_profile(self, username: str) -> dict:
        user = username.lower()
        with self._driver.session() as s:
            # Only games this player reviewed (an opponent's review also links them to the game).
            games = s.run("MATCH (:Player {username: $u})-[r:PLAYED]->(g) WHERE r.result IS NOT NULL RETURN count(g) AS n",
                          u=user).single()["n"]
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
                WHERE r.result IS NOT NULL
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
_store_lock = threading.Lock()


def get_store() -> GraphStore:
    global _store
    with _store_lock:  # concurrent first requests must not open two drivers
        if _store is None:
            settings = get_settings()
            if settings.neo4j_uri:
                _store = Neo4jGraphStore(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password)
            else:
                _store = MemoryGraphStore(settings.memory_store_file or None)
        return _store
