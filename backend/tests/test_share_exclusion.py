"""Share calculation when products are excluded from the lineup."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import STUDIES_DIR, ensure_directories
from model.project_core import ProjectCore, ProjectRegistry


def _load_elaraby() -> ProjectCore:
    ensure_directories()
    if not (STUDIES_DIR / "ELARABY_PTV_2021" / "study.json").exists():
        raise unittest.SkipTest("ELARABY study not available")
    ProjectRegistry.instance().clear()
    ProjectRegistry.instance().initialize_projects("ELARABY_PTV_2021")
    return ProjectRegistry.instance().get("MainStudy")


class ShareExclusionTests(unittest.TestCase):
    def test_exclude_preserves_base_preference_for_ratio(self) -> None:
        """Delisting must compare new pref vs original-lineup base pref (reference parity)."""
        project = _load_elaraby()
        smt = "TOSHIBA 32 SMT HD"
        hd = "TOSHIBA 32 HD"

        base_row = project.results[project.results["Product Name"] == smt].iloc[0]
        self.assertAlmostEqual(float(base_row["B.Share"]), 0.5450752742027009, places=6)

        project.include_exclude_product(hd, False)
        row = project.results[project.results["Product Name"] == smt].iloc[0]

        # Reference Market Simulator value when TOSHIBA 32 HD is deselected.
        self.assertAlmostEqual(float(row["N.Share"]), 0.599705311411276, places=6)
        self.assertAlmostEqual(
            float(row["N.Share"]) / float(row["B.Share"]),
            1.100225,
            places=4,
        )

        model = project._model
        assert model is not None
        p_smt = model.get_product(smt)
        assert p_smt is not None
        self.assertAlmostEqual(p_smt.base_preference_share, 2.298950878503537, places=6)
        self.assertAlmostEqual(p_smt.new_preference_share, 2.4463980505480967, places=6)
        self.assertGreater(p_smt.new_preference_share, p_smt.base_preference_share)


if __name__ == "__main__":
    unittest.main()
