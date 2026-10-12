"""Session lifecycle — Phase 1: edits, segmentation, reset, recalculate."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from api.deps import get_current_client_id
from api.edits import apply_grid_changes
from api.study_access import ensure_study_access
from api.schemas import (
    ApplyScenarioRequest,
    CompetitorMove,
    CompetitorReactionRequest,
    CreateSessionRequest,
    RecalculateRequest,
    SegmentationRequest,
)
from api.serializers import segmentation_payload, session_payload
from api.sessions import session_manager
from data.scenario_store import ScenarioStore
from model.optimizer import apply_competitor_price_moves
from model.project_core import ProjectCore
from utils.excel_export import export_results_to_excel


def _scenario_name_from_moves(moves: list[CompetitorMove]) -> str:
    parts: list[str] = []
    for move in moves:
        if abs(move.pct) < 1e-12:
            continue
        sign = "+" if move.pct > 0 else ""
        pct = f"{move.pct:g}"
        parts.append(f"{move.brand} {sign}{pct}%")
    return " · ".join(parts) or "Competitor reaction"

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _project_or_404(session_id: str, client_id: str) -> ProjectCore:
    try:
        return session_manager.get(session_id, client_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found or expired") from exc


def _slug_or_404(session_id: str, client_id: str) -> str:
    try:
        return session_manager.get_slug(session_id, client_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found or expired") from exc


def _payload(session_id: str, project: ProjectCore, client_id: str) -> dict:
    slug = session_manager.get_slug(session_id, client_id)
    return session_payload(session_id, project, slug=slug)


@router.post("")
def create_session(
    body: CreateSessionRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    ensure_study_access(client_id, body.slug)
    try:
        session_id = session_manager.create(body.slug, client_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to load study: {exc}") from exc
    project = session_manager.get(session_id, client_id)
    return _payload(session_id, project, client_id)


@router.get("/{session_id}/segmentation")
def get_segmentation(session_id: str, client_id: str = Depends(get_current_client_id)) -> dict:
    project = _project_or_404(session_id, client_id)
    return segmentation_payload(project)


@router.get("/{session_id}/groups")
def get_groups(
    session_id: str,
    group_type: str | None = Query(None),
    groupType: str | None = Query(None),
    client_id: str = Depends(get_current_client_id),
) -> dict:
    project = _project_or_404(session_id, client_id)
    from api.serializers import group_rows

    gt = groupType or group_type or "Brand"
    return {"groups": group_rows(project, gt)}


@router.get("/{session_id}/bounds")
def get_bounds(session_id: str, client_id: str = Depends(get_current_client_id)) -> dict:
    """Calibrated attribute bounds for inline grid validation (Tier 1)."""
    project = _project_or_404(session_id, client_id)
    from model.attribute_bounds import attribute_bounds_payload

    return {"attributeBounds": attribute_bounds_payload(project)}


@router.post("/{session_id}/segmentation")
def set_segmentation(
    session_id: str,
    body: SegmentationRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    project = _project_or_404(session_id, client_id)
    if body.filters is not None:
        filt = [(f.assignment_key, f.member) for f in body.filters]
        project.apply_segmentation_from_session(None, None, filters=filt)
    else:
        project.apply_segmentation_from_session(body.assignment_key, body.member)
    return _payload(session_id, project, client_id)


@router.post("/{session_id}/recalculate")
def recalculate(
    session_id: str,
    body: RecalculateRequest | None = None,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    project = _project_or_404(session_id, client_id)
    changes = body.changes if body else []
    applied, warnings = apply_grid_changes(project, changes)
    project.find_predicted_shares()
    payload = _payload(session_id, project, client_id)
    payload["changesApplied"] = applied
    if warnings:
        payload["warnings"] = warnings
    return payload


@router.post("/{session_id}/reset")
def reset(session_id: str, client_id: str = Depends(get_current_client_id)) -> dict:
    project = _project_or_404(session_id, client_id)
    project.reset_products()
    project.scenario_name = ""
    return _payload(session_id, project, client_id)


@router.post("/{session_id}/apply-scenario")
def apply_scenario(
    session_id: str,
    body: ApplyScenarioRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    project = _project_or_404(session_id, client_id)
    slug = _slug_or_404(session_id, client_id)
    store = ScenarioStore(slug, client_id)
    try:
        scenario = store.load(body.name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Scenario not found: {body.name}") from exc
    project.apply_scenario(scenario)
    return _payload(session_id, project, client_id)


@router.post("/{session_id}/competitor-reaction")
def competitor_reaction(
    session_id: str,
    body: CompetitorReactionRequest,
    client_id: str = Depends(get_current_client_id),
) -> dict:
    """Reset to base, apply competitor price moves, save as a named scenario, leave it loaded."""
    project = _project_or_404(session_id, client_id)
    slug = _slug_or_404(session_id, client_id)

    moves = [m for m in body.moves if abs(m.pct) >= 1e-12]
    if not moves:
        raise HTTPException(status_code=400, detail="Select at least one competitor price change")
    if not body.group_type.strip():
        raise HTTPException(status_code=400, detail="group_type is required")

    # reset_products clears segmentation — restore the session's active filters.
    active_segments = project.get_active_segments()
    project.reset_products()
    if active_segments:
        project.apply_segmentation_filters(active_segments)

    changed = apply_competitor_price_moves(project, body.group_type, moves)
    if changed == 0:
        raise HTTPException(
            status_code=400,
            detail="No SKUs matched the selected competitor brands",
        )

    name = body.name.strip() or _scenario_name_from_moves(moves)
    description = body.description.strip() or f"Competitor price reaction: {name}"
    store = ScenarioStore(slug, client_id)
    scenario = project.capture_scenario(name, description)
    store.save(scenario)
    project.scenario_name = name
    return _payload(session_id, project, client_id)


@router.get("/{session_id}/export")
def export_session(
    session_id: str,
    format: str = Query("xlsx", pattern="^(csv|xlsx)$"),
    client_id: str = Depends(get_current_client_id),
) -> Response:
    import pandas as pd

    project = _project_or_404(session_id, client_id)
    df = project.results
    study_name = project.study_name

    if format == "csv":
        csv_bytes = df.to_csv(index=False).encode("utf-8")
        filename = f"{study_name}_results.csv"
        media = "text/csv"
        content = csv_bytes
    else:
        groups_df = None
        if project.group_types:
            groups_df = pd.DataFrame(project.group_summary(project.group_types[0]))
        content = export_results_to_excel(
            df,
            study_name,
            groups_df=groups_df,
            scenario_name=project.scenario_name or "",
        )
        filename = f"{study_name}_results.xlsx"
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/{session_id}")
def close_session(session_id: str, client_id: str = Depends(get_current_client_id)) -> dict:
    try:
        session_manager.close(session_id, client_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found or expired") from exc
    return {"ok": True}
