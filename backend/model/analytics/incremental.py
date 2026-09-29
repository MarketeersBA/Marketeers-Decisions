"""Incremental intro/removal — ported from exIncrementalGainLoss / cumIncrementalGainLoss."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from model.analytics._helpers import clone_project

if TYPE_CHECKING:
    from model.project_core import ProjectCore

Mode = Literal["exclusive", "cumulative"]
Metric = Literal["Revenue", "Market Share", "Value Share"]
IntroOrder = Literal["greedy", "sorted"]


def _product_wd(project: "ProjectCore", name: str) -> float:
    model = project._model
    if model is None:
        return 0.0
    p = model.get_product(name)
    if p is None:
        return 0.0
    return float(p.new_wd)


def _product_vsu(project: "ProjectCore", name: str) -> float:
    """Value sales unit for a product after the latest share/metrics pass."""
    model = project._model
    if model is None:
        return 0.0
    p = model.get_product(name)
    if p is None or not p.included:
        return 0.0
    return float(p.value_sales_unit)


def _avg_lineup_wd(project: "ProjectCore", lineup: list[str]) -> float:
    if not lineup:
        return 0.0
    vals = [_product_wd(project, name) for name in lineup]
    return sum(vals) / len(vals)


def _group_products(project: "ProjectCore", group_type: str, member: str) -> list[str]:
    model = project._model
    if model is None:
        return []
    if group_type == "Company Products":
        return list(model.company_products)
    for g in model.doc.groups:
        if g.group_type == group_type and g.group_name == member:
            return list(g.product_names)
    return []


def _set_lineup(
    project: "ProjectCore",
    group_type: str,
    group_member: str,
    lineup: list[str],
) -> None:
    """Desktop setCurrentMarketWithLineUpProducts — only toggles products in the group scope."""
    model = project._model
    if model is None:
        return
    scope = set(_group_products(project, group_type, group_member))
    lineup_set = set(lineup)
    for p in model.products:
        if p.name in scope:
            p.included = p.name in lineup_set


def _group_value_share(project: "ProjectCore", group_type: str, member: str) -> float:
    model = project._model
    if model is None:
        return 0.0
    total = 0.0
    for name in _group_products(project, group_type, member):
        p = model.get_product(name)
        if p is not None and p.included:
            total += p.value_share
    return total


def _company_value_share(project: "ProjectCore") -> float:
    model = project._model
    if model is None:
        return 0.0
    total = 0.0
    for name in model.company_products:
        p = model.get_product(name)
        if p is not None and p.included:
            total += p.value_share
    return total


def _scenario_value(
    project: "ProjectCore",
    metric: Metric,
    group_type: str,
    group_member: str,
) -> float:
    """Desktop getScenarioValue — findPredictedShares then group/company metric."""
    project.find_predicted_shares()
    if group_type == "Company Products":
        if metric == "Revenue":
            return project.get_company_revenue()
        if metric == "Value Share":
            return _company_value_share(project)
        return project.get_company_share("NewShare")
    if metric == "Revenue":
        return _group_revenue(project, group_type, group_member)
    if metric == "Value Share":
        return _group_value_share(project, group_type, group_member)
    return project.get_group_share("NewShare", group_type, group_member)


def _group_revenue(project: "ProjectCore", group_type: str, member: str) -> float:
    model = project._model
    if model is None:
        return 0.0
    total = 0.0
    for name in _group_products(project, group_type, member):
        total += project.get_product_revenue(name)
    return total


def _probe_candidates(
    project: "ProjectCore",
    incremental_function: str,
    candidates: list[str],
    metric: Metric,
    group_type: str,
    group_member: str,
) -> dict[str, float]:
    """Desktop include/excludeProductsToCurrentLineUp — probe each candidate in isolation."""
    model = project._model
    if model is None:
        return {}
    out: dict[str, float] = {}
    for name in candidates:
        p = model.get_product(name)
        if p is None:
            continue
        prev = p.included
        p.included = incremental_function == "Intro"
        try:
            out[name] = _scenario_value(project, metric, group_type, group_member)
        except Exception:
            pass
        p.included = prev
    return out


def _rank_candidates_by_standalone(
    project: "ProjectCore",
    incremental_function: str,
    candidates: list[str],
    metric: Metric,
    group_type: str,
    group_member: str,
) -> list[str]:
    """Rank candidates by standalone metric (each probed alone against current lineup)."""
    probes = _probe_candidates(
        project,
        incremental_function,
        candidates,
        metric,
        group_type,
        group_member,
    )
    return sorted(candidates, key=lambda name: (-probes.get(name, float("-inf")), name))


def _pick_highest(
    values: dict[str, float],
    base_value: float,
) -> tuple[str, float] | None:
    if not values:
        return None
    best_name = ""
    best_delta = float("-inf")
    for name, val in values.items():
        delta = val - base_value
        if delta > best_delta:
            best_delta = delta
            best_name = name
    return best_name, best_delta


def _current_lineup(project: "ProjectCore", group_type: str, group_member: str) -> list[str]:
    model = project._model
    if model is None:
        return []
    out: list[str] = []
    for name in _group_products(project, group_type, group_member):
        p = model.get_product(name)
        if p and p.included:
            out.append(name)
    return out


def ex_incremental_gain_loss(
    project: "ProjectCore",
    incremental_function: str,
    group_type: str,
    group_member: str,
    incremental_products: list[str],
    *,
    current_lineup: list[str] | None = None,
) -> list[dict]:
    """Exclusive incremental intro or removal (desktop exIncrementalGainLoss)."""
    if incremental_function not in ("Intro", "Removal"):
        raise ValueError("incremental_function must be 'Intro' or 'Removal'")

    trial = clone_project(project)
    lineup = list(current_lineup) if current_lineup is not None else _current_lineup(
        trial, group_type, group_member
    )
    _set_lineup(trial, group_type, group_member, lineup)
    base_rev = _scenario_value(trial, "Revenue", group_type, group_member)
    base_share = _scenario_value(trial, "Market Share", group_type, group_member)

    rows: list[dict] = [
        {
            "productName": "Current",
            "revenue": round(base_rev, 4),
            "marketShare": round(base_share / 100.0, 6),
            "distribution": round(_avg_lineup_wd(trial, lineup), 2),
            "revenueDelta": 0.0,
            "marketShareDelta": 0.0,
            "mode": "exclusive",
        }
    ]

    # Probe each product independently against the same baseline lineup
    for prod_name in incremental_products:
        probe = clone_project(project)
        _set_lineup(probe, group_type, group_member, lineup)
        p = probe._model.get_product(prod_name) if probe._model else None  # type: ignore[union-attr]
        if p is None:
            continue
        p.included = incremental_function == "Intro"
        rev = _scenario_value(probe, "Revenue", group_type, group_member)
        share = _scenario_value(probe, "Market Share", group_type, group_member)
        rows.append(
            {
                "productName": prod_name,
                "revenue": round(rev, 4),
                "marketShare": round(share / 100.0, 6),
                "distribution": round(_product_wd(probe, prod_name), 2),
                "valueSales": round(_product_vsu(probe, prod_name), 4),
                "revenueDelta": round(rev - base_rev, 4),
                "marketShareDelta": round((share - base_share) / 100.0, 6),
                "mode": "exclusive",
            }
        )

    return rows


def _base_scenario_value_share(project: "ProjectCore", name: str) -> float:
    """Value share % for a SKU frozen from the loaded base scenario (no lineup re-simulation)."""
    model = project._model
    if model is not None:
        product = model.get_product(name)
        if product is not None:
            if product.included and product.value_share > 0:
                return float(product.value_share)
            if product.base_value_share > 0:
                return float(product.base_value_share)
    return project.get_product_value_share(name)


def _base_scenario_product_metrics(
    project: "ProjectCore",
    name: str,
) -> dict[str, float]:
    model = project._model
    product = model.get_product(name) if model else None
    value_share = _base_scenario_value_share(project, name)
    wd = float(product.new_wd) if product else 0.0
    if product and product.included:
        vsu = float(product.value_sales_unit)
    elif product:
        vsu = float(product.base_value_sales_unit)
    else:
        vsu = 0.0
    return {"value_share": value_share, "wd": wd, "vsu": vsu}


def _cum_sorted_base_value_share(
    project: "ProjectCore",
    group_type: str,
    group_member: str,
    incremental_products: list[str],
) -> list[dict]:
    """Sorted intro using only base-scenario value shares — no lineup re-simulation."""
    project.find_predicted_shares()

    metrics = {
        name: _base_scenario_product_metrics(project, name) for name in incremental_products
    }
    introduction_sequence = sorted(
        incremental_products,
        key=lambda name: (-metrics[name]["value_share"], name),
    )

    rows: list[dict] = [
        {
            "productName": "Current",
            "revenue": 0.0,
            "marketShare": 0.0,
            "valueShare": 0.0,
            "distribution": 0.0,
            "revenueDelta": 0.0,
            "marketShareDelta": 0.0,
            "incrementalDelta": 0.0,
            "mode": "cumulative",
            "incrementalType": "Value Share",
            "introOrder": "sorted",
        }
    ]

    cumulative_pct = 0.0
    for name in introduction_sequence:
        share_pct = metrics[name]["value_share"]
        cumulative_pct += share_pct
        rows.append(
            {
                "productName": name,
                "revenue": 0.0,
                "marketShare": 0.0,
                "valueShare": round(cumulative_pct / 100.0, 6),
                "distribution": round(metrics[name]["wd"], 2),
                "valueSales": round(metrics[name]["vsu"], 4),
                "revenueDelta": 0.0,
                "marketShareDelta": 0.0,
                "incrementalDelta": round(share_pct / 100.0, 6),
                "mode": "cumulative",
                "incrementalType": "Value Share",
                "introOrder": "sorted",
            }
        )

    return rows


def _marginal_delta(
    project: "ProjectCore",
    incremental_function: str,
    name: str,
    metric: Metric,
    group_type: str,
    group_member: str,
    base_value: float,
) -> float | None:
    probes = _probe_candidates(
        project,
        incremental_function,
        [name],
        metric,
        group_type,
        group_member,
    )
    probed = probes.get(name)
    if probed is None:
        return None
    return probed - base_value


def _append_skipped_cumulative_row(
    rows: list[dict],
    *,
    name: str,
    trial: "ProjectCore",
    incremental_type: Metric,
    intro_order: IntroOrder,
    base_rev: float,
    base_share: float,
    base_val_share: float,
    step_delta: float,
    message: str,
) -> None:
    rows.append(
        {
            "productName": name,
            "revenue": round(base_rev, 4),
            "marketShare": round(base_share / 100.0, 6),
            "valueShare": round(base_val_share / 100.0, 6),
            "distribution": round(_product_wd(trial, name), 2),
            "valueSales": 0.0,
            "revenueDelta": 0.0,
            "marketShareDelta": 0.0,
            "incrementalDelta": round(step_delta, 6 if incremental_type != "Revenue" else 4),
            "mode": "cumulative",
            "incrementalType": incremental_type,
            "introOrder": intro_order,
            "error": message,
        }
    )


def _append_cumulative_row(
    rows: list[dict],
    *,
    name: str,
    trial: "ProjectCore",
    lineup: list[str],
    incremental_type: Metric,
    incremental_function: str,
    step_delta: float,
    group_type: str,
    group_member: str,
    intro_order: IntroOrder,
    error: str | None = None,
) -> tuple[float, float, float]:
    """Commit lineup state, append one cumulative row, return (rev, share, val_share)."""
    _set_lineup(trial, group_type, group_member, lineup)
    rev = _scenario_value(trial, "Revenue", group_type, group_member)
    share = _scenario_value(trial, "Market Share", group_type, group_member)
    val_share = _scenario_value(trial, "Value Share", group_type, group_member)

    if incremental_type == "Market Share":
        rev_delta = 0.0
        share_delta = round(step_delta, 6)
        incr_delta = share_delta
    elif incremental_type == "Value Share":
        rev_delta = 0.0
        share_delta = 0.0
        incr_delta = round(step_delta, 6)
    else:
        rev_delta = round(step_delta, 4)
        share_delta = 0.0
        incr_delta = rev_delta

    row: dict = {
        "productName": name,
        "revenue": round(rev, 4),
        "marketShare": round(share / 100.0, 6),
        "valueShare": round(val_share / 100.0, 6),
        "distribution": round(_product_wd(trial, name), 2),
        "valueSales": round(_product_vsu(trial, name), 4),
        "revenueDelta": rev_delta,
        "marketShareDelta": share_delta,
        "incrementalDelta": incr_delta,
        "mode": "cumulative",
        "incrementalType": incremental_type,
        "introOrder": intro_order,
    }
    if error:
        row["error"] = error
    rows.append(row)
    return rev, share, val_share


def cum_incremental_gain_loss(
    project: "ProjectCore",
    incremental_function: str,
    group_type: str,
    group_member: str,
    incremental_products: list[str],
    *,
    incremental_type: Metric = "Revenue",
    current_lineup: list[str] | None = None,
    intro_order: IntroOrder = "sorted",
) -> list[dict]:
    """Cumulative waterfall (desktop cumIncrementalGainLoss).

    ``intro_order=sorted`` with ``incremental_type=Value Share`` (default for Assortment):
    rank by each SKU's value share in the loaded base scenario, then accumulate
    those fixed shares in order — no lineup re-simulation.

    ``intro_order=sorted`` with other metrics: rank by standalone simulated metric
    at the starting lineup, then introduce in that fixed order.

    ``intro_order=greedy``: pick the candidate with the highest metric delta at
    each step, then update the baseline lineup.
    """
    if incremental_function not in ("Intro", "Removal"):
        raise ValueError("incremental_function must be 'Intro' or 'Removal'")

    trial = clone_project(project)
    lineup = list(current_lineup) if current_lineup is not None else _current_lineup(
        trial, group_type, group_member
    )
    remaining = list(incremental_products)

    _set_lineup(trial, group_type, group_member, lineup)
    base_value = _scenario_value(trial, incremental_type, group_type, group_member)
    base_rev = _scenario_value(trial, "Revenue", group_type, group_member)
    base_share = _scenario_value(trial, "Market Share", group_type, group_member)
    base_val_share = _scenario_value(trial, "Value Share", group_type, group_member)

    rows: list[dict] = [
        {
            "productName": "Current",
            "revenue": round(base_rev, 4),
            "marketShare": round(base_share / 100.0, 6),
            "valueShare": round(base_val_share / 100.0, 6),
            "distribution": round(_avg_lineup_wd(trial, lineup), 2),
            "revenueDelta": 0.0,
            "marketShareDelta": 0.0,
            "incrementalDelta": 0.0,
            "mode": "cumulative",
            "incrementalType": incremental_type,
            "introOrder": intro_order,
        }
    ]

    use_sorted_base = (
        intro_order == "sorted"
        and incremental_function == "Intro"
        and incremental_type == "Value Share"
    )
    if use_sorted_base:
        return _cum_sorted_base_value_share(
            project,
            group_type,
            group_member,
            remaining,
        )

    use_sorted_intro = intro_order == "sorted" and incremental_function == "Intro"
    if use_sorted_intro:
        introduction_sequence = _rank_candidates_by_standalone(
            trial,
            incremental_function,
            remaining,
            incremental_type,
            group_type,
            group_member,
        )
        for name in introduction_sequence:
            if name not in remaining:
                continue

            raw_delta = _marginal_delta(
                trial,
                incremental_function,
                name,
                incremental_type,
                group_type,
                group_member,
                base_value,
            )
            if raw_delta is None:
                remaining = [n for n in remaining if n != name]
                continue

            if raw_delta < 0:
                if incremental_type == "Market Share":
                    step_delta = raw_delta / 100.0
                elif incremental_type == "Value Share":
                    step_delta = raw_delta / 100.0
                else:
                    step_delta = raw_delta
                _append_skipped_cumulative_row(
                    rows,
                    name=name,
                    trial=trial,
                    incremental_type=incremental_type,
                    intro_order=intro_order,
                    base_rev=base_rev,
                    base_share=base_share,
                    base_val_share=base_val_share,
                    step_delta=step_delta,
                    message="Negative marginal value share — not added to lineup",
                )
                remaining = [n for n in remaining if n != name]
                continue

            if name not in lineup:
                lineup.append(name)
            remaining = [n for n in remaining if n != name]

            prev_value = base_value
            rev, share, val_share = _append_cumulative_row(
                rows,
                name=name,
                trial=trial,
                lineup=lineup,
                incremental_type=incremental_type,
                incremental_function=incremental_function,
                step_delta=0.0,
                group_type=group_type,
                group_member=group_member,
                intro_order=intro_order,
            )
            if incremental_type == "Market Share":
                base_value = share
                rows[-1]["incrementalDelta"] = round((share - prev_value) / 100.0, 6)
                rows[-1]["marketShareDelta"] = rows[-1]["incrementalDelta"]
            elif incremental_type == "Value Share":
                base_value = val_share
                base_val_share = val_share
                rows[-1]["incrementalDelta"] = round((val_share - prev_value) / 100.0, 6)
            else:
                base_value = rev
                rows[-1]["incrementalDelta"] = round(rev - prev_value, 4)
                rows[-1]["revenueDelta"] = rows[-1]["incrementalDelta"]
            base_rev = rev
            base_share = share
        return rows

    while remaining:
        probes = _probe_candidates(
            trial,
            incremental_function,
            remaining,
            incremental_type,
            group_type,
            group_member,
        )
        picked = _pick_highest(probes, base_value)
        if picked is None:
            for name in remaining:
                rows.append(
                    {
                        "productName": name,
                        "revenue": 0.0,
                        "marketShare": 0.0,
                        "valueShare": 0.0,
                        "distribution": round(_product_wd(trial, name), 2),
                        "valueSales": 0.0,
                        "revenueDelta": 0.0,
                        "marketShareDelta": 0.0,
                        "incrementalDelta": 0.0,
                        "mode": "cumulative",
                        "incrementalType": incremental_type,
                        "error": "Reversal Effect Happened",
                    }
                )
            break

        name, delta = picked
        if incremental_function == "Intro" and delta < 0:
            for leftover in remaining:
                rows.append(
                    {
                        "productName": leftover,
                        "revenue": 0.0,
                        "marketShare": 0.0,
                        "valueShare": 0.0,
                        "distribution": round(_product_wd(trial, leftover), 2),
                        "valueSales": 0.0,
                        "revenueDelta": 0.0,
                        "marketShareDelta": 0.0,
                        "incrementalDelta": 0.0,
                        "mode": "cumulative",
                        "incrementalType": incremental_type,
                        "introOrder": intro_order,
                        "error": "Reversal Effect Happened",
                    }
                )
            break

        if incremental_function == "Intro":
            if name not in lineup:
                lineup.append(name)
        else:
            if name in lineup:
                lineup.remove(name)
        remaining = [n for n in remaining if n != name]

        if incremental_type == "Market Share":
            step_delta = delta / 100.0
        elif incremental_type == "Value Share":
            step_delta = delta / 100.0
        else:
            step_delta = delta

        rev, share, val_share = _append_cumulative_row(
            rows,
            name=name,
            trial=trial,
            lineup=lineup,
            incremental_type=incremental_type,
            incremental_function=incremental_function,
            step_delta=step_delta,
            group_type=group_type,
            group_member=group_member,
            intro_order=intro_order,
        )
        if incremental_type == "Market Share":
            base_value = share
        elif incremental_type == "Value Share":
            base_value = val_share
        else:
            base_value = rev
        base_rev = rev
        base_share = share

    return rows


def incremental_gain_loss(
    project: "ProjectCore",
    incremental_function: str,
    group_type: str,
    group_member: str,
    incremental_products: list[str],
    *,
    mode: Mode = "exclusive",
    incremental_type: Metric = "Revenue",
    current_lineup: list[str] | None = None,
    intro_order: IntroOrder = "sorted",
) -> list[dict]:
    if mode == "cumulative":
        return cum_incremental_gain_loss(
            project,
            incremental_function,
            group_type,
            group_member,
            incremental_products,
            incremental_type=incremental_type,
            current_lineup=current_lineup,
            intro_order=intro_order,
        )
    return ex_incremental_gain_loss(
        project,
        incremental_function,
        group_type,
        group_member,
        incremental_products,
        current_lineup=current_lineup,
    )
