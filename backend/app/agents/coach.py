"""Coach chat agent (LangGraph).

    classify_intent -> [analyze_position] -> [load_profile] -> [load_openings] -> respond

The router decides which context-gathering nodes run; `respond` grounds the answer in that
context (engine lines, the player's graph profile, repertoire lines) so the LLM never has to
guess at chess facts.
"""

from __future__ import annotations

import json
import re
from typing import TypedDict

import chess
from langgraph.graph import END, START, StateGraph

from langchain_core.runnables import RunnableConfig

from .. import coaching, llm
from ..config import get_settings
from . import insights
from ..engine import get_engine
from ..graph_store import get_store
from ..review import _san_line


class CoachState(TypedDict, total=False):
    username: str
    message: str
    tz_offset: int
    depth: int
    fen: str | None
    history: list[dict]
    needs: list[str]
    position: dict
    profile: dict
    openings: list[dict]
    report: dict  # facts about the games the question is about (see insights.py)
    draft: str  # the deterministic answer built from them
    answer: str
    source: str


POSITION_WORDS = re.compile(r"\b(position|this move|best move|what should i play|here|eval|plan)\b", re.I)
PROFILE_WORDS = re.compile(r"\b(weak|mistake|blunder|improve|bad at|struggl|pattern|progress|train|practi[cs]e|focus)", re.I)
OPENING_WORDS = re.compile(r"\b(openings?|repertoire|defen[cs]es?|gambits?|sicilian|french|caro|london|italian|ruy|e4|d4)\b", re.I)


def classify_intent(state: CoachState) -> CoachState:
    msg = state["message"]
    needs = []
    # "What went wrong in my latest game?", "why did I lose rating yesterday?"
    if insights.wants_games(msg) and not state.get("fen"):
        needs.append("analyze_games")
    if state.get("fen") and (POSITION_WORDS.search(msg) or not PROFILE_WORDS.search(msg)):
        needs.append("analyze_position")
    if (PROFILE_WORDS.search(msg) or not needs) and "analyze_games" not in needs:
        needs.append("load_profile")
    if OPENING_WORDS.search(msg):
        needs.append("load_openings")
    return {"needs": needs}


def _next_after(current: str):
    order = ["analyze_games", "analyze_position", "load_profile", "load_openings"]

    def route(state: CoachState) -> str:
        later = order[order.index(current) + 1:] if current in order else order
        return next((n for n in later if n in state["needs"]), "respond")

    return route


def analyze_position(state: CoachState) -> CoachState:
    try:
        board = chess.Board(state["fen"])
    except ValueError:
        return {"position": {"error": "Invalid FEN"}}
    lines = get_engine().analyse(board, depth=16, multipv=3)
    sign = 1 if board.turn == chess.WHITE else -1
    return {"position": {
        "fen": board.fen(),
        "side_to_move": "white" if board.turn == chess.WHITE else "black",
        "lines": [{"eval_white_pov": sign * l.cp / 100 if l.mate is None else f"mate {sign * l.mate}",
                   "moves": _san_line(board, l.pv, 8)} for l in lines],
    }}


def analyze_games(state: CoachState, config: RunnableConfig) -> CoachState:
    progress = ((config or {}).get("configurable") or {}).get("progress") or (lambda stage, frac: None)
    out = insights.answer_question(state["username"], state["message"], state.get("depth") or get_settings().engine_depth,
                                   progress, tz_offset=state.get("tz_offset", 0))
    return {"report": out["report"], "draft": out["answer"]}


def load_profile(state: CoachState) -> CoachState:
    return {"profile": get_store().weakness_profile(state["username"])}


def load_openings(state: CoachState) -> CoachState:
    msg = state["message"].lower()
    matches = [o for o in coaching.openings() if any(w in msg for w in o["name"].lower().split() if len(w) > 3)]
    return {"openings": (matches or coaching.openings())[:6]}


def respond(state: CoachState) -> CoachState:
    if state.get("report"):
        return _respond_with_report(state)
    context = {k: state[k] for k in ("position", "profile", "openings") if state.get(k)}
    if "profile" in context:
        context["motif_glossary"] = {m["motif"]: coaching.motif_info(m["motif"]) for m in context["profile"]["motifs"][:5]}
    history = "\n".join(f"{h['role']}: {h['content']}" for h in (state.get("history") or [])[-8:])
    prompt = (
        f"Student: {state['username']}\n"
        f"Context gathered for this question (JSON):\n{json.dumps(context, indent=1)}\n\n"
        + (f"Conversation so far:\n{history}\n\n" if history else "")
        + f"Student's question: {state['message']}\n\nAnswer as their coach, concisely."
    )
    try:
        return {"answer": llm.generate(prompt, max_tokens=2000), "source": llm.provider()}
    except llm.LLMUnavailable:
        return {"answer": _template_answer(state), "source": "template"}


