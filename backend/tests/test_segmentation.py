"""Tests for segmentation dimension/member resolution."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import STUDIES_DIR, ensure_directories
from data.study_loader import load_study_document
from model.segmentation import (
    segmentation_dimensions,
    segment_members,
    resolve_assignment_key,
)


class SegmentationHelperTests(unittest.TestCase):
    def test_elaraby_dimensions(self) -> None:
        ensure_directories()
        path = STUDIES_DIR / "ELARABY_PTV_2021" / "study.json"
        if not path.exists():
            self.skipTest("ELARABY study not available")
        doc, _ = load_study_document("ELARABY_PTV_2021")
        dims = segmentation_dimensions(doc)
        labels = [d[0] for d in dims]
        self.assertIn("Gender", labels)
        self.assertIn("Age", labels)
        key = resolve_assignment_key(doc, "Gender")
        self.assertEqual(key, "Segment Gender")
        members = segment_members(doc, "Segment Gender")
        self.assertEqual(members, ["1", "2"])


if __name__ == "__main__":
    unittest.main()
