# Price Optimizer — Backend Capability Brief

**Audience:** Frontend engineer (human or AI) wiring or redesigning the Optimizer  
**Purpose:** Describe what the constrained price optimizer can already do, so UI (and any new APIs) stay inside real backend logic.  
**Not a UI mockup.** Layout, chrome, and visual hierarchy are free — optimization physics and commercial constraints are not.  
**Code sources of truth:** `backend/model/optimizer.py`, `backend/model/fast_evaluator.py`, `backend/api/routes/optimizer.py`, `backend/api/schemas.py` (`RunOptimizerRequest`), tests under `backend/tests/test_optimizer_*.py`

---

## 1. Applicability verdict

**Constrained optimization is the correct formulation for this product — and the backend already implements it.**

Commercial pricing is never unbounded revenue maximization. Pack architecture, competitive corridors, margin floors, movement caps, and share-loss limits define a feasible set the solver must respect. Softening those into post-hoc filters would misrepresent how commercial teams price.

| Question | Answer |
|----------|--------|
| Applicable to this project? | **Yes** |
| Already on backend? | **Yes** (production-complete for price-only constrained runs) |
| Decision variables | Continuous pack **prices** for selected brand SKUs |
| Demand model | Black-box HBU/MNL simulator (not a closed-form elasticity curve) |
| Solver class to keep | Bound tightening + hard rejection + coordinate ascent — **not** LP/MILP |

---

## 2. How to use this document

Design any Optimizer UX you want **as long as every user action maps to a capability below**.

| If the capability… | You may… |
|--------------------|----------|
| Exists in the engine **and** is already HTTP-exposed | Wire the UI to the existing endpoint |
| Exists in the engine **but** is awkward/missing in HTTP | Propose a **thin** append-only API that exposes it |
| Does **not** exist in the engine | **Do not invent it.** Flag as product/backend research |

Do **not** invent new objectives, constraint types, or result metrics without an engine path.

---

## 3. Mental model (one sentence)

Choose pack prices for selected brand SKUs to maximize one commercial objective over a scope, **subject to hard commercial guardrails**, by repeatedly evaluating the preference → share → metrics pipeline.

```
Setup (brand, bounds, constraints)
  → preflight_constraints
  → solver (coordinate ascent)
      → each trial: price rules → simulate → share floor → objective
  → shelf snap + diagnostics
  → job payload (SKU deltas, brand totals, cannibalization)
```

---

## 4. Problem framing

### Optimize

| Piece | Detail |
|-------|--------|
| **Decision variables** | Continuous pack prices (`PriceBound`: `sku`, `base_price`, `lo`, `hi`, `cost`) |
| **Objectives** | `revenue` \| `value_share` \| `volume_share` \| `margin` |
| **Scope** | Aggregate over `scope_skus`: whole **brand** or only **selected** decision SKUs |
| **Black box** | Change Price → MNL preference shares → WD/size-adjusted shares → revenue/value metrics |

| Objective | Aggregation |
|-----------|-------------|
| `revenue` | Σ SKU revenue |
| `value_share` | Σ value share |
| `volume_share` | Σ volume share |
| `margin` | Σ revenue × (p − c) / p |

### Subject to (hard constraints)

Each infeasible trial scores **−∞** (rejected). Shelf endings are applied **post-opt** if still feasible.

| Constraint | Mechanism |
|------------|-----------|
| Price box | Search within calibrated `[lo, hi]` per SKU |
| Competitive corridor | `reference / anchor` (pack or unit) ∈ `[corridor_min, corridor_max]` |
| PPA ladder | Size-sorted: absolute price ↑ with size; €/unit ↓; optional min/max unit-saving band |
| Margin floor | `(p − cost) / p ≥ min_margin_pct` (also raises `lo` via bound tightening) |
| Movement cap | Price within ±`max_price_movement_pct` of base |
| Volume share loss | Optional: scope vol share ≥ baseline − `max_share_loss_pp` |
| Shelf snap | Round to endings (e.g. `.00` / `.49` / `.95` / `.99`) if still feasible |
| Empty region | `preflight_constraints` / `ConstraintSetupError` when setup empties the box |

