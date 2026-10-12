"""Answer "what went wrong?" questions about any stretch of games.

    parse_scope    "my latest game", "yesterday", "last 10 games", "this week" -> a time window / count
    gather_games   the games in scope from chess.com (plus the ones before, for rating changes),
                   reviewing any that aren't reviewed yet
    build_report   exact facts: record, rating change per time control, the decisive moment of each
                   game, recurring patterns, time trouble, opening deviations
    study_plan     what to work on, with links to puzzles, course lines and endgame lessons
    render_answer  a Markdown answer whose game/move mentions are hover-preview links

Everything here is deterministic; the coach's LLM (when there is one) only re-voices it.
"""

from __future__ import annotations

import re
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from .. import chesscom, coaching, repertoire
from ..engine import get_engine
from ..graph_store import get_store
from ..review import review_pgn
from ..review_cache import cached_review, reuse_depth

MAX_REVIEW = 20  # games reviewed on demand for one question
ERRORS = {"blunder", "mistake", "miss"}
TIME_PRESSURE_S = 30

Progress = Callable[[str, float], None]


@dataclass
class Scope:
    label: str
    start: int | None = None  # unix seconds; None = no time limit (count-based)
    end: int | None = None
    count: int | None = None  # the last N games


_NUMBER_WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_GAME_WORDS = re.compile(r"\b(games?|played|elo|rating|lost|lose|losing|went wrong|go wrong|blunder\w*|mistakes?|"
                         r"yesterday|today|tonight|this (week|month)|last (week|month))\b", re.I)


def wants_games(message: str) -> bool:
    """Is the question about the player's own recent games?"""
    return bool(_GAME_WORDS.search(message))


def parse_scope(message: str, now: float | None = None, tz_offset: int = 0) -> Scope:
    """Which games a question is about. Days are local days (tz_offset = minutes east of UTC)."""
    msg = message.lower()
    tz = timezone(timedelta(minutes=tz_offset))
    local_now = datetime.fromtimestamp(now if now is not None else time.time(), tz)
    midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    def day(offset: int, label: str) -> Scope:
        start = midnight - timedelta(days=offset)
        return Scope(label, int(start.timestamp()), int((start + timedelta(days=1)).timestamp()))

    def days(n: int, label: str) -> Scope:
        return Scope(label, int((midnight - timedelta(days=n - 1)).timestamp()), int(local_now.timestamp()) + 60)

    if m := re.search(r"\blast\s+(\d+|" + "|".join(_NUMBER_WORDS) + r")\s+games?\b", msg):
        n = int(m.group(1)) if m.group(1).isdigit() else _NUMBER_WORDS[m.group(1)]
        return Scope(f"your last {n} games", count=max(1, min(n, 50)))
    if re.search(r"\b(latest|last|most recent|previous|recent)\s+(game|match|loss)\b", msg):
        return Scope("your latest game", count=1)
    if "yesterday" in msg:
        return day(1, "yesterday")
    if re.search(r"\b(today|tonight|this morning|this evening)\b", msg):
        return day(0, "today")
    if m := re.search(r"\b(?:last|past)\s+(\d+)\s+days\b", msg):
        n = max(1, min(int(m.group(1)), 90))
        return days(n, f"the last {n} days")
    if re.search(r"\b(this|last|past)\s+week\b", msg):
        return days(7, "the last 7 days")
    if re.search(r"\b(this|last|past)\s+month\b", msg):
        return days(30, "the last 30 days")
    if re.search(r"\b(elo|rating)\b", msg):
        return days(7, "the last 7 days")
    return Scope("your latest game", count=1)


