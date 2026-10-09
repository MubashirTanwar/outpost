"""The web app bundles copies of the opening/endgame data for browser-only mode."""

import filecmp
from pathlib import Path

import pytest

DATA = Path(__file__).parents[1] / "app" / "data"
WEB_DATA = Path(__file__).parents[2] / "web" / "src" / "data"


@pytest.mark.parametrize("name", ["openings.json", "endgames.json"])
def test_web_data_matches_backend(name):
    if not WEB_DATA.exists():
        pytest.skip("web app not checked out")
    assert filecmp.cmp(DATA / name, WEB_DATA / name, shallow=False), (
        f"web/src/data/{name} is out of date: cp backend/app/data/{name} web/src/data/"
    )
