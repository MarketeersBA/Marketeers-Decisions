"""Local filesystem storage for study payloads."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pandas as pd

from config import resolve_study_folder, scenarios_dir as config_scenarios_dir, slugify
from data.study_loader import StudyLoadError
from model.study_schema import StudyDocument


class LocalStorageBackend:
    def study_root_path(self, client_id: str, slug: str) -> Path:
        return resolve_study_folder(client_id, slug)

    def study_exists(self, client_id: str, slug: str) -> bool:
        root = self.study_root_path(client_id, slug)
        return (root / "study.json").is_file() and (root / "hbu.parquet").is_file()

    def load_study(self, client_id: str, slug: str) -> tuple[StudyDocument, pd.DataFrame]:
        root = self.study_root_path(client_id, slug)
        json_path = root / "study.json"
        hbu_path = root / "hbu.parquet"
        if not json_path.is_file():
            raise StudyLoadError(f"study.json not found for slug '{slug}': {json_path}")
        if not hbu_path.is_file():
            raise StudyLoadError(f"hbu.parquet not found for slug '{slug}': {hbu_path}")
        with json_path.open(encoding="utf-8") as fh:
            doc = StudyDocument.from_dict(json.load(fh))
        hbu_df = pd.read_parquet(hbu_path)
        return doc, hbu_df

    def write_study(self, client_id: str, doc: StudyDocument, hbu_df: pd.DataFrame) -> str:
        slug = slugify(doc.meta.study_name or "unnamed_study")
        root = self.study_root_path(client_id, slug)
        root.mkdir(parents=True, exist_ok=True)
        config_scenarios_dir(slug, client_id)
        with (root / "study.json").open("w", encoding="utf-8") as fh:
            json.dump(doc.to_dict(), fh, indent=2)
        hbu_df.to_parquet(root / "hbu.parquet", index=False)
        return slug

    def persist_study_document(self, client_id: str, slug: str, doc: StudyDocument) -> None:
        path = self.study_root_path(client_id, slug) / "study.json"
        with path.open("w", encoding="utf-8") as fh:
            json.dump(doc.to_dict(), fh, indent=2)

    def persist_hbu_dataframe(self, client_id: str, slug: str, hbu_df: pd.DataFrame) -> None:
        path = self.study_root_path(client_id, slug) / "hbu.parquet"
        hbu_df.to_parquet(path, index=False)

    def delete_study_tree(self, client_id: str, slug: str) -> None:
        root = self.study_root_path(client_id, slug)
        if root.exists():
            shutil.rmtree(root)
