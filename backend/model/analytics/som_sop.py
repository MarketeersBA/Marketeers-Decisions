"""SoM vs SoP — ported from ProjectCore.SoMvsSoP() (decompiled C#)."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from model.project_core import ProjectCore


def som_vs_sop(project: "ProjectCore") -> list[dict[str, str | float]]:
    """Return rows for the SOM vs SoP scatter (chart name: 'SOM VS Brand Share').

    Source: decompiled/MarketSimulator.Model/ProjectCore.cs — SoMvsSoP()
    - SOM  = NewShare / 100  (volume market share, decimal fraction)
    - SoP  = Penetration / 100  (stored in column 'Brand Share' in original DataTable)
    """
    project.find_predicted_shares()
    rows: list[dict[str, str | float]] = []
    if project._model is None:
        return rows
    for p in project._model.included_products():
        rows.append({
            "name": p.name,
            "som": p.new_share / 100.0,
            "sop": p.penetration / 100.0,
        })
    return rows
