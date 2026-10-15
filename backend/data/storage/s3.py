"""S3-backed study storage with a local mirror under MARKET_SIM_CACHE_DIR."""

from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path

import pandas as pd

from config import MARKET_SIM_CACHE_DIR, MARKET_SIM_S3_BUCKET, MARKET_SIM_S3_PREFIX, AWS_REGION, slugify
from data.study_loader import StudyLoadError
from model.study_schema import StudyDocument


class S3StorageBackend:
    def __init__(self) -> None:
        if not MARKET_SIM_S3_BUCKET:
            raise RuntimeError("MARKET_SIM_S3_BUCKET is required when MARKET_SIM_STORAGE=s3")
        import boto3

        self._s3 = boto3.client("s3", region_name=AWS_REGION)
        self._bucket = MARKET_SIM_S3_BUCKET

    def _prefix(self, client_id: str, slug: str) -> str:
        return f"{MARKET_SIM_S3_PREFIX}/{client_id}/{slug}/"

    def _mirror_root(self, client_id: str, slug: str) -> Path:
        return MARKET_SIM_CACHE_DIR / "clients" / client_id / slug

    def study_root_path(self, client_id: str, slug: str) -> Path:
        self._sync_down(client_id, slug)
        root = self._mirror_root(client_id, slug)
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _sync_down(self, client_id: str, slug: str) -> None:
        prefix = self._prefix(client_id, slug)
        root = self._mirror_root(client_id, slug)
        root.mkdir(parents=True, exist_ok=True)
        remote_rels: set[str] = set()
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            for obj in page.get("Contents") or []:
                key = obj["Key"]
                rel = key[len(prefix) :]
                if not rel or rel.endswith("/"):
                    continue
                remote_rels.add(rel)
                dest = root / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                self._s3.download_file(self._bucket, key, str(dest))
        for path in list(root.rglob("*")):
            if path.is_file():
                rel = path.relative_to(root).as_posix()
                if rel not in remote_rels:
                    path.unlink(missing_ok=True)

    def _upload_tree(self, client_id: str, slug: str) -> None:
        root = self._mirror_root(client_id, slug)
        if not root.exists():
            return
        prefix = self._prefix(client_id, slug)
        for path in root.rglob("*"):
            if path.is_file():
                rel = path.relative_to(root).as_posix()
                self._s3.upload_file(str(path), self._bucket, prefix + rel)

    def study_exists(self, client_id: str, slug: str) -> bool:
        self._sync_down(client_id, slug)
        root = self._mirror_root(client_id, slug)
        return (root / "study.json").is_file() and (root / "hbu.parquet").is_file()

    def load_study(self, client_id: str, slug: str) -> tuple[StudyDocument, pd.DataFrame]:
        self._sync_down(client_id, slug)
        root = self._mirror_root(client_id, slug)
        json_path = root / "study.json"
        hbu_path = root / "hbu.parquet"
        if not json_path.is_file() or not hbu_path.is_file():
            raise StudyLoadError(f"Study not found in S3 for slug '{slug}'")
        with json_path.open(encoding="utf-8") as fh:
            doc = StudyDocument.from_dict(json.load(fh))
        return doc, pd.read_parquet(hbu_path)

    def write_study(
        self, client_id: str, doc: StudyDocument, hbu_df: pd.DataFrame, slug: str | None = None
    ) -> str:
        target_slug = slug or slugify(doc.meta.study_name or "unnamed_study")
        root = self._mirror_root(client_id, target_slug)
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
            (root / "scenarios").mkdir(parents=True, exist_ok=True)

            os.replace(temp_json, root / "study.json")
            os.replace(temp_parquet, root / "hbu.parquet")
        finally:
            if staging_dir.exists():
                shutil.rmtree(staging_dir, ignore_errors=True)

        self._upload_tree(client_id, target_slug)
        return target_slug

    def persist_study_document(self, client_id: str, slug: str, doc: StudyDocument) -> None:
        root = self._mirror_root(client_id, slug)
        root.mkdir(parents=True, exist_ok=True)
        path = root / "study.json"
        tmp_path = path.with_suffix(f".json.tmp.{uuid.uuid4().hex[:8]}")
        try:
            with tmp_path.open("w", encoding="utf-8") as fh:
                json.dump(doc.to_dict(), fh, indent=2)
            os.replace(tmp_path, path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
        self.put_study_file(client_id, slug, "study.json")

    def persist_hbu_dataframe(self, client_id: str, slug: str, hbu_df: pd.DataFrame) -> None:
        root = self._mirror_root(client_id, slug)
        root.mkdir(parents=True, exist_ok=True)
        path = root / "hbu.parquet"
        tmp_path = path.with_suffix(f".parquet.tmp.{uuid.uuid4().hex[:8]}")
        try:
            hbu_df.to_parquet(tmp_path, index=False)
            os.replace(tmp_path, path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)
        self.put_study_file(client_id, slug, "hbu.parquet")

    def delete_study_tree(self, client_id: str, slug: str) -> None:
        prefix = self._prefix(client_id, slug)
        paginator = self._s3.get_paginator("list_objects_v2")
        to_delete: list[dict] = []
        for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
            for obj in page.get("Contents") or []:
                to_delete.append({"Key": obj["Key"]})
        for i in range(0, len(to_delete), 1000):
            batch = to_delete[i : i + 1000]
            if batch:
                self._s3.delete_objects(Bucket=self._bucket, Delete={"Objects": batch})
        mirror = self._mirror_root(client_id, slug)
        if mirror.exists():
            shutil.rmtree(mirror)

    def put_study_file(self, client_id: str, slug: str, rel_path: str) -> None:
        rel = rel_path.replace("\\", "/").lstrip("/")
        local_path = self._mirror_root(client_id, slug) / rel
        if not local_path.is_file():
            raise FileNotFoundError(f"Mirror file not found for upload: {local_path}")
        key = self._prefix(client_id, slug) + rel
        self._s3.upload_file(str(local_path), self._bucket, key)

    def delete_study_file(self, client_id: str, slug: str, rel_path: str) -> None:
        rel = rel_path.replace("\\", "/").lstrip("/")
        key = self._prefix(client_id, slug) + rel
        self._s3.delete_object(Bucket=self._bucket, Key=key)

