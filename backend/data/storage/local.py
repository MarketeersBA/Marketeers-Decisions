"""Local filesystem storage for study payloads."""

from __future__ import annotations

import json
import os
import shutil
import uuid
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

    def write_study(
        self, client_id: str, doc: StudyDocument, hbu_df: pd.DataFrame, slug: str | None = None
    ) -> str:
        target_slug = slug or slugify(doc.meta.study_name or "unnamed_study")
        root = self.study_root_path(client_id, target_slug)
        root.parent.mkdir(parents=True, exist_ok=True)

        staging_dir = root.parent / f".staging_{target_slug}_{uuid.uuid4().hex[:8]}"
        staging_dir.mkdir(parents=True, exist_ok=True)
        try:
            temp_json = staging_dir / "study.json"
            temp_parquet = staging_dir / "hbu.parquet"
            with temp_json.open("w", encoding="utf-8") as fh:
                json.dump(doc.to_dict(), fh, indent=2)
            hbu_df.to_parquet(temp_parquet, index=False)

            root.mkdir(parents=True, exist_ok=True)
            config_scenarios_dir(target_slug, client_id)

            os.replace(temp_json, root / "study.json")
            os.replace(temp_parquet, root / "hbu.parquet")
        finally:
            if staging_dir.exists():
                shutil.rmtree(staging_dir, ignore_errors=True)

        return target_slug

    def persist_study_document(self, client_id: str, slug: str, doc: StudyDocument) -> None:
        path = self.study_root_path(client_id, slug) / "study.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(f".json.tmp.{uuid.uuid4().hex[:8]}")
        try:
            with tmp_path.open("w", encoding="utf-8") as fh:
                json.dump(doc.to_dict(), fh, indent=2)
            os.replace(tmp_path, path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def persist_hbu_dataframe(self, client_id: str, slug: str, hbu_df: pd.DataFrame) -> None:
        path = self.study_root_path(client_id, slug) / "hbu.parquet"
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(f".parquet.tmp.{uuid.uuid4().hex[:8]}")
        try:
            hbu_df.to_parquet(tmp_path, index=False)
            os.replace(tmp_path, path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def delete_study_tree(self, client_id: str, slug: str) -> None:
        root = self.study_root_path(client_id, slug)
        if root.exists():
            shutil.rmtree(root, ignore_errors=True)

    def put_study_file(self, client_id: str, slug: str, rel_path: str) -> None:
        """No-op for local storage; file is already written in place."""

    def delete_study_file(self, client_id: str, slug: str, rel_path: str) -> None:
        """No-op for local storage; file is already unlinked in place."""

