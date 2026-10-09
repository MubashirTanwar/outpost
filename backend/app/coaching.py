"""Chess teaching content: motif explanations, drills, and template-written coaching used
when no LLM is configured (and as grounding context when one is)."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

MOTIFS: dict[str, dict[str, str]] = {
    "hanging_piece": {
        "title": "Leaving pieces hanging",
        "lesson": "A piece was left where the opponent could simply take it. Before every move, ask: "
                  "'After this, what can my opponent capture, and is everything defended?'",
        "drill": "Blunder-check routine: before you press the move, scan every enemy capture and check.",
    },
    "fork": {
        "title": "Walking into forks",
        "lesson": "Your pieces ended up on squares one enemy piece could attack at the same time. "
                  "Knights fork pieces on the same colour; queens fork along lines. Watch for loose pieces and the king.",
        "drill": "Fork puzzles; spot pieces on squares a knight's jump apart.",
    },
    "pin": {
        "title": "Getting pinned",
        "lesson": "A piece got pinned to something more valuable behind it. Avoid lining up your king or queen "
                  "with valuable pieces on an open file or diagonal.",
        "drill": "Pin and skewer puzzles; before moving, check open lines toward your king and queen.",
    },
    "allowed_mate": {
        "title": "Missing mating threats",
        "lesson": "Your move allowed a forced mate. When the opponent has checks near your king, "
                  "slow down and look at every check they have before playing.",
        "drill": "Mate-in-2 and mate-in-3 defence puzzles.",
    },
    "back_rank": {
        "title": "Back-rank weakness",
        "lesson": "Your king was stuck on the back rank behind its own pawns. Make 'luft' (h3/h6) in quiet moments "
                  "and keep a rook or queen guarding the back rank.",
        "drill": "Back-rank mate puzzles.",
    },
    "missed_mate": {
        "title": "Missing checkmates",
        "lesson": "You had a forced mate and didn't play it. Always look at checks, captures and threats (in that order) "
                  "when the enemy king is exposed.",
        "drill": "Mate-in-1/2 sprint: 20 puzzles a day.",
    },
    "missed_tactic": {
        "title": "Missing tactics that win material",
        "lesson": "There was a forcing sequence that won material. Look at every check and capture first, "
                  "even ones that look like sacrifices.",
        "drill": "Mixed tactics from your own games, then themed sets (forks, pins, discovered attacks).",
    },
    "weakened_king": {
        "title": "Weakening your king's shelter",
        "lesson": "You pushed a pawn in front of your castled king and created holes. Only push those pawns with a clear purpose.",
        "drill": "Play through attacking games and note which pawn moves created the holes.",
    },
    "time_pressure": {
        "title": "Time trouble",
        "lesson": "Mistakes piled up with under 30 seconds on the clock. Spend less time in the opening and "
                  "on obvious moves, and save time for critical positions.",
        "drill": "Play a few games with increment; keep a reserve of a third of your time for the endgame.",
    },
    "positional": {
        "title": "Positional slips",
        "lesson": "No tactic, but the move worsened your position (passive piece, wrong plan, lost tempo). "
                  "Ask what your worst piece is and how to improve it.",
        "drill": "Compare your move with the engine's on these positions and name the plan behind the best move.",
    },
}

PHASE_TIPS = {
    "opening": "Develop knights and bishops, castle early, fight for the centre, and avoid moving the same piece twice.",
    "middlegame": "Look for checks, captures and threats every move; improve your worst piece; attack where you have more pawns.",
    "endgame": "Activate your king, push passed pawns, put rooks behind passed pawns, and know the basic theoretical positions.",
}


@lru_cache
def openings() -> list[dict]:
    return json.loads((DATA_DIR / "openings.json").read_text())


@lru_cache
def endgames() -> list[dict]:
    return json.loads((DATA_DIR / "endgames.json").read_text())


def match_opening(eco: str | None, name: str | None, color: str | None = None) -> dict | None:
    """Find the bundled repertoire line closest to what was played."""
    played = set(_words(name or ""))
    best, best_score = None, 0
    for line in openings():
        score = 0
        if eco and line["eco"] == eco:
            score += 3
        elif eco and line["eco"][:2] == eco[:2]:
            score += 1
        score += 2 * len(played & set(_words(line["name"])))
        if color and line["color"] == color:
            score += 1
        if score > best_score:
            best, best_score = line, score
    # Needs an exact ECO or a shared name word; family + colour alone is too loose.
    return best if best_score >= 3 else None


_GENERIC = {"game", "opening", "defence", "defense", "variation", "white", "black", "attack", "system"}


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 3 and w not in _GENERIC]


def motif_info(motif: str) -> dict[str, str]:
    return MOTIFS.get(motif, {"title": motif.replace("_", " ").capitalize(), "lesson": "", "drill": ""})


def describe_move(move: dict) -> str:
    """A template explanation of one reviewed move."""
    cls = move["classification"]
    best = move.get("best_san")
    line = " ".join(move.get("best_line", [])[:5])
    if cls == "brilliant":
        return f"{move['san']} is brilliant: a real sacrifice that the engine confirms works."
    if cls == "great":
        return f"{move['san']} is a great find: it was the only move that kept your position together."
    if cls in {"best", "book", "forced"}:
        return f"{move['san']} is {'the ' + cls + ' move' if cls != 'book' else 'opening theory'}."
    if cls in {"excellent", "good"}:
        return f"{move['san']} is {cls}. The engine slightly preferred {best} ({line})."
    reasons = [motif_info(m)["lesson"] for m in move.get("motifs", []) if m in MOTIFS]
    text = f"{move['san']} is a {cls} and gives up {move['win_loss']:.0f}% of your winning chances. Best was {best}"
    text += f" ({line})." if line else "."
    if reasons:
        text += " " + reasons[0]
    return text


def template_day_lesson(state: dict) -> str:
    day = state["day_summary"]
    acc = day.get("avg_accuracy") or 0
    quip = (
        "HISSS. Three blunders? I'm knocking this whole day off the table." if day["counts"].get("blunder", 0) >= 3
        else "Purr-fect day. I taught you well." if acc >= 85
        else "Not bad, human. Not great either." if acc >= 70
        else "Hmm. We have work to do. Lots of work."
    )
    lines = [f"*Kittu says: \"{quip}\"*", "",
             f"## Your day in chess: {day['games']} games, {day['wins']}W / {day['draws']}D / {day['losses']}L"]
    if day.get("avg_accuracy") is not None:
        lines.append(f"Average accuracy: **{day['avg_accuracy']}%**.")
    errs = day["counts"]
    lines.append(
        f"You played {errs.get('brilliant', 0)} brilliant and {errs.get('great', 0)} great moves, with "
        f"{errs.get('blunder', 0)} blunders, {errs.get('mistake', 0)} mistakes and {errs.get('miss', 0)} missed chances."
    )
    top = state["patterns"]["today_motifs"][:3]
    if top:
        lines.append("\n### What cost you today")
        for m in top:
            info = motif_info(m["motif"])
            recurring = " This keeps happening across your history." if m.get("recurring") else ""
            lines.append(f"- **{info['title']}** ({m['count']}x). {info['lesson']}{recurring}")
    if day["worst_moments"]:
        lines.append("\n### Key moments to replay")
        for w in day["worst_moments"][:3]:
            lines.append(f"- vs {w['opponent']}, move {w['move_number']}: you played **{w['san']}**, "
                         f"best was **{w['best_san']}** (−{w['win_loss']:.0f}% winning chances).")
    rep = day.get("repertoire") or []
    if rep:
        lines.append("\n### Opening repertoire check")
        for n in rep[:4]:
            if n["kind"] == "you_deviated":
                lines.append(f"- vs {n['opponent']}: you left your **{n['course_name']}** course on move {(n['ply'] + 1) // 2} with "
                             f"**{n['played']}**; the course plays **{n['expected']}** ({n['line_name']}). Review that line.")
            else:
                lines.append(f"- vs {n['opponent']}: your opponent played **{n['played']}** on move {(n['ply'] + 1) // 2}, which "
                             f"your **{n['course_name']}** course doesn't cover yet.")
    weakest = state["patterns"].get("weakest_phase")
    if weakest:
        lines.append(f"\n### Focus area: the {weakest}")
        lines.append(PHASE_TIPS[weakest])
    return "\n".join(lines)
