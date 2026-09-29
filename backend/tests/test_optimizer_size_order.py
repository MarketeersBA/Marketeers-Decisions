from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from api.routes.optimizer import JobRecord, _run_job
from model.optimizer import OptResult, sort_skus_by_size
from model.study_schema import ProductDef, StudyDocument, StudyMeta


def _document() -> StudyDocument:
    return StudyDocument(
        meta=StudyMeta(size_attribute="Pack Size"),
        products=[
            ProductDef(1, "Large B", base_attributes={"Pack Size": 500}),
            ProductDef(2, "Small B", base_attributes={"Pack Size": 250}),
            ProductDef(3, "Small A", base_attributes={"Pack Size": 250}),
            ProductDef(4, "Unknown", base_attributes={}),
        ],
    )


def test_skus_sort_by_size_then_name_with_missing_sizes_last() -> None:
    ordered = sort_skus_by_size(
        _document(),
        ["Large B", "Unknown", "Small B", "Small A"],
    )

    assert ordered == ["Small A", "Small B", "Large B", "Unknown"]


def test_sku_order_is_preserved_when_study_has_no_sizes() -> None:
    doc = StudyDocument(
        products=[
            ProductDef(1, "B"),
            ProductDef(2, "A"),
        ],
    )

    assert sort_skus_by_size(doc, ["B", "A"]) == ["B", "A"]


def test_optimizer_processes_bounds_in_size_order() -> None:
    doc = _document()
    project = SimpleNamespace(
        doc=doc,
        results=pd.DataFrame(
            [
                {"Product Name": p.name, "New Price": 10.0}
                for p in doc.products
            ]
        ),
    )
    request_bounds = [
        SimpleNamespace(
            sku=sku,
            base_price=10.0,
            lo=8.0,
            hi=12.0,
            cost=0.0,
            included=True,
        )
        for sku in ["Large B", "Unknown", "Small B", "Small A"]
    ]
    request = SimpleNamespace(
        assignment_key=None,
        member=None,
        filters=None,
        base_scenario=None,
        bounds=request_bounds,
        scope="selected",
        group_type="Brand",
        brand="Example",
        objective="revenue",
        max_iters=1,
        tol_str="0.00001",
        grid_points=5,
        max_volume_drop_pct=None,
        algorithm="coordinate_ascent",
        run_global=False,
    )
    job = JobRecord(job_id="test", slug="test", status="running")
    processed: list[str] = []

    def capture_order(_project, spec, on_eval=None):
        processed.extend(bound.sku for bound in spec.bounds)
        return OptResult({}, 0.0, 0.0, 0)

    with (
        patch("api.routes.optimizer._prepare_optimizer_project", return_value=project),
        patch("api.routes.optimizer.optimize_coordinate_ascent", side_effect=capture_order),
    ):
        _run_job(job, request)

    assert job.status == "done"
    assert processed == ["Small A", "Small B", "Large B", "Unknown"]
