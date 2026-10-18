"""REQ-QA-01 — golden parity vs desktop Chart Analysis exports.

Intentionally skipped until CSV/XLSX fixtures are captured under
``tests/fixtures/golden/`` *and* numeric assertions are implemented.

Do not treat a green run of this module as parity coverage.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.skip(
    reason=(
        "REQ-QA-01 not implemented: capture desktop Chart Analysis exports under "
        "tests/fixtures/golden/ then add numeric asserts "
        "(som_vs_sop / validation_rows / elasticity)."
    )
)


@pytest.mark.golden
def test_golden_som_sop_parity() -> None:
    raise NotImplementedError


@pytest.mark.golden
def test_golden_validation_parity() -> None:
    raise NotImplementedError


@pytest.mark.golden
def test_golden_elasticity_parity() -> None:
    raise NotImplementedError
