"""Runs the graph-store contract against a real Neo4j when NEO4J_TEST_URI is set, e.g.

    docker run -d -p 7687:7687 -e NEO4J_AUTH=neo4j/chesscoach neo4j:5.26-community
    NEO4J_TEST_URI=bolt://localhost:7687 pytest tests/test_neo4j.py
"""

import os

import pytest

from app import graph_store
from app.agents import day_review

from .test_agents import _games

URI = os.environ.get("NEO4J_TEST_URI")
pytestmark = pytest.mark.skipif(not URI, reason="NEO4J_TEST_URI not set")


@pytest.fixture
def neo4j_store(monkeypatch):
    store = graph_store.Neo4jGraphStore(URI, os.environ.get("NEO4J_TEST_USER", "neo4j"),
                                        os.environ.get("NEO4J_TEST_PASSWORD", "chesscoach"))
    with store._driver.session() as s:
        s.run("MATCH (n) DETACH DELETE n")
    monkeypatch.setattr(graph_store, "_store", store)
    yield store
    store.close()


def test_neo4j_store_contract(monkeypatch, fake_engine, neo4j_store):
    monkeypatch.setattr(day_review, "get_engine", lambda: fake_engine)
    result = day_review.run_day_review("coach_tester", "2025-10-09", games=_games(), depth=1)
    assert result["summary"]["games"] == 2

    assert neo4j_store.get_review("g1")["moves"]
    games = neo4j_store.list_games("coach_tester")
    assert {g["id"] for g in games} == {"g1", "g2"}
    assert {g["result"] for g in games} == {"win", "loss"}

    profile = neo4j_store.weakness_profile("coach_tester")
    assert profile["games_analyzed"] == 2
    assert any(m["motif"] == "hanging_piece" for m in profile["motifs"])
    assert profile["openings"]

    # Saving the same game twice must not duplicate anything.
    day_review.run_day_review("coach_tester", "2025-10-09", games=_games(), depth=1)
    assert neo4j_store.weakness_profile("coach_tester")["motifs"] == profile["motifs"]

    puzzles = neo4j_store.puzzles("coach_tester")
    assert puzzles and puzzles[0]["solution"]
    att = neo4j_store.record_attempt("coach_tester", puzzles[0]["id"], solved=False)
    assert att["attempts"] == 1 and att["streak"] == 0
    att = neo4j_store.record_attempt("coach_tester", puzzles[0]["id"], solved=True)
    assert att["attempts"] == 2 and att["streak"] == 1
    assert neo4j_store.puzzles("coach_tester", motif="hanging_piece")
