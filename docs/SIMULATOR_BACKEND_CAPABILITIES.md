# Simulator — Backend Capability Brief

**Audience:** Frontend engineer (human or AI) redesigning Simulator  
**Purpose:** Describe what the simulation engine can already do, so UI (and any new APIs) stay inside real backend logic.  
**Not a UI mockup.** Layout, chrome, and visual hierarchy are free — simulation physics are not.  
**Code sources of truth:** `backend/model/project_core.py`, `study_model.py`, `attribute_engine.py`, `share_engine.py`, `groups.py`, `backend/api/edits.py`, `routes/sessions.py`, `routes/scenarios.py`, `serializers.py`

---

## 1. How to use this document

Design any Simulator UX you want **as long as every user action maps to a capability below**.

| If the capability… | You may… |
|--------------------|----------|
| Exists in the engine **and** is already HTTP-exposed | Wire the UI to the existing endpoint |
| Exists in the engine **but** is awkward/missing in HTTP | Propose a **thin** append-only API that exposes it (request/response sketch + which `ProjectCore` method it wraps) |
| Does **not** exist in the engine | **Do not invent it.** Flag as product/backend research |

Do **not** invent new metrics, share formulas, or session semantics.

---

## 2. Mental model (one sentence)

A **session** holds a loaded study (`ProjectCore`). The user changes product attributes / inclusion / segment filters; the backend runs the preference → share → metrics pipeline; the UI reads a **results grid** (and optional group rollups, totals, scenarios).

```
Load study → edit state → run pipeline → read results
                 ↑______________|
```

Edits are **not** automatically live. Today the UI batches cell edits and commits them via **Recalculate**. The engine *can* apply a change and reload results immediately (`change_product_attribute` already calls `reload_results`); the product choice is whether the UI/API batches or not — not whether the math exists.

---

## 3. Session lifecycle

| Capability | Engine / API | Notes |
|------------|--------------|-------|
| Load study into session | `POST /api/sessions` `{ slug }` → full **session payload** | Needs `study.json` + `hbu.parquet` |
| Close session | `DELETE /api/sessions/{id}` | Optional cleanup |
| Session identity | `sessionId`, `slug`, `scenarioName` | Server-side registry; single-user local |

### Session payload (what the UI always gets back)

Returned by create, recalculate, reset, set segmentation, apply scenario:

- `study` — name, company, product/respondent counts, `financial`, `useGrouping`, active segment, filtered respondents  
- `segmentation` — dimensions, members by key, active filter(s)  
- `editableColumns` — which grid columns may be edited  
- `columns` / `results` — full results grid  
- `groups` / `groupTypes` — default group rollups + available types  
- `totals` — `total_n_share`, `total_revenue`, `total_value_share`

After recalculate only: `changesApplied`, optional `warnings[]`.

---

## 4. Core simulation loop

### 4.1 What the pipeline does

`ShareEngine` (on every results rebuild):

1. Apply active **segmentation** filter to respondents  
2. Compute **base** preference shares (base attributes / base inclusion)  
3. Compute **new** preference shares (new attributes / current inclusion)  
4. Calculate **new market shares** from preference + WD / inclusion rules  
5. Apply scenario metrics (indices, revenue, value share, penetration, etc.)  
6. If financial study: NOS, TDC, MM$

Same engine used by Compare and Optimizer trials. Runner does not get a different math path.

### 4.2 Recalculate (commit edits)

| | |
|--|--|
| **HTTP** | `POST /api/sessions/{id}/recalculate` `{ changes: GridChange[] }` |
| **Apply** | `apply_grid_changes` → `ProjectCore.change_product_attribute` / `include_exclude_product` |
| **Then** | `find_predicted_shares` / reload results → session payload |

`GridChange`: `{ product, column, value }`.

### 4.3 Reset to base

| | |
|--|--|
| **HTTP** | `POST /api/sessions/{id}/reset` |
| **Engine** | `reset_products()` — restore base attributes / inclusion; clears `scenarioName` |
| **Returns** | Full session payload |