def _respond_with_report(state: CoachState) -> CoachState:
    """Re-voice the exact answer as Kittu; the facts and links come from the report, never the model."""
    draft = state["draft"]
    report = state["report"]
    if not report["record"]["games"]:
        return {"answer": draft, "source": "template"}
    prompt = (
        f"Student: {state['username']}\nTheir question: {state['message']}\n\n"
        "Here is the exact analysis of the games the question is about (JSON):\n"
        f"{json.dumps({k: report[k] for k in ('scope', 'record', 'avg_accuracy', 'rating', 'games', 'moments', 'patterns', 'openings', 'plan')}, indent=1)}\n\n"
        "And a factual draft answer in Markdown:\n\n" + draft + "\n\n"
        "Rewrite the draft as their coach, in your voice: open with a one- or two-sentence verdict that "
        "answers the question directly, then explain WHY the key moments went wrong (the idea behind the best "
        "move, what the mistake allowed), and finish with the one thing to work on first. The app shows the "
        "positions and the full study plan as cards under your answer, so don't list them. Keep every number exactly as "
        "given. Keep every Markdown link exactly as written, including its target (game:..., move:..., "
        "/u/..., /courses/..., /endgames/...): copy them character for character and never invent new ones. "
        "Keep it under 400 words."
    )
    try:
        return {"answer": llm.generate(prompt, max_tokens=2000), "source": llm.provider()}
    except llm.LLMUnavailable:
        return {"answer": "*Meow. I looked at your games.*\n\n" + draft, "source": "template"}


def _template_answer(state: CoachState) -> str:
    parts = []
    pos = state.get("position")
    if pos and "lines" in pos:
        top = pos["lines"][0]
        parts.append(f"In this position ({pos['side_to_move']} to move) the engine's top line is "
                     f"**{' '.join(top['moves'][:5])}** (eval {top['eval_white_pov']}).")
        if len(pos["lines"]) > 1:
            parts.append("Alternatives: " + "; ".join(" ".join(l["moves"][:3]) for l in pos["lines"][1:]) + ".")
    prof = state.get("profile")
    if prof and prof["motifs"]:
        parts.append(f"Across {prof['games_analyzed']} analyzed games, your most common problems are:")
        for m in prof["motifs"][:3]:
            info = coaching.motif_info(m["motif"])
            parts.append(f"- **{info['title']}** ({m['count']}x): {info['drill']}")
    elif prof:
        parts.append("I don't have enough analyzed games yet. Run a day review first and I'll learn your patterns.")
    for o in (state.get("openings") or [])[:3]:
        parts.append(f"- **{o['name']}** ({o['eco']}, for {o['color']}): {o['ideas'][0]}")
    parts.insert(0, "*Meow. Fine, I'll help you.*\n")
    parts.append("\n_(Kittu is in template mode: set LLM_PROVIDER=anthropic or ollama to let him really talk.)_")
    return "\n".join(parts)


def build_coach_graph():
    graph = StateGraph(CoachState)
    for name, fn in [("classify_intent", classify_intent), ("analyze_games", analyze_games),
                     ("analyze_position", analyze_position),
                     ("load_profile", load_profile), ("load_openings", load_openings), ("respond", respond)]:
        graph.add_node(name, fn)
    graph.add_edge(START, "classify_intent")
    targets = ["analyze_games", "analyze_position", "load_profile", "load_openings", "respond"]
    graph.add_conditional_edges("classify_intent", _next_after("classify_intent"), targets)
    graph.add_conditional_edges("analyze_games", _next_after("analyze_games"), targets[1:])
    graph.add_conditional_edges("analyze_position", _next_after("analyze_position"), targets[2:])
    graph.add_conditional_edges("load_profile", _next_after("load_profile"), targets[3:])
    graph.add_edge("load_openings", "respond")
    graph.add_edge("respond", END)
    return graph.compile()


_coach = None


def ask_coach(username: str, message: str, fen: str | None = None, history: list[dict] | None = None,
              tz_offset: int = 0, progress=None, depth: int | None = None) -> dict:
    global _coach
    if _coach is None:
        _coach = build_coach_graph()
    result = _coach.invoke(
        {"username": username, "message": message, "fen": fen, "history": history or [], "tz_offset": tz_offset,
         "depth": depth},
        config={"configurable": {"progress": progress}} if progress else None,
    )
    out = {"answer": result["answer"], "source": result["source"], "used": result.get("needs", [])}
    if result.get("report"):
        out["report"] = result["report"]
    return out


def explain_move(move: dict, player_color: str | None) -> dict:
    """Coach commentary for one reviewed move (used by the game review screen)."""
    prompt = (
        "Explain this move from my game to me in 2-4 sentences. Say what the move does, and if it was an "
        "error, what the opponent can now do and the idea behind the better move. Use only the engine data.\n\n"
        + json.dumps({k: move.get(k) for k in ("san", "color", "classification", "best_san", "best_line",
                                                "win_loss", "motifs", "phase", "fen_before")}, indent=1)
        + f"\nI was playing {player_color or 'this side'}."
    )
    try:
        return {"text": llm.generate(prompt, max_tokens=800), "source": llm.provider()}
    except llm.LLMUnavailable:
        return {"text": coaching.describe_move(move), "source": "template"}