def gather_games(username: str, scope: Scope, depth: int, progress: Progress,
                 fetch: Callable[[str, int, int], list] | None = None) -> tuple[list[dict], list[dict], dict[str, dict]]:
    """(games in scope, games just before them, reviews by id). Reviews games that need it."""
    fetch = fetch or chesscom.fetch_games_between
    now = int(time.time())
    end = scope.end or now + 60
    # Look further back than the scope so each time control has a "rating before".
    start = (scope.start or end - 30 * 86400) - 30 * 86400
    progress("Fetching your games from chess.com", 0.02)
    # Oldest first: rating changes are worked out game by game in order.
    games = sorted(({**g.to_dict(), "pgn": g.pgn} for g in fetch(username, start, end)), key=lambda g: g["end_time"])
    if scope.count:
        in_scope = games[-scope.count:]
    else:
        in_scope = [g for g in games if g["end_time"] >= scope.start]
    earlier = [g for g in games if g not in in_scope]
    in_scope = in_scope[-MAX_REVIEW:]

    store, reviews = get_store(), {}
    todo = []
    for g in in_scope:
        cached = cached_review(store, username, g["id"], reuse_depth(depth), g)
        if cached:
            reviews[g["id"]] = cached
        else:
            todo.append(g)
    for i, g in enumerate(todo):
        def on_position(done: int, total: int, i: int = i) -> None:
            progress(f"Reviewing game {i + 1} of {len(todo)}", 0.05 + 0.85 * (i + done / total) / len(todo))

        review = review_pgn(g["pgn"], get_engine(), depth=depth, player_color=g.get("player_color"), progress=on_position)
        review["game"] = {k: v for k, v in g.items() if k != "pgn"}
        store.save_review(username, g, review)
        reviews[g["id"]] = review
    return in_scope, earlier, reviews


def _studied_courses(username: str) -> set[str] | None:
    progress = get_store().get_progress(username)
    if not progress:
        return None
    ids = {key.split("/", 1)[0] for key, lp in progress.get("lines", {}).items() if lp.get("stage", 0) > 0}
    return ids or None


def build_report(username: str, scope: Scope, games: list[dict], earlier: list[dict], reviews: dict[str, dict]) -> dict:
    """The facts behind the answer, all computed from the reviews."""
    last_rating: dict[str, int] = {}
    for g in earlier:
        color = g.get("player_color")
        if color and g.get(f"{color}_rating"):
            last_rating[g["time_class"]] = g[f"{color}_rating"]

    rows, moments = [], []
    results: Counter = Counter()
    rating: dict[str, dict] = {}
    motifs: Counter = Counter()
    phase_loss: Counter = Counter()
    time_trouble, lost_on_time, streak, worst_streak = 0, 0, 0, 0
    studied = _studied_courses(username)
    openings = []

    for g in games:
        review = reviews[g["id"]]
        color = g.get("player_color") or review.get("player_color") or "white"
        opp_color = "black" if color == "white" else "white"
        opponent = g[opp_color]
        result = chesscom._normalise_result(g.get(f"{color}_result", ""))
        results[result] += 1
        streak = streak + 1 if result == "loss" else 0
        worst_streak = max(worst_streak, streak)
        if result == "loss" and g.get(f"{color}_result") == "timeout":
            lost_on_time += 1

        after = g.get(f"{color}_rating")
        change = after - last_rating[g["time_class"]] if after and g["time_class"] in last_rating else None
        if after:
            r = rating.setdefault(g["time_class"], {"time_class": g["time_class"], "games": 0,
                                                    "start": last_rating.get(g["time_class"], after - (change or 0))})
            r["games"] += 1
            r["end"] = after
            last_rating[g["time_class"]] = after

        mine = [m for m in review["moves"] if m["color"] == color]
        errors = [m for m in mine if m["classification"] in ERRORS]
        for m in mine:
            for motif in m["motifs"]:
                if motif.endswith("_phase"):
                    if m["classification"] in ERRORS:
                        phase_loss[motif.removesuffix("_phase")] += m["win_loss"]
                elif m["classification"] in ERRORS:
                    motifs[motif] += 1
            if m["classification"] in ERRORS and m.get("clock") is not None and m["clock"] < TIME_PRESSURE_S:
                time_trouble += 1
        decisive = max(errors, key=lambda m: m["win_loss"], default=None)
        for m in sorted(errors, key=lambda m: -m["win_loss"])[:3]:
            moments.append({**{k: m[k] for k in ("ply", "move_number", "san", "best_san", "win_loss", "classification",
                                                  "fen_before", "motifs", "best_line")},
                            "win_before": m["win_before"], "win_after": m["win_after"], "clock": m.get("clock"),
                            "game_id": g["id"], "opponent": opponent})
        note = repertoire.check_game([m["san"] for m in review["moves"]], color, g["id"], opponent, studied)
        if note:
            openings.append(note)
        rows.append({
            "id": g["id"], "url": g.get("url", ""), "opponent": opponent, "color": color, "result": result,
            "termination": g.get(f"{color}_result"), "accuracy": review["summary"][color]["accuracy"],
            "opponent_accuracy": review["summary"][opp_color]["accuracy"], "counts": review["summary"][color]["counts"],
            "time_class": g["time_class"], "opening": g.get("opening"), "eco": g.get("eco"), "end_time": g["end_time"],
            "rating": after, "rating_change": change,
            "decisive": {"ply": decisive["ply"], "san": decisive["san"], "move_number": decisive["move_number"]} if decisive else None,
        })

    for r in rating.values():
        r["change"] = r["end"] - r["start"]
    profile = get_store().weakness_profile(username)
    historical = {m["motif"]: m["count"] for m in profile.get("motifs", [])}
    moments.sort(key=lambda m: -m["win_loss"])
    accs = [r["accuracy"] for r in rows if r["accuracy"] is not None]
    return {
        "scope": {"label": scope.label, "start": scope.start, "end": scope.end, "count": scope.count},
        "username": username,
        "record": {"games": len(rows), "wins": results["win"], "draws": results["draw"], "losses": results["loss"]},
        "avg_accuracy": round(sum(accs) / len(accs), 1) if accs else None,
        "rating": sorted(rating.values(), key=lambda r: -r["games"]),
        "games": rows,
        "moments": moments[:8],
        "patterns": {
            "motifs": [{"motif": k, "count": v, "all_time": historical.get(k, v), **coaching.motif_info(k)}
                       for k, v in motifs.most_common(5)],
            "weakest_phase": phase_loss.most_common(1)[0][0] if phase_loss else None,
            "time_trouble_errors": time_trouble,
            "lost_on_time": lost_on_time,
            "loss_streak": worst_streak,
        },
        "openings": openings,
    }