---

## 5. What the user can change (edit surface)

`editableColumns` is authoritative per study. Typically:

| Column pattern | Meaning | Engine behavior |
|----------------|---------|-----------------|
| `Selected` | Include product in simulation | `include_exclude_product` |
| `New {Attr}` | Conditional attribute override (e.g. Price) | `AttributeEngine.change` |
| `New WD` | Weighted distribution % | `new_wd`; **WD = 0 → product excluded** |
| Discrete attr columns (study-defined) | Level index | Stored on product discrete levels |
| `NOS`, `TDC` | Financial inputs (only if `study.financial`) | Set on product; `MM$` is derived |

### Value formats the attribute engine already accepts

- Absolute number: `"12.5"`  
- Relative percent: `"5%"` → current value × (1 + 0.05)  
- Discrete / non-numeric: stored as provided when float parse fails  

### Validation / clamping already in API layer (`edits.py`)

| Rule | Behavior |
|------|----------|
| WD &lt; 0 | Clamp to 0 + warning |
| WD &gt; 100 | Clamp to 100 + warning |
| Price &lt; 0.01 | Clamp to 0.01 + warning |

Warnings are returned on the recalculate payload for toasts — design should surface them.

### Client-only operations (no new engine needed)

- **Bulk edit** — apply the same column/value (or `%`) to many products, then one recalculate  
- **Search / filter rows** — filter the grid client-side  
- **Pending-edit UX** — track dirty cells until recalculate  

These may stay frontend-only, or you may add a convenience bulk endpoint that is still just many `GridChange`s.

---

## 6. Results the UI can show

### 6.1 Per-product grid columns (from `ShareEngine.to_results_dataframe`)

Always present (names are API column strings):

| Column | Role |
|--------|------|
| Product Index, Product Name | Identity |
| Selected | Inclusion (editable) |
| B.Share | Base market share (read-only) |
| N.Share | New / scenario market share (read-only) |
| S.Index | Share index vs base (read-only) |
| Preference Share | Read-only |
| Value Share, VSU | Read-only |
| Revenue, R.Index | Read-only |
| Penetration, Audit Share | Read-only |
| Base WD, New WD | WD (New editable) |
| Base {Attr}, New {Attr} | Per conditional attribute |
| Discrete attrs | Per study (except SKU skipped) |

If `financial`:

| NOS, TDC | Editable inputs |
| MM$ | Derived: revenue − NOS − TDC (read-only) |

### 6.2 Totals

From results: sum of N.Share, Revenue, Value Share (see `serializers.totals`). Suitable for a KPI strip.

### 6.3 Color / comparison semantics (product rule, not API)

UI convention (see also `UX_UI_SPEC.md`): green/red vs **base** using relative thresholds on N.Share / indices — not absolute percentage-point deltas. Backend does not color cells; it only returns numbers.

---

## 7. Segmentation

| Capability | Detail |
|------------|--------|
| Dimensions | From study (`segmentation_dimensions` / assignment keys) |
| Members | `segment_members(assignment_key)` — real member lists |
| Apply | One or more filters → refilter respondents → rebuild results |
| Clear | Empty filters / reset segmentation |
| HTTP | `GET/POST /api/sessions/{id}/segmentation` |
| Payload | `dimensions`, `membersByKey`, `active`, `activeFilters` |

**Effects:** changes filtered respondent count and all share metrics. Design must keep active segment visible in shell/context.

Engine supports multi-filter apply via `filters[]`; UI may expose single or multi depending on study needs.

---

## 8. Groups

| Capability | Engine | HTTP today |
|------------|--------|------------|
| List group types | `project.group_types` | In session payload |
| Roll up metrics by type | `group_summary(group_type)` / `group_metric_rows` | `GET .../groups?group_type=` and default `groups` in session |
| Member product names | `GroupDef.product_names` in study document | **Not cleanly exposed** in group API rows today |

