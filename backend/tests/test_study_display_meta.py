"""Study display meta (currency symbol, size unit label) API."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from api.main import app
from config import study_json_path

client = TestClient(app)


def test_get_study_meta_defaults(demo_slug: str) -> None:
    r = client.get(f"/api/studies/{demo_slug}/meta")
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == demo_slug
    assert body["price_currency_symbol"]
    assert body["size_unit_label"]


def test_patch_study_meta_persists(demo_slug: str) -> None:
    path = study_json_path(demo_slug)
    original = json.loads(path.read_text(encoding="utf-8"))
    try:
        r = client.patch(
            f"/api/studies/{demo_slug}/meta",
            json={"price_currency_symbol": "$", "size_unit_label": "kg"},
        )
        assert r.status_code == 200
        assert r.json()["price_currency_symbol"] == "$"
        assert r.json()["size_unit_label"] == "kg"

        on_disk = json.loads(path.read_text(encoding="utf-8"))
        assert on_disk["meta"]["price_currency_symbol"] == "$"
        assert on_disk["meta"]["size_unit_label"] == "kg"

        r_sess = client.post("/api/sessions", json={"slug": demo_slug})
        assert r_sess.status_code == 200
        study = r_sess.json()["study"]
        assert study["currencySymbol"] == "$"
        assert study["sizeUnitLabel"] == "kg"
    finally:
        path.write_text(json.dumps(original, indent=2), encoding="utf-8")
