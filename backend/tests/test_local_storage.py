"""Local StorageBackend tests."""

from __future__ import annotations

import pandas as pd

from data.storage.local import LocalStorageBackend
from model.study_schema import StudyDocument, StudyMeta


def test_local_storage_roundtrip(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MARKET_SIM_STUDIES_DIR", str(tmp_path))
    import config

    monkeypatch.setattr(config, "STUDIES_DIR", tmp_path)
    backend = LocalStorageBackend()
    doc = StudyDocument(meta=StudyMeta(study_name="Tmp Study", company_name="Co"))
    hbu = pd.DataFrame({"RespondentID": [1], "ProductID1": [0.5]})
    slug = backend.write_study("local-dev", doc, hbu)
    assert backend.study_exists("local-dev", slug)
    loaded, df = backend.load_study("local-dev", slug)
    assert loaded.meta.study_name == "Tmp Study"
    assert len(df) == 1
