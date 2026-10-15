"""Tests for S3 storage synchronization with ScenarioStore and ValidationWaveStore."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

import config
from data.scenario_store import ScenarioData, ScenarioStore
from data.storage.s3 import S3StorageBackend
from data.validation_store import ValidationWave, ValidationWaveProduct, ValidationWaveStore


class _FakePaginator:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self._objects = objects

    def paginate(self, *, Bucket: str, Prefix: str):  # noqa: ARG002, N803
        contents = [
            {"Key": key, "Size": len(payload)}
            for key, payload in sorted(self._objects.items())
            if key.startswith(Prefix)
        ]
        yield {"Contents": contents}


class _FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.upload_calls: list[str] = []
        self.delete_calls: list[str] = []

    def get_paginator(self, name: str) -> _FakePaginator:
        assert name == "list_objects_v2"
        return _FakePaginator(self.objects)

    def upload_file(self, filename: str, bucket: str, key: str) -> None:  # noqa: ARG002
        self.objects[key] = Path(filename).read_bytes()
        self.upload_calls.append(key)

    def download_file(self, bucket: str, key: str, filename: str) -> None:  # noqa: ARG002
        if key not in self.objects:
            raise FileNotFoundError(key)
        dest = Path(filename)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self.objects[key])

    def delete_object(self, *, Bucket: str, Key: str) -> None:  # noqa: ARG002, N803
        self.objects.pop(Key, None)
        self.delete_calls.append(Key)


@pytest.fixture
def s3_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    fake_s3 = _FakeS3Client()
    backend = S3StorageBackend.__new__(S3StorageBackend)
    backend._s3 = fake_s3
    backend._bucket = "test-bucket"

    monkeypatch.setattr(config, "MARKET_SIM_STORAGE", "s3")
    monkeypatch.setattr(config, "MARKET_SIM_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(config, "MARKET_SIM_S3_PREFIX", "clients")
    monkeypatch.setattr(config, "_storage_backend", backend)
    monkeypatch.setattr("data.storage.s3.MARKET_SIM_CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr("data.storage.s3.MARKET_SIM_S3_PREFIX", "clients")

    client_id = "acme"
    slug = "araby"
    prefix = f"clients/{client_id}/{slug}/"
    fake_s3.objects[prefix + "study.json"] = b"{}"
    fake_s3.objects[prefix + "hbu.parquet"] = b"PAR1"

    return backend, fake_s3, client_id, slug


def test_scenario_save_reorder_delete_persists_to_s3(s3_env) -> None:
    backend, fake_s3, client_id, slug = s3_env

    store = ScenarioStore(slug, client_id)
    store.save(ScenarioData(name="Base", description="baseline"))
    store.save(ScenarioData(name="Price cut", description="promo"))

    entries = store.list_scenarios()
    assert {e["name"] for e in entries} == {"Base", "Price cut"}
    assert all(e.get("id") and e["file"] == f"{e['id']}.json" for e in entries)
    for entry in entries:
        assert f"clients/{client_id}/{slug}/scenarios/{entry['file']}" in fake_s3.objects
    assert f"clients/{client_id}/{slug}/scenarios/index.json" in fake_s3.objects

    price_cut_id = next(e["id"] for e in entries if e["name"] == "Price cut")
    price_cut_key = f"clients/{client_id}/{slug}/scenarios/{price_cut_id}.json"

    # Wipe the local mirror and verify synchronization restores from S3 without losing data
    shutil.rmtree(backend._mirror_root(client_id, slug))
    store_after_wipe = ScenarioStore(slug, client_id)
    names = [e["name"] for e in store_after_wipe.list_scenarios()]
    assert names == ["Base", "Price cut"]
    assert store_after_wipe.load("Price cut").description == "promo"

    # Reorder persists to S3
    store_after_wipe.reorder(["Price cut", "Base"])
    shutil.rmtree(backend._mirror_root(client_id, slug))
    reordered_names = [e["name"] for e in ScenarioStore(slug, client_id).list_scenarios()]
    assert reordered_names == ["Price cut", "Base"]

    # Delete removes from S3 and prunes stale mirror files on next sync
    ScenarioStore(slug, client_id).delete("Price cut")
    assert price_cut_key not in fake_s3.objects

    # Simulate another worker that still had the deleted scenario file in its local mirror
    stale_file = backend._mirror_root(client_id, slug) / "scenarios" / f"{price_cut_id}.json"
    stale_file.parent.mkdir(parents=True, exist_ok=True)
    stale_file.write_text('{"name": "Price cut", "id": "%s"}' % price_cut_id, encoding="utf-8")
    synced_store = ScenarioStore(slug, client_id)
    assert not stale_file.exists()
    assert [e["name"] for e in synced_store.list_scenarios()] == ["Base"]

    # Deleting the last scenario keeps an empty index.json and does not rebuild
    synced_store.delete("Base")
    assert ScenarioStore(slug, client_id).list_scenarios() == []


def test_scenario_import_many_batches_index_upload(s3_env) -> None:
    backend, fake_s3, client_id, slug = s3_env

    store = ScenarioStore(slug, client_id)
    fake_s3.upload_calls.clear()

    scenarios = [
        ScenarioData(name="S1"),
        ScenarioData(name="S2"),
        ScenarioData(name="S3"),
    ]
    count = store.import_many(scenarios)
    assert count == 3

    index_key = f"clients/{client_id}/{slug}/scenarios/index.json"
    assert fake_s3.upload_calls.count(index_key) == 1
    assert len(fake_s3.upload_calls) == 4  # 3 scenario files + 1 index.json

    shutil.rmtree(backend._mirror_root(client_id, slug))
    assert [e["name"] for e in ScenarioStore(slug, client_id).list_scenarios()] == ["S1", "S2", "S3"]


def test_validation_wave_save_and_delete_persists_to_s3(s3_env) -> None:
    backend, fake_s3, client_id, slug = s3_env

    store = ValidationWaveStore(slug, client_id)
    wave = ValidationWave(
        id="wave-q1",
        name="Q1 Audit",
        validation_date="2026-03-01",
        products={
            "SKU A": ValidationWaveProduct(attributes={"Price": 10.0}, wd=90.0, benchmark_share_pp=25.0),
        },
    )
    store.save(wave)

    assert f"clients/{client_id}/{slug}/validation/wave-q1.json" in fake_s3.objects
    assert f"clients/{client_id}/{slug}/validation/index.json" in fake_s3.objects

    # Wipe local mirror and verify wave survives S3 sync
    shutil.rmtree(backend._mirror_root(client_id, slug))
    reloaded_store = ValidationWaveStore(slug, client_id)
    waves = reloaded_store.list_waves()
    assert len(waves) == 1
    assert waves[0]["id"] == "wave-q1"
    loaded_wave = reloaded_store.load("wave-q1")
    assert loaded_wave.products["SKU A"].benchmark_share_pp == 25.0

    # Delete wave and verify it does not come back after sync
    reloaded_store.delete("wave-q1")
    assert f"clients/{client_id}/{slug}/validation/wave-q1.json" not in fake_s3.objects
    assert ValidationWaveStore(slug, client_id).list_waves() == []
