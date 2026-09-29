"""JSON persistence for study validation waves (Data Hub uploads)."""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import validation_dir


@dataclass
class ValidationWaveProduct:
    attributes: dict[str, Any] = field(default_factory=dict)
    wd: float | None = None
    benchmark_share_pp: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ValidationWaveProduct:
        return cls(
            attributes=dict(data.get("attributes") or {}),
            wd=data.get("wd"),
            benchmark_share_pp=float(data.get("benchmark_share_pp", 0.0)),
        )


@dataclass
class ValidationWave:
    id: str
    name: str
    validation_date: str
    notes: str = ""
    source_filename: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    products: dict[str, ValidationWaveProduct] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "validation_date": self.validation_date,
            "notes": self.notes,
            "source_filename": self.source_filename,
            "created_at": self.created_at,
            "products": {k: v.to_dict() for k, v in self.products.items()},
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ValidationWave:
        raw_products = data.get("products") or {}
        products = {
            str(k): ValidationWaveProduct.from_dict(v if isinstance(v, dict) else {})
            for k, v in raw_products.items()
        }
        return cls(
            id=str(data.get("id") or uuid.uuid4().hex),
            name=str(data.get("name") or ""),
            validation_date=str(data.get("validation_date") or ""),
            notes=str(data.get("notes") or ""),
            source_filename=str(data.get("source_filename") or ""),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            products=products,
        )


class ValidationWaveStore:
    INDEX_FILE = "index.json"

    def __init__(self, study_slug: str) -> None:
        self.study_slug = study_slug
        self.root = validation_dir(study_slug)

    def _wave_path(self, wave_id: str) -> Path:
        return self.root / f"{wave_id}.json"

    def _load_index(self) -> list[dict[str, Any]]:
        index_path = self.root / self.INDEX_FILE
        if not index_path.exists():
            return []
        with index_path.open(encoding="utf-8") as fh:
            return json.load(fh)

    def _save_index(self, entries: list[dict[str, Any]]) -> None:
        with (self.root / self.INDEX_FILE).open("w", encoding="utf-8") as fh:
            json.dump(entries, fh, indent=2)

    def list_waves(self) -> list[dict[str, Any]]:
        entries = self._load_index()
        return sorted(entries, key=lambda e: (e.get("validation_date") or "", e.get("name") or ""))

    def name_exists(self, name: str) -> bool:
        norm = name.strip().lower()
        return any(e.get("name", "").strip().lower() == norm for e in self._load_index())

    def save(self, wave: ValidationWave) -> None:
        path = self._wave_path(wave.id)
        with path.open("w", encoding="utf-8") as fh:
            json.dump(wave.to_dict(), fh, indent=2)
        entries = [e for e in self._load_index() if e.get("id") != wave.id]
        entries.append(
            {
                "id": wave.id,
                "name": wave.name,
                "validation_date": wave.validation_date,
                "notes": wave.notes,
                "source_filename": wave.source_filename,
                "created_at": wave.created_at,
            }
        )
        self._save_index(entries)

    def load(self, wave_id: str) -> ValidationWave:
        path = self._wave_path(wave_id)
        if not path.exists():
            raise FileNotFoundError(f"Validation wave not found: {wave_id}")
        with path.open(encoding="utf-8") as fh:
            return ValidationWave.from_dict(json.load(fh))

    def load_all(self) -> list[ValidationWave]:
        waves: list[ValidationWave] = []
        for entry in self.list_waves():
            wid = entry.get("id")
            if wid:
                try:
                    waves.append(self.load(str(wid)))
                except FileNotFoundError:
                    continue
        return waves

    def delete(self, wave_id: str) -> None:
        path = self._wave_path(wave_id)
        if path.exists():
            path.unlink()
        entries = [e for e in self._load_index() if e.get("id") != wave_id]
        self._save_index(entries)

    @staticmethod
    def new_id() -> str:
        return uuid.uuid4().hex