### Group rollup metrics available in engine

For each group of a type: Name, GroupType, N.Share, B.Share, Audit Share, Preference Share, Penetration, Value Share, Revenue (included products where relevant).

### Design freedom with thin API

UI may design: flat vs grouped grid, groups drawer, “jump to members”, bulk edit by group — **membership already exists in the study model**. A thin API can add `productNames: string[]` (or similar) to group rows without new math.

Do not invent group metrics not in `group_metric_rows` / results columns.

---

## 9. Scenarios

Scenarios are **snapshots** of overrides + inclusion + segmentation (not a separate simulation engine).

| Capability | Where |
|------------|--------|
| Capture current state | `ProjectCore.capture_scenario(name, description, validation)` |
| Save | `POST /api/studies/{slug}/scenarios` `{ session_id, name, description, validation }` |
| List | `GET /api/studies/{slug}/scenarios` |
| Apply into session | `POST /api/sessions/{id}/apply-scenario` `{ name }` — reset, apply overrides, set `scenarioName` |
| Delete / reorder / import | Scenario routes (manager-oriented; Runner may deep-link) |
| Compare | Separate Compare page (`POST .../compare`) — out of Runner primary chrome |

Validation flag on saved scenarios is **deprecated** (legacy **V** only); `validation: true` on save is rejected. Held-out validation uses **validation waves** on Data Hub — see [`VALIDATION.md`](VALIDATION.md).

---

## 10. Export

| | |
|--|--|
| **HTTP** | `GET /api/sessions/{id}/export?format=csv\|xlsx` |
| **CSV** | Current results dataframe |
| **XLSX** | Results (+ optional first group-type summary sheet) |

No other export formats in engine today.

---

## 11. Engine capabilities present but not Runner-primary

Safe to mention; **do not pull into Runner redesign unless needed**:

| Capability | Location | Note |
|------------|----------|------|
| Company product list / company share & revenue | `ProjectCore` | Useful for KPIs; mostly optimizer/analytics |
| Rebase new shares to a total | `rebase_product_new_share` | Chart/validation path — not standard Runner recalc |
| Analytics (SOM/SOP, etc.) | analytics routes / model | Separate page |
| Brand price optimizer | optimizer routes | Separate wizard; same share pipeline underneath |

---

## 12. Explicit non-capabilities (do not invent)

- New share / revenue formulas or columns not produced by `ShareEngine` / `metrics`  
- Server-side undo/redo stack  
- Multi-user collaborative editing  
- Realtime streaming of partial simulation steps  
- Changing study design / HBU from Runner (that is Wizard)  
- Treating Optimizer or Chart Analysis as part of Runner unless product asks  

---

## 13. Current HTTP map (Runner-relevant)

```
POST   /api/sessions
DELETE /api/sessions/{id}
POST   /api/sessions/{id}/recalculate
POST   /api/sessions/{id}/reset
GET    /api/sessions/{id}/segmentation
POST   /api/sessions/{id}/segmentation
GET    /api/sessions/{id}/groups?group_type=
POST   /api/sessions/{id}/apply-scenario
GET    /api/sessions/{id}/export?format=csv|xlsx

GET    /api/studies/{slug}/scenarios
POST   /api/studies/{slug}/scenarios
DELETE /api/studies/{slug}/scenarios/{name}
…      (reorder / import — Simulator)
```

---

## 14. Recommended additions

Prioritized gaps for Simulator redesign. Prefer Tier 1 before inventing UI workarounds. Each Tier 1–2 item must wrap existing engine/study data — no new share math.

### Tier 1 — Expose what already exists (do first)

