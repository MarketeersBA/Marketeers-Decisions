"""REQ-QA-01 — golden parity vs desktop Chart Analysis exports.

Stub: tests skip until CSV/XLSX fixtures from the legacy .exe are dropped under
``tests/fixtures/golden/`` (or paths below are updated).

When fixtures exist, replace ``pytest.skip`` with load + assert-within-tolerance
against ``model.analytics`` / API outputs for the same study + scenario.
"""

from __future__ import annotations

from pathlib import Path

import pytest

GOLDEN_DIR = Path(__file__).resolve().parent / "fixtures" / "golden"

# Placeholder fixture names expected once desktop exports are captured.
FIXTURES = {
    "som_sop": GOLDEN_DIR / "som_sop.csv",
    "validation": GOLDEN_DIR / "validation.csv",
    "elasticity": GOLDEN_DIR / "elasticity.csv",
}


def _require_fixture(key: str) -> Path:
    path = FIXTURES[key]
    if not path.is_file():
        pytest.skip(
            f"REQ-QA-01 stub: missing golden fixture {path.name}. "
            "Export Chart Analysis grids from the desktop .exe into "
            f"{GOLDEN_DIR}/ and re-enable assertions."
        )
    return path


@pytest.mark.golden
def test_golden_som_sop_parity() -> None:
    _require_fixture("som_sop")
    # TODO: load fixture, run som_vs_sop on reference study, assert max abs error


@pytest.mark.golden
def test_golden_validation_parity() -> None:
    _require_fixture("validation")
    # TODO: load fixture, run validation_rows, assert Audit / Rebased columns


@pytest.mark.golden
def test_golden_elasticity_parity() -> None:
    _require_fixture("elasticity")
    # TODO: load fixture, run elasticity sweep, assert relative-share grid
