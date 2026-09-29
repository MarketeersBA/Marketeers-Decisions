"""Tests for validation wave upload, storage, and series API."""

from __future__ import annotations

import io
from datetime import date

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api.main import app
from data.validation_store import ValidationWaveStore
from model.analytics.validation import _competitor_brand_shares, _run_validation_wave, validation_series
from model.project_core import ProjectCore

client = TestClient(app)


@pytest.fixture
def demo_slug() -> str:
    if not ProjectCore.study_exists("Demo_Study"):
        pytest.skip("Demo_Study not available")
    return "Demo_Study"


def _build_validation_xlsx(
    *,
    name: str,
    validation_date: date,
    rows: list[dict],
) -> bytes:
    desc = pd.DataFrame(
        {
            "Field": ["Validation Name", "Validation Date", "Notes"],
            "Value": [name, validation_date.isoformat(), "pytest"],
        }
    )
    products = pd.DataFrame(rows)
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        desc.to_excel(writer, sheet_name="Description", index=False)
        products.to_excel(writer, sheet_name="Product List", index=False)
    return buf.getvalue()


def _demo_wave_rows(audit_a: float = 5.0) -> list[dict]:
    return [
        {
            "SKU Name": "Product A",
            "Base Price": 10.0,
            "WD": 1.0,
            "Market Share": 40.0,
            "Audit Share": audit_a,
        },
        {
            "SKU Name": "Product B",
            "Base Price": 12.0,
            "WD": 1.0,
            "Market Share": 35.0,
            "Audit Share": 2.0,
        },
        {
            "SKU Name": "Product C",
            "Base Price": 8.0,
            "WD": 1.0,
            "Market Share": 25.0,
            "Audit Share": 1.0,
        },
    ]


def test_validation_upload_list_series_and_delete(demo_slug: str) -> None:
    wave_name = "pytest_wave_apr"
    store = ValidationWaveStore(demo_slug)
    for entry in store.list_waves():
        if entry.get("name") == wave_name:
            store.delete(str(entry["id"]))

    xlsx = _build_validation_xlsx(
        name=wave_name,
        validation_date=date(2026, 4, 1),
        rows=_demo_wave_rows(),
    )
    r = client.post(
        f"/api/studies/{demo_slug}/validation/upload",
        files={"file": ("validation_apr.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == wave_name
    wave_id = body["id"]

    r = client.get(f"/api/studies/{demo_slug}/validation")
    assert r.status_code == 200
    names = [w["name"] for w in r.json()["waves"]]
    assert wave_name in names

    r = client.get(f"/api/studies/{demo_slug}/validation/series")
    assert r.status_code == 200
    points = r.json()["points"]
    match = [p for p in points if p["id"] == wave_id]
    assert match
    assert match[0]["predicted"] is not None
    assert match[0]["actual"] is not None
    latest = r.json()["latestBrands"]
    assert latest is not None
    assert latest["id"] == wave_id
    assert isinstance(latest["brands"], list)
    for brand in latest["brands"]:
        assert brand["name"]
        assert isinstance(brand["current"], (int, float))
        assert isinstance(brand["validation"], (int, float))

    wave = store.load(wave_id)
    trial = _run_validation_wave(demo_slug, wave)
    raw = ProjectCore(demo_slug)
    raw.initialize()
    raw.find_predicted_shares()
    audit_total = trial.get_total_products_audit_share()
    study_total = raw.get_total_products_new_share()
    scaled = ProjectCore(demo_slug)
    scaled.initialize()
    scaled.find_predicted_shares()
    scaled.rebase_product_new_share(audit_total)
    raw_brands = {b["name"]: b["current"] for b in _competitor_brand_shares(raw, trial)}
    scaled_brands = {b["name"]: b["current"] for b in _competitor_brand_shares(scaled, trial)}
    if study_total > 0 and raw_brands:
        factor = audit_total / study_total
        for name, before in raw_brands.items():
            assert scaled_brands[name] == pytest.approx(before * factor, abs=0.02)
            api_brand = next(b for b in latest["brands"] if b["name"] == name)
            assert api_brand["current"] == pytest.approx(scaled_brands[name], abs=0.02)

    r = client.delete(f"/api/studies/{demo_slug}/validation/{wave_id}")
    assert r.status_code == 200


def test_validation_upload_duplicate_name_409(demo_slug: str) -> None:
    wave_name = "pytest_wave_dup"
    store = ValidationWaveStore(demo_slug)
    for entry in store.list_waves():
        if entry.get("name") == wave_name:
            store.delete(str(entry["id"]))

    xlsx = _build_validation_xlsx(
        name=wave_name,
        validation_date=date(2026, 5, 1),
        rows=_demo_wave_rows(),
    )
    files = {
        "file": ("v.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    }
    assert client.post(f"/api/studies/{demo_slug}/validation/upload", files=files).status_code == 200
    r = client.post(f"/api/studies/{demo_slug}/validation/upload", files=files)
    assert r.status_code == 409

    for entry in store.list_waves():
        if entry.get("name") == wave_name:
            store.delete(str(entry["id"]))


def test_validation_audit_overlay_changes_company_actual(demo_slug: str) -> None:
    from data.validation_store import ValidationWave, ValidationWaveProduct

    wave_high = ValidationWave(
        id="test-overlay-high",
        name="overlay-high",
        validation_date="2026-06-01",
        products={
            "Product A": ValidationWaveProduct(attributes={"Price": 10.0}, wd=1.0, benchmark_share_pp=50.0),
            "Product B": ValidationWaveProduct(attributes={"Price": 12.0}, wd=1.0, benchmark_share_pp=2.0),
            "Product C": ValidationWaveProduct(attributes={"Price": 8.0}, wd=1.0, benchmark_share_pp=1.0),
        },
    )
    wave_low = ValidationWave(
        id="test-overlay-low",
        name="overlay-low",
        validation_date="2026-06-02",
        products={
            "Product A": ValidationWaveProduct(attributes={"Price": 10.0}, wd=1.0, benchmark_share_pp=1.0),
            "Product B": ValidationWaveProduct(attributes={"Price": 12.0}, wd=1.0, benchmark_share_pp=1.0),
            "Product C": ValidationWaveProduct(attributes={"Price": 8.0}, wd=1.0, benchmark_share_pp=1.0),
        },
    )
    trial_high = _run_validation_wave(demo_slug, wave_high)
    trial_low = _run_validation_wave(demo_slug, wave_low)
    actual_high = trial_high.get_company_share("AuditShare")
    actual_low = trial_low.get_company_share("AuditShare")
    assert actual_high != actual_low
    assert actual_high > actual_low

    series = validation_series(demo_slug)
    assert "points" in series
