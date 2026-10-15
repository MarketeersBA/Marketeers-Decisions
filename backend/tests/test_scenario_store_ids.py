"""ScenarioStore UUID identity, legacy migration, and name collision safety."""

from __future__ import annotations

import json
import re

import pytest

import config
from data.scenario_store import ScenarioData, ScenarioStore, _is_uuid_stem
from data.storage.local import LocalStorageBackend

_UUID_FILE = re.compile(r"^[0-9a-f]{32}\.json$")


@pytest.fixture
def scenario_env(tmp_path, monkeypatch):
    monkeypatch.setenv("MARKET_SIM_STUDIES_DIR", str(tmp_path))
    monkeypatch.setattr(config, "STUDIES_DIR", tmp_path)
    monkeypatch.setattr(config, "MARKET_SIM_AUTH", "dev")
    backend = LocalStorageBackend()
    monkeypatch.setattr(config, "_storage_backend", backend)
    client_id = "local-dev"
    slug = "demo"
    # Ensure study folder scaffolding exists for scenarios_dir
    root = backend.study_root_path(client_id, slug)
    root.mkdir(parents=True, exist_ok=True)
    (root / "scenarios").mkdir(parents=True, exist_ok=True)
    return backend, client_id, slug, root / "scenarios"


def test_save_uses_uuid_filename_not_display_name(scenario_env) -> None:
    _, client_id, slug, scenarios_root = scenario_env
    store = ScenarioStore(slug, client_id)
    store.save(ScenarioData(name="A/B", description="slash"))
    store.save(ScenarioData(name="A_B", description="underscore"))
    store.save(ScenarioData(name="index", description="reserved-looking"))

    entries = store.list_scenarios()
    assert {e["name"] for e in entries} == {"A/B", "A_B", "index"}
    assert len(entries) == 3

    files = [p.name for p in scenarios_root.glob("*.json") if p.name != "index.json"]
    assert len(files) == 3
    assert all(_UUID_FILE.match(name) for name in files)
    assert not (scenarios_root / "A_B.json").exists()

    assert store.load("A/B").description == "slash"
    assert store.load("A_B").description == "underscore"
    assert store.load("index").description == "reserved-looking"
    # Catalog index.json remains a list, not overwritten by the "index" scenario payload
    catalog = json.loads((scenarios_root / "index.json").read_text(encoding="utf-8"))
    assert isinstance(catalog, list)
    assert len(catalog) == 3
    assert all("name" in e and "id" in e for e in catalog)


def test_same_name_overwrites_same_id(scenario_env) -> None:
    _, client_id, slug, scenarios_root = scenario_env
    store = ScenarioStore(slug, client_id)
    store.save(ScenarioData(name="Promo", description="v1"))
    first_id = store.list_scenarios()[0]["id"]
    store.save(ScenarioData(name="Promo", description="v2"))
    entries = store.list_scenarios()
    assert len(entries) == 1
    assert entries[0]["id"] == first_id
    assert store.load("Promo").description == "v2"
    files = [p for p in scenarios_root.glob("*.json") if p.name != "index.json"]
    assert len(files) == 1


def test_migrates_legacy_name_based_files(scenario_env) -> None:
    _, client_id, slug, scenarios_root = scenario_env
    legacy = scenarios_root / "Price cut.json"
    legacy.write_text(
        json.dumps(
            {
                "name": "Price cut",
                "description": "legacy",
                "validation": False,
                "created_at": "2020-01-01T00:00:00+00:00",
                "product_overrides": {},
                "included_products": {},
                "segmentation": {},
            }
        ),
        encoding="utf-8",
    )
    index = [
        {
            "name": "Price cut",
            "description": "legacy",
            "validation": False,
            "file": "Price cut.json",
            "created_at": "2020-01-01T00:00:00+00:00",
        }
    ]
    (scenarios_root / "index.json").write_text(json.dumps(index), encoding="utf-8")

    store = ScenarioStore(slug, client_id)
    entries = store.list_scenarios()
    assert len(entries) == 1
    assert entries[0]["name"] == "Price cut"
    assert _is_uuid_stem(entries[0]["id"])
    assert entries[0]["file"] == f"{entries[0]['id']}.json"
    assert not legacy.exists()
    assert (scenarios_root / entries[0]["file"]).is_file()
    assert store.load("Price cut").description == "legacy"


def test_migrates_legacy_files_without_index(scenario_env) -> None:
    _, client_id, slug, scenarios_root = scenario_env
    (scenarios_root / "Base.json").write_text(
        json.dumps({"name": "Base", "description": "base"}),
        encoding="utf-8",
    )
    store = ScenarioStore(slug, client_id)
    entries = store.list_scenarios()
    assert len(entries) == 1
    assert entries[0]["name"] == "Base"
    assert _is_uuid_stem(entries[0]["id"])
    assert not (scenarios_root / "Base.json").exists()
    assert store.load("Base").description == "base"
