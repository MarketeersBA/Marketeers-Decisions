"""API integration tests — Phase 2 management endpoints."""

from __future__ import annotations

import io

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api.main import app
from model.project_core import ProjectCore

client = TestClient(app)


@pytest.fixture
def demo_slug() -> str:
    if not ProjectCore.study_exists("Demo_Study"):
        pytest.skip("Demo_Study not available")
    return "Demo_Study"


def test_study_patch_and_export(demo_slug: str) -> None:
    r = client.patch(f"/api/studies/{demo_slug}", json={"company": "Demo Co"})
    assert r.status_code == 200
    assert r.json()["company"] == "Demo Co"

    r_sess = client.post("/api/sessions", json={"slug": demo_slug})
    session_id = r_sess.json()["sessionId"]

    r_xlsx = client.get(f"/api/sessions/{session_id}/export?format=xlsx")
    assert r_xlsx.status_code == 200
    assert "spreadsheetml" in r_xlsx.headers["content-type"]

    r_csv = client.get(f"/api/sessions/{session_id}/export?format=csv")
    assert r_csv.status_code == 200
    assert r_csv.headers["content-type"].startswith("text/csv")


def test_scenario_reorder(demo_slug: str) -> None:
    r_sess = client.post("/api/sessions", json={"slug": demo_slug})
    session_id = r_sess.json()["sessionId"]

    for name in ("_pytest_a", "_pytest_b"):
        client.post(
            f"/api/studies/{demo_slug}/scenarios",
            json={"session_id": session_id, "name": name, "description": name, "validation": False},
        )

    r_list = client.get(f"/api/studies/{demo_slug}/scenarios")
    names = [s["name"] for s in r_list.json() if s["name"].startswith("_pytest_")]
    assert len(names) >= 2

    reversed_order = list(reversed(names))
    r_order = client.patch(f"/api/studies/{demo_slug}/scenarios/order", json={"order": reversed_order})
    assert r_order.status_code == 200

    r_after = client.get(f"/api/studies/{demo_slug}/scenarios")
    ordered = [s["name"] for s in r_after.json() if s["name"].startswith("_pytest_")]
    assert ordered[: len(reversed_order)] == reversed_order

    for name in names:
        client.delete(f"/api/studies/{demo_slug}/scenarios/{name}")


def test_scenario_import_preview(demo_slug: str) -> None:
    buffer = io.BytesIO()
    df = pd.DataFrame(
        {
            "Product Name": ["Product A", "Product B"],
            "New Price": [10.5, 11.0],
            "New WD": [90, 95],
            "Selected": [True, True],
        }
    )
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Imported Scenario", index=False)
    buffer.seek(0)

    r = client.post(
        f"/api/studies/{demo_slug}/scenarios/import/preview",
        files={"file": ("scenarios.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200
    previews = r.json()["previews"]
    assert any(p["name"] == "Imported Scenario" and p["valid"] for p in previews)

    client.delete(f"/api/studies/{demo_slug}/scenarios/Imported%20Scenario")