---

## 5. Why constrained (not unconstrained)

| Business need | Constraint mechanism | Status |
|---------------|----------------------|--------|
| Stay on calibrated / list price grid | `PriceBound` `[lo, hi]` from conditional levels | Shipped |
| Defend vs competitor index | Corridor: reference/anchor ∈ `[min, max]` | Shipped |
| Keep pack architecture coherent | PPA: abs ↑ with size; €/unit ↓; saving band | Shipped |
| Protect contribution margin | `min_margin_pct` → floor price + reject | Shipped |
| Governance / retailer negotiation | `max_price_movement_pct` vs base | Shipped |
| Don't buy revenue with share collapse | `max_share_loss_pp` on scope volume share | Shipped |
| Shelf price psychology | `shelf_snap` to configured endings | Shipped |
| Detect empty feasible set early | `preflight_constraints` + `ConstraintSetupError` | Shipped |

---

## 6. Backend architecture

### Layers

| Layer | Path | Role |
|-------|------|------|
| Core | `backend/model/optimizer.py` | `OptSpec`, constraints, coordinate ascent, diagnostics |
| Fast path | `backend/model/fast_evaluator.py` | Vectorized MNL inner-loop evals |
| API | `backend/api/routes/optimizer.py` | REST + async `JobRecord` |
| Contract | `backend/api/schemas.py` | `SkuBoundInput`, `RunOptimizerRequest`, save-scenario |

### Evaluation loop (per trial)

| Step | Responsibility |
|------|----------------|
| 1. Price-only rules | `_constraints_ok` — corridor, PPA, margin, movement |
| 2. Simulate | `FastEvaluator` or preference → share → metrics |
| 3. Share floor | `_is_feasible` — optional `max_share_loss_pp` |
| 4. Objective | `_compute_obj` over `scope_skus` |
| 5. Finalize | `apply_shelf_snap`; `binding_constraints`; `limited_by` |

### Design choice to keep

Do **not** replace the black-box loop with a parametric LP/MILP. The objective is non-smooth and simulation-defined. Bound tightening (`apply_guardrail_bounds`), preflight emptiness checks, and hard rejection remain the right backend plan for price-only commercial constraints. Volume-linked constraints follow the same pattern as `max_share_loss_pp` (evaluate after sim).

---

## 7. HTTP capability surface

**Prefix:** `/api/{slug}/optimizer`

| Method | Path | Capability |
|--------|------|------------|
| `GET` | `/context` | Group types, brand→SKU maps, segments, scenarios |
| `GET` | `/brand-summary` | Brand KPIs + SKU list at current prices |
| `GET` | `/bounds` | Calibrated `[lo, hi]` per SKU (+ cost default `0.0`) |
| `POST` | `/run` | Start async constrained optimize job |
| `GET` | `/jobs/{job_id}` | Progress + full result payload |
| `POST` | `/jobs/{job_id}/cancel` | Cancel running job |
| `POST` | `/jobs/{job_id}/save-scenario` | Persist optimal prices as scenario |
| `POST` | `/jobs/{job_id}/export` | CSV of SKU-level results |

---

## 8. Run contract (`RunOptimizerRequest`)

### Required / core

| Field | Notes |
|-------|-------|
| `group_type`, `brand` | Brand/group scope for the run |
| `bounds[]` | Per SKU: `sku`, `base_price`, `lo`, `hi`, `cost`, `included` |
| `objective` | `revenue` \| `value_share` \| `volume_share` \| `margin` |
| `scope` | Brand vs selected decision SKUs |
| `max_iters`, `tol_str` | Search controls (coordinate ascent passes and convergence tolerance) |
| `filters` / `assignment_key`+`member` | Optional segment filters |
| `base_scenario` | Optional starting prices (else study base) |

