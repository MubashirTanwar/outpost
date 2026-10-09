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

from .. import coaching, llm
from ..engine import get_engine
from ..graph_store import get_store
from ..review import _san_line


class CoachState(TypedDict, total=False):
    username: str
    message: str
    fen: str | None
    history: list[dict]
    needs: list[str]
    position: dict
    profile: dict
    openings: list[dict]
    answer: str
    source: str


POSITION_WORDS = re.compile(r"\b(position|this move|best move|what should i play|here|eval|plan)\b", re.I)
PROFILE_WORDS = re.compile(r"\b(weak|mistake|blunder|improve|bad at|struggl|pattern|progress|train|practi[cs]e|focus)", re.I)
OPENING_WORDS = re.compile(r"\b(openings?|repertoire|defen[cs]es?|gambits?|sicilian|french|caro|london|italian|ruy|e4|d4)\b", re.I)


def classify_intent(state: CoachState) -> CoachState:
    msg = state["message"]
    needs = []
    if state.get("fen") and (POSITION_WORDS.search(msg) or not PROFILE_WORDS.search(msg)):
        needs.append("analyze_position")
    if PROFILE_WORDS.search(msg) or not needs:
        needs.append("load_profile")
    if OPENING_WORDS.search(msg):
        needs.append("load_openings")
    return {"needs": needs}


def _next_after(current: str):
    order = ["analyze_position", "load_profile", "load_openings"]

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


def load_profile(state: CoachState) -> CoachState:
    return {"profile": get_store().weakness_profile(state["username"])}


def load_openings(state: CoachState) -> CoachState:
    msg = state["message"].lower()
    matches = [o for o in coaching.openings() if any(w in msg for w in o["name"].lower().split() if len(w) > 3)]
    return {"openings": (matches or coaching.openings())[:6]}


def respond(state: CoachState) -> CoachState:
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
    parts.append("\n_(Template answer: set LLM_PROVIDER=anthropic or ollama for full coaching conversations.)_")
    return "\n".join(parts)


def build_coach_graph():
    graph = StateGraph(CoachState)
    for name, fn in [("classify_intent", classify_intent), ("analyze_position", analyze_position),
                     ("load_profile", load_profile), ("load_openings", load_openings), ("respond", respond)]:
        graph.add_node(name, fn)
    graph.add_edge(START, "classify_intent")
    targets = ["analyze_position", "load_profile", "load_openings", "respond"]
    graph.add_conditional_edges("classify_intent", _next_after("classify_intent"), targets)
    graph.add_conditional_edges("analyze_position", _next_after("analyze_position"), targets[1:])
    graph.add_conditional_edges("load_profile", _next_after("load_profile"), targets[2:])
    graph.add_edge("load_openings", "respond")
    graph.add_edge("respond", END)
    return graph.compile()


_coach = None


def ask_coach(username: str, message: str, fen: str | None = None, history: list[dict] | None = None) -> dict:
    global _coach
    if _coach is None:
        _coach = build_coach_graph()
    result = _coach.invoke({"username": username, "message": message, "fen": fen, "history": history or []})
    return {"answer": result["answer"], "source": result["source"], "used": result.get("needs", [])}


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
