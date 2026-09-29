"""Study registry — studies/index.json (replaces Studies.xml)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import STUDIES_DIR, STUDY_INDEX_FILE, slugify, study_folder


@dataclass
class StudyEntry:
    slug: str
    name: str
    company: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @property
    def path(self) -> Path:
        return study_folder(self.slug)


class StudyIndex:
    def __init__(self, index_path: Path | None = None) -> None:
        self.index_path = index_path or STUDY_INDEX_FILE
        self.research_start: str = ""
        self.studies: list[StudyEntry] = []
        self.reload()

    def reload(self) -> None:
        self.studies.clear()
        self.research_start = ""
        if not self.index_path.exists():
            return
        with self.index_path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        self.research_start = data.get("research_start", "")
        for item in data.get("studies", []):
            self.studies.append(StudyEntry(**item))

    def save(self) -> None:
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "research_start": self.research_start,
            "studies": [asdict(s) for s in self.studies],
        }
        with self.index_path.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)

    def add(self, name: str, company: str = "", set_default: bool = True) -> StudyEntry:
        slug = slugify(name)
        existing = self.get_by_slug(slug)
        if existing:
            existing.name = name
            existing.company = company
            entry = existing
        else:
            entry = StudyEntry(slug=slug, name=name, company=company)
            self.studies.append(entry)
        if set_default or not self.research_start:
            self.research_start = slug
        self.save()
        return entry

    def get_by_slug(self, slug: str) -> StudyEntry | None:
        for s in self.studies:
            if s.slug == slug:
                return s
        return None

    def get_by_name(self, name: str) -> StudyEntry | None:
        for s in self.studies:
            if s.name == name:
                return s
        return None

    def remove(self, slug: str) -> None:
        self.studies = [s for s in self.studies if s.slug != slug]
        if self.research_start == slug:
            self.research_start = self.studies[0].slug if self.studies else ""
        self.save()

    def slugs(self) -> list[str]:
        return [s.slug for s in self.studies]

    def names(self) -> list[str]:
        return [s.name for s in self.studies]