### Constraint knobs

| Field | Role |
|-------|------|
| `reference_sku`, `anchor_label`, `anchor_price`, `anchor_size` | Competitive anchor |
| `corridor_basis`, `corridor_min`, `corridor_max` | Pack or unit corridor |
| `enforce_ppa_ladder`, `ppa_min_saving`, `ppa_max_saving` | Pack-price architecture |
| `min_margin_pct` | Margin floor |
| `max_price_movement_pct` | Movement cap vs base |
| `max_share_loss_pp` | Volume-share loss floor |
| `shelf_snap`, `shelf_endings`, `shelf_step` | Post-opt shelf endings |

---

## 9. Solver

The solver is **menu-based block coordinate ascent** (`optimize_coordinate_ascent`). See [`docs/optimization algorithm .md`](optimization algorithm .md) for the full algorithm description, guarantees, and rationale for why grid search, differential evolution, and gradient-based NLP are not used.

---

## 10. Result diagnostics (explainability)

| Category | Fields |
|----------|--------|
| Status & feasibility | `solution_status` (`optimal_found` \| `feasible` \| `infeasible` \| `error`), `constraint_conflicts`, `infeasible_trials`, `base_prices_violate_constraints` |
| Attribution | `binding_constraints`, `limited_by` (per SKU), `corridor_ratio`, `ppa_ladder_rows` |
| Prices | `prices`, `raw_prices` (pre-snap), `uplift_pct` |
| Commercial payload | SKU deltas, brand totals, cannibalization (brand vs competitors), market rows |

---

## 11. Explicit non-goals (current backend)

| Not optimized today | Why / note |
|---------------------|------------|
| Promotions / trade spend | Not decision variables; would need promo–price link |
| Assortment / WD / awareness | Fixed inputs to the share pipeline |
| Multi-brand joint portfolio | Scope is one group/brand per run |
| Plant capacity / supply | Needs volume mapping + capacity inputs |
| Closed-form elasticity solver | Elasticity lives in analytics (`elasticity.py`), not the optimizer loop |

---

## 12. Recommended backend roadmap

Capability is **production-ready** for constrained price optimization. Further backend work should deepen the same pattern, not reinvent the solver class.

| Priority | Capability | Notes |
|----------|------------|-------|
| **P0** | Keep API + `OptSpec` as source of truth | Re-wire frontend to existing routes; no schema fork |
| **P1** | Per-SKU min volume / keep-alive floors | Same post-sim feasibility pattern as share loss |
| **P1** | Richer cost / trade-term margin | Cost today often `0` from `/bounds` — harden data contract |
| **P2** | Capacity / volume ceiling | Map share → absolute volume; reject over capacity |
| **P2** | Multi-brand / portfolio run | Extend scope + coupled PPA across brands carefully |
| **P3** | Soft constraints / lexicographic goals | Penalty or primary+secondary objectives if soft trade-offs needed |

---

## 13. Key symbols (quick index)

| Symbol | File | Role |
|--------|------|------|
| `PriceBound`, `OptSpec`, `OptResult` | `optimizer.py` | Spec / result |
| `ConstraintSetupError` | `optimizer.py` | Empty / invalid setup |
| `preflight_constraints`, `validate_constraint_setup` | `optimizer.py` | Setup checks + PPA seed repair |
| `optimize_coordinate_ascent` | `optimizer.py` | Solver |
| `apply_guardrail_bounds`, `apply_shelf_snap` | `optimizer.py` | Bound tighten + shelf |
| `FastEvaluator` | `fast_evaluator.py` | Fast evals |
| `RunOptimizerRequest` | `schemas.py` | HTTP body |
| `_run_job`, `_build_result_payload` | `routes/optimizer.py` | Job orchestration |