| # | Capability | Why | Where it already lives | Suggested exposure |
|---|------------|-----|------------------------|--------------------|
| 1 | **Group membership** | Grouped grid and “edit this brand” currently string-match product names | `GroupDef.product_names` in study document; used inside `group_metric_rows` | Add `productNames: string[]` (or similar) to each row from `GET .../groups` and session `groups` |
| 2 | **Calibrated attribute bounds** | Runner only clamps WD 0–100 and Price ≥ 0.01; UX wants real inline validation (REQ-VAL-01) | Optimizer path: `get_calibrated_bounds` / conditional grids on the study | Per-product (or per-attr) `{ lo, hi }` on session load or a small `GET .../bounds` — reuse calibration, do not invent ranges |
| 3 | **Richer group rollups** | Spec expects S.Index, R.Index, MM$ on group headers; current rollups are partial | Derive from member products’ metrics / financial fields already computed | Extend `group_metric_rows` + serializer; same group_type query |
| 4 | **Delta / vs-base helpers** *(optional)* | UI can compute `(N−B)/B` and index thresholds client-side | Results already have B/N share and indices | Only add if you want one server source of truth; otherwise keep client-side |

**Redesign order:** group members → attribute bounds → richer group metrics — then stop unless Tier 2 is needed.

### Tier 2 — Small new behavior (optional, doable)

| # | Capability | Why | Implementation note |
|---|------------|-----|---------------------|
| 5 | **Validate-before-recalc** | Surface clamps/bounds before committing a run | Dry-run same rules as `edits.py` (+ bounds from #2); return structured warnings/field errors without mutating, *or* return them on recalc as today but richer |
| 6 | **Bulk edit by group** | “+5% Price for Brand A” without fragile name filters | Resolve `productNames` for group (#1), expand to `GridChange[]`, same recalculate path |
| 7 | **Scenario diff summary** | On save/apply, show what changed (override count, exclusions, segment) | Diff `capture_scenario` / applied overrides vs base; metadata only |
| 8 | **Export options** | Choose group type sheet, include/exclude groups, selected rows only | Thin query params on existing export; data already in session |

Any Tier 1–2 proposal from an implementer should include: name, `ProjectCore`/model method wrapped, request/response sketch, and why the current session payload is insufficient.

### Tier 3 — Do not add unless product explicitly asks

- Live recalculate on every keystroke (perf/UX choice; engine can reload per change, not a missing feature)
- Server-side undo/redo history
- Persisting column layout / pin state on the server (keep in client Settings)
- New metrics or columns not produced by `ShareEngine` / `metrics`
- In-Runner elasticity or chart analysis (Analytics page)
- Rebase-to-audit / `rebase_product_new_share` as a primary Runner action (niche validation path)
- Multi-user collaborative sessions or streaming partial sim steps

---

## 15. Minimal journeys (capability checks, not UI scripts)

1. **Load → edit price → recalculate → see N.Share / Revenue move**  
2. **Toggle Selected / set WD=0 → product drops out of sim**  
3. **Apply segment → filtered respondents + shares update**  
4. **Save scenario → reset → apply scenario → state restored**  
5. **Switch group type → read rollups; (if exposed) navigate to member SKUs**  
6. **Export CSV/XLSX of current results**  

If a redesign cannot complete these with the capabilities above, the design is wrong — not the engine.

---

## 16. Related docs

| Doc | Role |
|-----|------|
| [`SIMULATOR_UI_SPEC.md`](SIMULATOR_UI_SPEC.md) | **UI redesign spec** derived from this brief |
| `UX_UI_SPEC.md` §7.3 | Aspirational Runner UI (not binding for redesign visuals) |
| `MATHEMATICAL_MODEL.md` | Share / preference math depth |
| `frontend/src/pages/RunnerPage.tsx` | Current as-built UI |
| `backend/api/serializers.py` | JSON shapes |
| `backend/model/optimizer.py` | `get_calibrated_bounds` (reuse for Tier 1 #2) |
| `backend/model/groups.py` | Group rollups to extend for Tier 1 #3 |

---

**Bottom line for the implementer:** You own presentation. The backend owns what-if physics. Stay inside this capability list; implement Tier 1 thin APIs when the redesign needs them; treat Tier 2 as optional; do not invent Tier 3.
