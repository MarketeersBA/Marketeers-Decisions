"""Load study.json + hbu.parquet into memory."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from config import get_storage
from model.study_schema import StudyDocument


class StudyLoadError(RuntimeError):
    pass


def load_study_document(slug: str, client_id: str | None = None) -> tuple[StudyDocument, pd.DataFrame]:
    from api.deps import resolve_client_id

    cid = client_id or resolve_client_id()
    try:
        return get_storage().load_study(cid, slug)
    except StudyLoadError:
        raise
    except Exception as exc:
        raise StudyLoadError(str(exc)) from exc


def load_from_folder(folder: Path) -> tuple[StudyDocument, pd.DataFrame]:
    json_path = folder / "study.json"
    hbu_path = folder / "hbu.parquet"
    if not json_path.exists() or not hbu_path.exists():
        raise StudyLoadError(f"Invalid study folder: {folder}")
    import json

    with json_path.open(encoding="utf-8") as fh:
        doc = StudyDocument.from_dict(json.load(fh))
    hbu_df = pd.read_parquet(hbu_path)
    return doc, hbu_df
