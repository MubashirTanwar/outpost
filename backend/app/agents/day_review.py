"""Day overview agent (LangGraph).

    fetch_games -> analyze_games -> summarize_day -> mine_patterns -> coach_lesson -> training_plan
         \\-> (no games) -> END

Each node reads and extends a shared state. Engine work and graph writes happen in
`analyze_games`; the graph DB then supplies history so the coach can tell "a one-off slip"
from "the thing you keep doing".
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import date
from typing import Any, Callable, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from .. import chesscom, coaching, llm
from ..engine import get_engine
from ..graph_store import get_store
from ..review import CLASSIFICATIONS, review_pgn


class DayState(TypedDict, total=False):
    username: str
    day: str  # YYYY-MM-DD
    tz_offset: int  # minutes east of UTC
    depth: int
    games: list[dict]
    reviews: dict[str, dict]
    day_summary: dict
    patterns: dict
    lesson: str
    lesson_source: str
    plan: dict


def _progress(config: RunnableConfig | None) -> Callable[[str, float], None]:
    cb = ((config or {}).get("configurable") or {}).get("progress")
    return cb or (lambda stage, frac: None)


def fetch_games(state: DayState, config: RunnableConfig) -> DayState:
    if state.get("games") is not None:  # games supplied by the caller (tests, uploads)
        return {}
    _progress(config)("Fetching games from chess.com", 0.02)
    games = chesscom.fetch_games_for_day(state["username"], date.fromisoformat(state["day"]), state.get("tz_offset", 0))
    return {"games": [{**g.to_dict(), "pgn": g.pgn} for g in games]}


def route_after_fetch(state: DayState) -> str:
    return "analyze_games" if state.get("games") else END


def analyze_games(state: DayState, config: RunnableConfig) -> DayState:
    store, engine, report = get_store(), get_engine(), _progress(config)
    games, reviews = state["games"], {}
    for idx, game in enumerate(games):
        cached = store.get_review(game["id"])
        if cached and cached.get("depth", 0) >= state.get("depth", 14):
            reviews[game["id"]] = cached
            continue

        def on_position(done: int, total: int, idx: int = idx) -> None:
            report(f"Analyzing game {idx + 1}/{len(games)}", 0.05 + 0.8 * (idx + done / total) / len(games))

        review = review_pgn(game["pgn"], engine, depth=state.get("depth", 14),
                            player_color=game.get("player_color"), progress=on_position)
        review["game"] = {k: v for k, v in game.items() if k != "pgn"}
        store.save_review(state["username"], game, review)
        reviews[game["id"]] = review
    return {"reviews": reviews}


def summarize_day(state: DayState, config: RunnableConfig) -> DayState:
    _progress(config)("Summarizing the day", 0.87)
    counts: Counter = Counter()
    results: Counter = Counter()
    accuracies, worst, per_game = [], [], []
    openings: Counter = Counter()
    for game in state["games"]:
        review = state["reviews"][game["id"]]
        color = game.get("player_color") or "white"
        mine = review["summary"][color]
        counts.update({k: v for k, v in mine["counts"].items() if v})
        result = chesscom._normalise_result(game.get(f"{color}_result", ""))
        results[result] += 1
        if mine["accuracy"] is not None:
            accuracies.append(mine["accuracy"])
        opponent = game["black"] if color == "white" else game["white"]
        openings[game.get("opening") or game.get("eco") or "Unknown"] += 1
        per_game.append({
            "id": game["id"], "url": game["url"], "opponent": opponent, "color": color, "result": result,
            "accuracy": mine["accuracy"], "counts": mine["counts"], "time_class": game["time_class"],
            "opening": game.get("opening"), "eco": game.get("eco"), "end_time": game["end_time"],
            "opponent_accuracy": review["summary"]["black" if color == "white" else "white"]["accuracy"],
        })
        for m in review["moves"]:
            if m["color"] == color and m["classification"] in {"blunder", "mistake", "miss"}:
                worst.append({**{k: m[k] for k in ("ply", "move_number", "san", "best_san", "win_loss",
                                                   "classification", "fen_before", "motifs", "best_line")},
                              "game_id": game["id"], "opponent": opponent})
    worst.sort(key=lambda w: -w["win_loss"])
    with_acc = [g for g in per_game if g["accuracy"] is not None]
    summary = {
        "games": len(per_game),
        "wins": results["win"], "draws": results["draw"], "losses": results["loss"],
        "avg_accuracy": round(sum(accuracies) / len(accuracies), 1) if accuracies else None,
        "counts": {c: counts.get(c, 0) for c in CLASSIFICATIONS},
        "per_game": per_game,
        "best_game": max(with_acc, key=lambda g: g["accuracy"])["id"] if with_acc else None,
        "worst_game": min(with_acc, key=lambda g: g["accuracy"])["id"] if with_acc else None,
        "worst_moments": worst[:8],
        "openings": openings.most_common(),
    }
    return {"day_summary": summary}


def mine_patterns(state: DayState, config: RunnableConfig) -> DayState:
    _progress(config)("Looking for patterns in your history", 0.9)
    profile = get_store().weakness_profile(state["username"])
    historical = {m["motif"]: m["count"] for m in profile["motifs"]}
    today: Counter = Counter()
    phase_losses: Counter = Counter()
    for game in state["games"]:
        color = game.get("player_color") or "white"
        for m in state["reviews"][game["id"]]["moves"]:
            if m["color"] != color or not m["motifs"]:
                continue
            for motif in m["motifs"]:
                if motif.endswith("_phase"):
                    phase_losses[motif.removesuffix("_phase")] += m["win_loss"]
                else:
                    today[motif] += 1
    today_motifs = [
        {"motif": k, "count": v, "historical": historical.get(k, 0),
         # "Recurring" = it also shows up meaningfully in games *before* today.
         "recurring": historical.get(k, 0) - v >= 2}
        for k, v in today.most_common()
    ]
    return {"patterns": {
        "today_motifs": today_motifs,
        "weakest_phase": phase_losses.most_common(1)[0][0] if phase_losses else None,
        "phase_losses": dict(phase_losses),
        "profile": profile,
    }}


def coach_lesson(state: DayState, config: RunnableConfig) -> DayState:
    _progress(config)("Writing your lesson", 0.94)
    day = state["day_summary"]
    context = {
        "player": state["username"],
        "day": state["day"],
        "record": {k: day[k] for k in ("games", "wins", "draws", "losses", "avg_accuracy")},
        "move_quality": day["counts"],
        "games": [{k: g[k] for k in ("opponent", "color", "result", "accuracy", "opening", "time_class")}
                  for g in day["per_game"]],
        "worst_moments": [{k: w[k] for k in ("opponent", "move_number", "san", "best_san", "best_line",
                                             "classification", "win_loss", "motifs", "fen_before")}
                          for w in day["worst_moments"][:5]],
        "todays_patterns": state["patterns"]["today_motifs"][:5],
        "weakest_phase": state["patterns"]["weakest_phase"],
        "all_time_profile": {k: state["patterns"]["profile"][k] for k in ("games_analyzed", "motifs", "phases")},
        "motif_glossary": {m["motif"]: coaching.motif_info(m["motif"]) for m in state["patterns"]["today_motifs"][:5]},
    }
    prompt = (
        "Here is today's analysis of my chess games as JSON:\n\n"
        f"{json.dumps(context, indent=1)}\n\n"
        "Write my daily lesson in Markdown:\n"
        "1. A two-sentence verdict on the day.\n"
        "2. 'What went wrong': the 2-3 most important lessons, each tied to a concrete moment "
        "(opponent, move number, what I played, what was better and why).\n"
        "3. 'Patterns': say whether each is a one-off or recurring, using the all-time profile.\n"
        "4. 'What went right': genuine positives.\n"
        "5. 'Tomorrow's focus': one concrete habit to practise.\n"
        "Keep it under 450 words."
    )
    try:
        return {"lesson": llm.generate(prompt), "lesson_source": llm.provider()}
    except llm.LLMUnavailable:
        return {"lesson": coaching.template_day_lesson(state), "lesson_source": "template"}


def training_plan(state: DayState, config: RunnableConfig) -> DayState:
    _progress(config)("Building your training plan", 0.98)
    store = get_store()
    today_ids = {g["id"] for g in state["games"]}
    puzzles = [p for p in store.puzzles(state["username"], limit=200) if p["game_id"] in today_ids][:10]

    focus = [coaching.motif_info(m["motif"]) | {"motif": m["motif"]} for m in state["patterns"]["today_motifs"][:3]]

    # Opening to review: the one that went worst today.
    opening_review = None
    scored = sorted(state["day_summary"]["per_game"], key=lambda g: (g["result"] != "loss", g["accuracy"] or 100))
    for g in scored:
        line = coaching.match_opening(g.get("eco"), g.get("opening"), g["color"])
        if line:
            opening_review = {"line_id": line["id"], "name": line["name"], "played": g.get("opening"),
                              "reason": f"You had {g['result']} with {g['accuracy']}% accuracy in this opening."}
            break

    endgame = None
    if state["patterns"]["phase_losses"].get("endgame"):
        endgame = next((d for d in coaching.endgames() if d["level"] == "intermediate"), None)
    return {"plan": {"puzzles": puzzles, "focus": focus, "opening": opening_review, "endgame": endgame}}


def build_day_review_graph():
    graph = StateGraph(DayState)
    graph.add_node("fetch_games", fetch_games)
    graph.add_node("analyze_games", analyze_games)
    graph.add_node("summarize_day", summarize_day)
    graph.add_node("mine_patterns", mine_patterns)
    graph.add_node("coach_lesson", coach_lesson)
    graph.add_node("training_plan", training_plan)
    graph.add_edge(START, "fetch_games")
    graph.add_conditional_edges("fetch_games", route_after_fetch, ["analyze_games", END])
    graph.add_edge("analyze_games", "summarize_day")
    graph.add_edge("summarize_day", "mine_patterns")
    graph.add_edge("mine_patterns", "coach_lesson")
    graph.add_edge("coach_lesson", "training_plan")
    graph.add_edge("training_plan", END)
    return graph.compile()


def run_day_review(username: str, day: str, tz_offset: int = 0, depth: int = 14,
                   games: list[dict] | None = None, progress: Callable[[str, float], None] | None = None) -> dict[str, Any]:
    state: DayState = {"username": username, "day": day, "tz_offset": tz_offset, "depth": depth}
    if games is not None:
        state["games"] = games
    result = build_day_review_graph().invoke(state, config={"configurable": {"progress": progress}})
    return {
        "username": username,
        "day": day,
        "games": len(result.get("games") or []),
        "summary": result.get("day_summary"),
        "patterns": {k: v for k, v in (result.get("patterns") or {}).items() if k != "profile"},
        "lesson": result.get("lesson"),
        "lesson_source": result.get("lesson_source"),
        "plan": result.get("plan"),
    }