def study_plan(report: dict) -> list[dict]:
    """Concrete next steps, most important first, each with somewhere to go."""
    u = report["username"]
    plan: list[dict] = []
    pats = report["patterns"]
    for m in pats["motifs"][:2]:
        plan.append({"kind": "puzzles", "title": f"Puzzles: {m['title']}",
                     "why": f"{m['count']} error{'s' if m['count'] != 1 else ''} here"
                            + (f", {m['all_time']} in all your reviewed games" if m["all_time"] > m["count"] else "")
                            + f". {m['drill']}",
                     "link": f"/u/{u}/puzzles?motif={m['motif']}"})
    seen_lines = set()
    for note in report["openings"]:
        key = (note.get("course_id"), note.get("line_id"))
        if note.get("kind") == "you_deviated" and note.get("line_id") and key not in seen_lines and len(seen_lines) < 2:
            seen_lines.add(key)
            plan.append({"kind": "course", "title": f"Course: {note['line_name'] or note['course_name']}",
                         "why": f"Against {note['opponent']} you played {note['played']} where your {note['course_name']} "
                                f"course plays {note['expected']}.",
                         "link": f"/courses/{note['course_id']}/learn/{note['line_id']}"})
    endgame_moment = next((m for m in report["moments"] if "endgame_phase" in m["motifs"]), None)
    if pats["weakest_phase"] == "endgame" or endgame_moment:
        lesson = coaching.endgame_lesson_for(endgame_moment["fen_before"] if endgame_moment else None)
        if lesson:
            plan.append({"kind": "endgame", "title": f"Endgame: {lesson['title']}",
                         "why": "Your costliest errors came in the endgame.", "link": f"/endgames/{lesson['id']}"})
    if pats["time_trouble_errors"] >= 2 or pats["lost_on_time"]:
        plan.append({"kind": "habit", "title": "Manage your clock",
                     "why": f"{pats['time_trouble_errors']} errors with under {TIME_PRESSURE_S}s left"
                            + (f" and {pats['lost_on_time']} game(s) lost on time" if pats["lost_on_time"] else "")
                            + ". Keep a third of your time for the last phase; play a few games with increment.",
                     "link": None})
    if pats["loss_streak"] >= 3:
        plan.append({"kind": "habit", "title": "Stop after two losses in a row",
                     "why": f"You lost {pats['loss_streak']} in a row. Tilt costs more rating than any opening.",
                     "link": None})
    worst = min((g for g in report["games"] if g["accuracy"] is not None and g["result"] == "loss"),
                key=lambda g: g["accuracy"], default=None)
    if worst:
        plan.append({"kind": "review", "title": f"Replay your game vs {worst['opponent']}",
                     "why": f"Your lowest accuracy ({worst['accuracy']}) in a loss: retry the key moments.",
                     "link": f"/u/{u}/game/{worst['id']}" + (f"?ply={worst['decisive']['ply']}" if worst["decisive"] else "")})
    return plan[:6]


def _pct(x: float) -> str:
    return f"{x:.0f}%"


