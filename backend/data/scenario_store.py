"""JSON scenario persistence inside each study folder.

Storage identity is a UUID filename; display names live in metadata and the
index. Legacy name-based files are migrated on first access.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.deps import resolve_client_id
from config import get_storage, scenarios_dir

_UUID_STEM = re.compile(r"^[0-9a-f]{32}$")


def _new_id() -> str:
    return uuid.uuid4().hex


def _is_uuid_stem(stem: str) -> bool:
    return bool(_UUID_STEM.match(stem))


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
    id: str = ""

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
            id=str(data.get("id") or ""),
        )


class ScenarioStore:
    INDEX_FILE = "index.json"

    def __init__(self, study_slug: str, client_id: str | None = None) -> None:
        self.study_slug = study_slug
        self.client_id = client_id or resolve_client_id()
        self.root = scenarios_dir(study_slug, self.client_id)
        self.root.mkdir(parents=True, exist_ok=True)
        self._ensure_migrated()

    def _put_file(self, filename: str) -> None:
        get_storage().put_study_file(self.client_id, self.study_slug, f"scenarios/{filename}")

    def _delete_file(self, filename: str) -> None:
        get_storage().delete_study_file(self.client_id, self.study_slug, f"scenarios/{filename}")

    def _scenario_path(self, scenario_id: str) -> Path:
        return self.root / f"{scenario_id}.json"

    def _load_index_raw(self) -> list[dict[str, Any]]:
        index_path = self.root / self.INDEX_FILE
        if not index_path.exists():
            return []
        with index_path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []

    def _save_index(self, entries: list[dict[str, Any]]) -> None:
        with (self.root / self.INDEX_FILE).open("w", encoding="utf-8") as fh:
            json.dump(entries, fh, indent=2)
        self._put_file(self.INDEX_FILE)

    def _index_entry(
        self,
        *,
        scenario_id: str,
        name: str,
        description: str,
        validation: bool,
        created_at: str,
    ) -> dict[str, Any]:
        return {
            "id": scenario_id,
            "name": name,
            "description": description,
            "validation": validation,
            "file": f"{scenario_id}.json",
            "created_at": created_at,
        }

    def _find_by_name(self, entries: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
        for entry in entries:
            if entry.get("name") == name:
                return entry
        return None

    def _scan_scenario_files(self) -> list[Path]:
        return sorted(
            p for p in self.root.glob("*.json") if p.name != self.INDEX_FILE and p.is_file()
        )

    def _ensure_migrated(self) -> None:
        """Assign UUIDs and rename legacy name-based scenario files into id.json form."""
        entries = self._load_index_raw()
        changed = False

        if not entries:
            rebuilt: list[dict[str, Any]] = []
            for path in self._scan_scenario_files():
                try:
                    with path.open(encoding="utf-8") as fh:
                        data = json.load(fh)
                except (json.JSONDecodeError, OSError):
                    continue
                if not isinstance(data, dict):
                    continue
                name = str(data.get("name") or path.stem)
                scenario_id = str(data.get("id") or "")
                if not scenario_id or not _is_uuid_stem(scenario_id):
                    scenario_id = path.stem if _is_uuid_stem(path.stem) else _new_id()
                target = self._scenario_path(scenario_id)
                if path.resolve() != target.resolve():
                    if target.exists():
                        scenario_id = _new_id()
                        target = self._scenario_path(scenario_id)
                    data["id"] = scenario_id
                    data["name"] = name
                    with target.open("w", encoding="utf-8") as fh:
                        json.dump(data, fh, indent=2)
                    self._put_file(target.name)
                    path.unlink(missing_ok=True)
                    self._delete_file(path.name)
                    changed = True
                elif not data.get("id"):
                    data["id"] = scenario_id
                    with path.open("w", encoding="utf-8") as fh:
                        json.dump(data, fh, indent=2)
                    self._put_file(path.name)
                    changed = True
                rebuilt.append(
                    self._index_entry(
                        scenario_id=scenario_id,
                        name=name,
                        description=str(data.get("description", "")),
                        validation=bool(data.get("validation", False)),
                        created_at=str(
                            data.get("created_at") or datetime.now(timezone.utc).isoformat()
                        ),
                    )
                )
            if rebuilt:
                self._save_index(rebuilt)
            return

        migrated: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for entry in entries:
            name = str(entry.get("name") or "")
            scenario_id = str(entry.get("id") or "")
            file_name = str(entry.get("file") or "")
            source = self.root / file_name if file_name else None
            if source is None or not source.is_file():
                # Fall back to legacy name-stem or id-stem lookup
                candidates = []
                if scenario_id:
                    candidates.append(self._scenario_path(scenario_id))
                if name:
                    candidates.append(self.root / f"{name}.json")
                source = next((p for p in candidates if p.is_file()), None)

            if source is None:
                changed = True
                continue

            if not scenario_id or not _is_uuid_stem(scenario_id):
                scenario_id = source.stem if _is_uuid_stem(source.stem) else _new_id()
                changed = True
            if scenario_id in seen_ids:
                scenario_id = _new_id()
                changed = True
            seen_ids.add(scenario_id)

            target = self._scenario_path(scenario_id)
            try:
                with source.open(encoding="utf-8") as fh:
                    data = json.load(fh)
            except (json.JSONDecodeError, OSError):
                changed = True
                continue
            if not isinstance(data, dict):
                changed = True
                continue

            payload_name = str(data.get("name") or name or source.stem)
            data["id"] = scenario_id
            data["name"] = payload_name

            if source.resolve() != target.resolve():
                with target.open("w", encoding="utf-8") as fh:
                    json.dump(data, fh, indent=2)
                self._put_file(target.name)
                if source.exists():
                    source.unlink(missing_ok=True)
                    self._delete_file(source.name)
                changed = True
            elif data.get("id") != scenario_id or entry.get("file") != target.name:
                with target.open("w", encoding="utf-8") as fh:
                    json.dump(data, fh, indent=2)
                self._put_file(target.name)
                changed = True

            new_entry = self._index_entry(
                scenario_id=scenario_id,
                name=payload_name,
                description=str(entry.get("description", data.get("description", ""))),
                validation=bool(entry.get("validation", data.get("validation", False))),
                created_at=str(
                    entry.get("created_at")
                    or data.get("created_at")
                    or datetime.now(timezone.utc).isoformat()
                ),
            )
            if new_entry != entry:
                changed = True
            migrated.append(new_entry)

        if changed:
            self._save_index(migrated)

    def _load_index(self) -> list[dict[str, Any]]:
        return self._load_index_raw()

    def list_scenarios(self) -> list[dict[str, Any]]:
        return self._load_index()

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
        name = (scenario.name or "").strip()
        if not name:
            raise ValueError("Scenario name is required")
        scenario.name = name

        entries = self._load_index()
        existing = self._find_by_name(entries, name)
        if existing and existing.get("id"):
            scenario_id = str(existing["id"])
        elif scenario.id and _is_uuid_stem(scenario.id):
            scenario_id = scenario.id
        else:
            scenario_id = _new_id()
        scenario.id = scenario_id

        path = self._scenario_path(scenario_id)
        with path.open("w", encoding="utf-8") as fh:
            json.dump(scenario.to_dict(), fh, indent=2)
        self._put_file(path.name)

        entries = [e for e in entries if e.get("name") != name and e.get("id") != scenario_id]
        entries.append(
            self._index_entry(
                scenario_id=scenario_id,
                name=name,
                description=scenario.description,
                validation=scenario.validation,
                created_at=scenario.created_at,
            )
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
            name = (scenario.name or "").strip()
            if not name:
                continue
            scenario.name = name
            existing = self._find_by_name(entries, name)
            if existing and existing.get("id"):
                scenario_id = str(existing["id"])
            elif scenario.id and _is_uuid_stem(scenario.id):
                scenario_id = scenario.id
            else:
                scenario_id = _new_id()
            scenario.id = scenario_id
            path = self._scenario_path(scenario_id)
            with path.open("w", encoding="utf-8") as fh:
                json.dump(scenario.to_dict(), fh, indent=2)
            self._put_file(path.name)
            entries = [e for e in entries if e.get("name") != name and e.get("id") != scenario_id]
            entries.append(
                self._index_entry(
                    scenario_id=scenario_id,
                    name=name,
                    description=scenario.description,
                    validation=scenario.validation,
                    created_at=scenario.created_at,
                )
            )
        self._save_index(entries)
        return len(scenarios)

    def load(self, name: str) -> ScenarioData:
        entry = self._find_by_name(self._load_index(), name)
        if entry is None or not entry.get("id"):
            raise FileNotFoundError(f"Scenario not found: {name}")
        path = self._scenario_path(str(entry["id"]))
        if not path.exists():
            raise FileNotFoundError(f"Scenario not found: {name}")
        with path.open(encoding="utf-8") as fh:
            return ScenarioData.from_dict(json.load(fh))

    def delete(self, name: str) -> None:
        entries = self._load_index()
        entry = self._find_by_name(entries, name)
        entries = [e for e in entries if e.get("name") != name]
        self._save_index(entries)
        if entry and entry.get("id"):
            path = self._scenario_path(str(entry["id"]))
            if path.exists():
                path.unlink()
            self._delete_file(path.name)
        elif entry and entry.get("file"):
            path = self.root / str(entry["file"])
            if path.exists():
                path.unlink()
            self._delete_file(path.name)

    def exists(self, name: str) -> bool:
        return self._find_by_name(self._load_index(), name) is not None
