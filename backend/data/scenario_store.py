"""JSON scenario persistence inside each study folder."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.deps import resolve_client_id
from config import get_storage, scenarios_dir


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', "_", name.strip())
    return cleaned or "scenario"


@dataclass
class ScenarioData:
    name: str
    description: str = ""
    validation: bool = False
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    product_overrides: dict[str, dict[str, Any]] = field(default_factory=dict)
    included_products: dict[str, bool] = field(default_factory=dict)
    segmentation: dict[str, str] = field(default_factory=dict)
    group_type: str = ""
    use_grouping: bool = False
    financial: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ScenarioData:
        return cls(
            name=data.get("name", ""),
            description=data.get("description", ""),
            validation=bool(data.get("validation", False)),
            created_at=data.get("created_at", datetime.now(timezone.utc).isoformat()),
            product_overrides=data.get("product_overrides", {}),
            included_products=data.get("included_products", {}),
            segmentation=data.get("segmentation", {}),
            group_type=data.get("group_type", ""),
            use_grouping=bool(data.get("use_grouping", False)),
            financial=bool(data.get("financial", False)),
        )


class ScenarioStore:
    INDEX_FILE = "index.json"

    def __init__(self, study_slug: str, client_id: str | None = None) -> None:
        self.study_slug = study_slug
        self.client_id = client_id or resolve_client_id()
        self.root = scenarios_dir(study_slug, self.client_id)

    def _put_file(self, filename: str) -> None:
        get_storage().put_study_file(self.client_id, self.study_slug, f"scenarios/{filename}")

    def _delete_file(self, filename: str) -> None:
        get_storage().delete_study_file(self.client_id, self.study_slug, f"scenarios/{filename}")

    def _scenario_path(self, name: str) -> Path:
        return self.root / f"{_safe_filename(name)}.json"

    def _load_index(self) -> list[dict[str, Any]]:
        index_path = self.root / self.INDEX_FILE
        if not index_path.exists():
            return []
        with index_path.open(encoding="utf-8") as fh:
            return json.load(fh)

    def _save_index(self, entries: list[dict[str, Any]]) -> None:
        with (self.root / self.INDEX_FILE).open("w", encoding="utf-8") as fh:
            json.dump(entries, fh, indent=2)
        self._put_file(self.INDEX_FILE)

    def _rebuild_index_from_files(self) -> list[dict[str, Any]]:
        """Rebuild index.json from scenario *.json files when index is missing or empty."""
        entries: list[dict[str, Any]] = []
        for path in sorted(self.root.glob("*.json")):
            if path.name == self.INDEX_FILE:
                continue
            try:
                with path.open(encoding="utf-8") as fh:
                    data = json.load(fh)
            except (json.JSONDecodeError, OSError):
                continue
            name = str(data.get("name") or path.stem)
            entries.append(
                {
                    "name": name,
                    "description": data.get("description", ""),
                    "validation": bool(data.get("validation", False)),
                    "file": path.name,
                    "created_at": data.get("created_at", datetime.now(timezone.utc).isoformat()),
                }
            )
        if entries:
            self._save_index(entries)
        return entries

    def list_scenarios(self) -> list[dict[str, Any]]:
        index_path = self.root / self.INDEX_FILE
        if index_path.exists():
            return self._load_index()
        return self._rebuild_index_from_files()

    def next_optimization_result_name(self) -> str:
        """Return the next auto-increment name: 'optimization result 1', 'optimization result 2', …"""
        pattern = re.compile(r"^optimization result (\d+)$", re.IGNORECASE)
        max_n = 0
        for entry in self._load_index():
            m = pattern.match(entry.get("name", ""))
            if m:
                max_n = max(max_n, int(m.group(1)))
        return f"optimization result {max_n + 1}"

    def save(self, scenario: ScenarioData) -> None:
        path = self._scenario_path(scenario.name)
        with path.open("w", encoding="utf-8") as fh:
            json.dump(scenario.to_dict(), fh, indent=2)
        self._put_file(path.name)
        entries = [e for e in self._load_index() if e.get("name") != scenario.name]
        entries.append(
            {
                "name": scenario.name,
                "description": scenario.description,
                "validation": scenario.validation,
                "file": path.name,
                "created_at": scenario.created_at,
            }
        )
        self._save_index(entries)

    def reorder(self, ordered_names: list[str]) -> list[dict[str, Any]]:
        """Rewrite index.json preserving the given order."""
        entries = self._load_index()
        by_name = {e["name"]: e for e in entries}
        missing = [n for n in ordered_names if n not in by_name]
        if missing:
            raise KeyError(f"Unknown scenario(s): {', '.join(missing)}")
        reordered = [by_name[n] for n in ordered_names]
        for e in entries:
            if e["name"] not in ordered_names:
                reordered.append(e)
        self._save_index(reordered)
        return reordered

    def import_many(self, scenarios: list[ScenarioData]) -> int:
        if not scenarios:
            return 0
        entries = self._load_index()
        for scenario in scenarios:
            path = self._scenario_path(scenario.name)
            with path.open("w", encoding="utf-8") as fh:
                json.dump(scenario.to_dict(), fh, indent=2)
            self._put_file(path.name)
            entries = [e for e in entries if e.get("name") != scenario.name]
            entries.append(
                {
                    "name": scenario.name,
                    "description": scenario.description,
                    "validation": scenario.validation,
                    "file": path.name,
                    "created_at": scenario.created_at,
                }
            )
        self._save_index(entries)
        return len(scenarios)

    def load(self, name: str) -> ScenarioData:
        path = self._scenario_path(name)
        if not path.exists():
            raise FileNotFoundError(f"Scenario not found: {name}")
        with path.open(encoding="utf-8") as fh:
            return ScenarioData.from_dict(json.load(fh))

    def delete(self, name: str) -> None:
        path = self._scenario_path(name)
        entries = [e for e in self._load_index() if e.get("name") != name]
        self._save_index(entries)
        if path.exists():
            path.unlink()
        self._delete_file(path.name)

    def exists(self, name: str) -> bool:
        return self._scenario_path(name).exists()
