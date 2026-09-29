"""Tests for Chart Analysis analytics ports."""

from __future__ import annotations

import pytest

from model.project_core import ProjectCore


@pytest.fixture
def demo_slug() -> str:
    if not ProjectCore.study_exists("Demo_Study"):
        pytest.skip("Demo_Study not available")
    return "Demo_Study"


def test_som_vs_sop_matches_included_products(demo_slug: str) -> None:
    project = ProjectCore(demo_slug)
    project.initialize()
    rows = project.som_vs_sop()
    assert len(rows) > 0
    for row in rows:
        assert "name" in row
        assert 0.0 <= row["som"] <= 1.0
        assert 0.0 <= row["sop"] <= 1.0
    # SOM should match N.Share from results grid (as decimal)
    df = project.results
    for row in rows:
        n_share = float(df[df["Product Name"] == row["name"]]["N.Share"].iloc[0])
        assert abs(row["som"] - n_share / 100.0) < 1e-6