def render_answer(report: dict, plan: list[dict], include_plan: bool = False) -> str:
    """The deterministic answer: exact numbers, with game: and move: links for hover previews."""
    rec, scope = report["record"], report["scope"]
    if not rec["games"]:
        return f"I couldn't find any games for {scope['label']}. Play a few and ask again."
    out = []
    head = f"**{scope['label'].capitalize()}: {rec['wins']}W {rec['losses']}L {rec['draws']}D**"
    if report["avg_accuracy"] is not None:
        head += f", average accuracy {report['avg_accuracy']}"
    out.append(head + ".")
    for r in report["rating"]:
        sign = "+" if r["change"] > 0 else ""
        out.append(f"- {r['time_class'].capitalize()} rating: {r['start']} → {r['end']} (**{sign}{r['change']}**) over {r['games']} game{'s' if r['games'] != 1 else ''}.")

    out.append("\n### What went wrong")
    by_game = {g["id"]: g for g in report["games"]}
    shown = 0
    for g in sorted(report["games"], key=lambda g: (g["result"] != "loss", g["accuracy"] or 100)):
        moment = next((m for m in report["moments"] if m["game_id"] == g["id"]), None)
        delta = f", {g['rating_change']:+d}" if g.get("rating_change") is not None else ""
        line = f"- vs [{g['opponent']}](game:{g['id']}) ({g['result']}{delta}, accuracy {g['accuracy'] if g['accuracy'] is not None else '–'})"
        if moment:
            tags = [coaching.motif_info(t)["title"].lower() for t in moment["motifs"] if not t.endswith("_phase")]
            clock = f" with {moment['clock']:.0f}s on the clock" if moment.get("clock") is not None and moment["clock"] < TIME_PRESSURE_S else ""
            line += (f": the turning point was move {moment['move_number']}, [**{moment['san']}**](move:{g['id']}:{moment['ply']}), "
                     f"a {moment['classification']}{clock}. [**{moment['best_san']}**](move:{g['id']}:{moment['ply']}:best) was best; "
                     f"your winning chances went from {_pct(moment['win_before'])} to {_pct(moment['win_after'])}"
                     + (f" ({', '.join(tags)})" if tags else "") + ".")
        elif g["result"] == "loss":
            line += ": no single blunder; the game slipped away move by move, so look at your inaccuracies."
        else:
            line += ": clean, no mistakes or blunders."
        out.append(line)
        shown += 1
        if shown >= 8:
            break
    for note in report["openings"][:3]:
        if note.get("kind") == "you_deviated":
            g = by_game.get(note["game_id"])
            if g:
                out.append(f"- Opening: vs [{note['opponent']}](game:{g['id']}) you played {note['played']} on move "
                           f"{(note['ply'] + 1) // 2}; your {note['course_name']} course plays {note['expected']}.")

    pats = report["patterns"]
    pattern_lines = []
    for m in pats["motifs"][:3]:
        again = f" ({m['all_time']} times in all your games: a habit, not a one-off)" if m["all_time"] - m["count"] >= 2 else ""
        pattern_lines.append(f"- **{m['title']}** ×{m['count']}{again}. {m['lesson']}")
    if pats["weakest_phase"]:
        pattern_lines.append(f"- Most of the damage happened in the **{pats['weakest_phase']}**.")
    if pats["time_trouble_errors"]:
        pattern_lines.append(f"- {pats['time_trouble_errors']} of your errors came with under {TIME_PRESSURE_S}s on the clock.")
    if pats["loss_streak"] >= 3:
        pattern_lines.append(f"- You lost {pats['loss_streak']} games in a row: that's tilt.")
    if pattern_lines:
        out.append("\n### Patterns")
        out += pattern_lines

    if plan and include_plan:  # the app shows the plan as cards under the answer
        out.append("\n### What to study")
        for i, p in enumerate(plan, 1):
            title = f"[{p['title']}]({p['link']})" if p.get("link") else f"**{p['title']}**"
            out.append(f"{i}. {title}: {p['why']}")
    return "\n".join(out)


def answer_question(username: str, message: str, depth: int, progress: Progress, tz_offset: int = 0,
                    fetch: Callable[[str, int, int], list] | None = None) -> dict:
    scope = parse_scope(message, tz_offset=tz_offset)
    games, earlier, reviews = gather_games(username, scope, depth, progress, fetch=fetch)
    progress("Working out what went wrong", 0.92)
    report = build_report(username, scope, games, earlier, reviews)
    plan = study_plan(report)
    report["plan"] = plan
    return {"report": report, "answer": render_answer(report, plan)}
