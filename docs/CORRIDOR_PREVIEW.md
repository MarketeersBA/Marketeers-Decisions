# Corridor Preview — Math & Capabilities

> **Business / commercial review:** see [`CORRIDOR_PREVIEW_LOGIC.md`](./CORRIDOR_PREVIEW_LOGIC.md) for a non-code explanation of the math and rules to confirm we are doing the right thing.

Before-run chart on **Price Optimization**: sweep the focus **reference SKU** price against a competitive **anchor**, plot contribution margin and volume response, and derive a feasible min / recommended / max price band under the UI guardrails.

**Endpoint:** `POST /api/{slug}/optimizer/corridor-preview`  
**Core:** `backend/model/corridor_preview.py`  
**UI:** `frontend/src/pages/OptimizerPage.tsx` (Price corridor + Corridor bounds)

---

## 1. What is being swept?

| Item | Level | Source |
|------|--------|--------|
| Price mover | **Focus reference SKU only** | ★ Reference on Focus brand panel |
| X-axis index | Ref price ÷ anchor price × 100 | Selected competitor row |
| Anchor brand | User selects in Anchor table | Switching-share ranked competitors |
| Anchor SKU (price) | **Heuristic** — not user-picked | Highest volume-share SKU in that competitor brand |
| Other focus SKUs | Prices **held fixed** | Current scenario / base |

At index $I$:

$$
p_{\mathrm{ref}}(I) = p_{\mathrm{anchor}} \times \frac{I}{100}
$$

Default grid: **10 evenly spaced** points across the reference SKU’s **calibrated
Price lo/hi**. Optional `index_step` switches to a fixed step grid; optional
`index_min` / `index_max` force an explicit window. Prices are always clamped to
the calibrated bounds.

**Pack price only** (not € per unit size). `100` = pack-price parity with the
anchor SKU. The solver’s `corridor_basis: "unit"` is **not** used here.

**€ axis vs anchor:** for a fixed reference SKU, the **euro** tick marks are the
calibrated lo→hi window (evenly spaced). Changing the competitor **anchor** does
**not** move those € labels — it changes the **index** under each price
($I = p_{\mathrm{ref}} / p_{\mathrm{anchor}} \times 100$). The chart shows
`€x.xx` with `(index)` under each tick.

---

## 2. Metrics at each index

After setting the reference SKU to $p_{\mathrm{ref}}(I)$ and re-running the preference → share → metrics pipeline:

### 2.1 Volumes

Shares use simulator `NewShare` (same units as the rest of the app, typically 0–100).

$$
\Delta V_{\mathrm{pct}} = \frac{V_{\mathrm{base}} - V_{\mathrm{new}}}{V_{\mathrm{base}}} \times 100
$$

| Series | $V$ definition |
|--------|------------------|
| **Ref SKU volume drop %** | `NewShare` of the reference SKU |
| **Brand volume drop %** | Sum of `NewShare` over all SKUs in the focus brand |

Positive ⇒ volume lost vs baseline; negative ⇒ volume gained (cheaper than today).

**Both are computed on every point** and returned in the payload. The chart plots both; the **max volume drop guardrail** uses **brand** volume drop (line-level commercial story).

### 2.2 Contribution margin — SKU

Unit CM for SKU $i$ with price $p_i$ and unit cost $c_i$:

$$
\mathrm{CM}_{i,pct} = \frac{p_i - c_i}{p_i} \times 100
$$

Costs: `studies/<slug>/unit_costs.csv` override if present, else mock ratio of base price (`data/unit_costs.py`).

### 2.3 Contribution margin — brand

Revenue $R_i$ from the results grid when available; else proxy $R_i = p_i \times V_i$.

$$
\mathrm{Contribution}_i = R_i \times \frac{p_i - c_i}{p_i}
$$

$$
\mathrm{Brand\ CM}_{pct} = \frac{\sum_{i \in \mathrm{focus}} \mathrm{Contribution}_i}{\sum_{i \in \mathrm{focus}} R_i} \times 100
$$

$$
\mathrm{Brand\ contribution} = \sum_{i \in \mathrm{focus}} \mathrm{Contribution}_i
$$

Only the reference SKU’s price changes; other focus SKUs keep prices, but **all volumes rebalance**, so brand CM% is not identical to ref SKU CM%.

**Chart left axis:** Brand CM%.  
**Guardrail line:** Min CM slider — applied as a floor on **ref SKU unit CM%** (see feasibility).

### 2.4 Costs note

`/bounds` now also returns resolved unit costs (same resolver). If costs are missing / mocked as a fixed fraction of **base** price, ref SKU unit CM% still rises with price $(1 - c/p)$; brand CM% mixes that with fixed-price siblings.

---

## 3. Feasibility & bounds

Guardrails from the Optimizer UI (percent points, e.g. 34 and 10):

| UI control | Preview field | Applied to |
|------------|---------------|------------|
| Min contribution margin | `min_margin_pct` | **Ref SKU** unit CM% ≥ floor |
| Max volume drop | `max_volume_drop_pct` | **Brand** volume drop % ≤ cap |

A point is **feasible** when both hold (missing CM ⇒ not CM-ok).

| Bound | Rule |
|-------|------|
| **Min** | Feasible point with smallest index |
| **Max** | Feasible point with largest index |
| **Recommended** | Feasible point with **max Brand CM%**; tie-break higher brand contribution €, then lower index |
| **Binding label** | Heuristic label on the top of the band (`max volume drop` / `min contribution margin` / `infeasible`) |

If no point is feasible, preview still returns a least-bad “recommended” and `binding_label: "infeasible"`.

---

## 4. What this is *not*

- Not a full multi-SKU optimizer (`POST /run`).
- Not shocking **all** focus-brand SKUs together (only the reference SKU).
- Not elasticity analytics (though related to a one-SKU price probe).
- Not per-unit-size indexing (`corridor_basis: "unit"`).
- Not the competitive corridor **ratio band** sent on Run (`corridor_min` / `corridor_max`). Preview recommends a **price point**; Run can still constrain a **ratio window** vs the same anchor.
- Brand CM% on the chart is **not** the same object as the solver’s per-SKU `min_margin_pct` constraint (solver uses unit margin on each decision SKU).

---

## 5. UI behavior (Optimizer page)

| Behavior | Detail |
|----------|--------|
| Layout | Chart **above** bounds table (full width, stacked) |
| X ticks | `€price` with `(index)` underneath |
| Tooltip | Compact; values to **1 decimal** + `%`; short series names |
| Anchor change | Previous chart/bounds **kept** and **dimmed** (`keepPreviousData`) with “Updating…” until the new preview returns, then lines redraw |
| First load | Shows “Computing corridor preview…” only when there is no prior data |

---

## 6. API sketch

```http
POST /api/{slug}/optimizer/corridor-preview
```

```json
{
  "group_type": "Brand",
  "brand": "Super Bock",
  "reference_sku": "Super Bock Original 33cl can",
  "anchor_price": 1.32,
  "anchor_label": "Sagres",
  "anchor_sku": "Sagres 33cl",
  "n_points": 10,
  "min_margin_pct": 34,
  "max_volume_drop_pct": 10,
  "filters": null,
  "base_scenario": null
}
```

Omit `index_min` / `index_max` / `index_step` to auto-span the reference SKU’s calibrated Price lo/hi with `n_points` samples (default 10).
Optional `index_step` uses a fixed step instead; evaluated prices are always clamped to calibrated bounds.

Response highlights: `points[]` (both volume drops + brand/ref CM + contribution), `bounds.{min,max,recommended}`, `baseline`, `calibrated_price_lo` / `calibrated_price_hi`, `n_points`, `definitions`.

---

## 7. Options implemented vs replaceable

### Implemented now

| Capability | Choice locked in v1 |
|------------|---------------------|
| Shock scope | Reference SKU only |
| Price basis | **Pack** price (not per-unit) |
| Volume metrics | **Both** ref SKU and focus brand |
| Volume guardrail | Brand volume drop |
| CM chart series | Brand CM% (revenue-weighted) |
| CM guardrail | Ref SKU unit CM% |
| Recommended | Max brand CM% in feasible band |
| Anchor SKU | Highest `n_share` in selected competitor brand |
| Cost | CSV override or mock ratio of base price |
| Index grid | Auto: **10 points** across ref SKU calibrated Price lo/hi; optional `index_step` or explicit min/max |
| € axis on anchor change | Unchanged for same ref SKU (indexes under ticks update) |
| Refresh UX | Keep previous chart dimmed while refetching |

### Easy replacements / extensions

| Option | Alternative | Why you might switch |
|--------|-------------|----------------------|
| Shock scope | Whole focus brand +Δ% on all SKUs | Matches “brand raises price” copy literally |
| Price basis | Per-unit (`corridor_basis: "unit"`) using Size | Cross-pack competitive parity |
| € axis | Sweep ±% of **anchor** price (not ref calibrated lo/hi) | Axis moves when competitor changes |
| Volume guardrail | Ref SKU drop instead of brand | Tighter SKU-level commercial rule |
| Chart CM | Brand total contribution € (or index vs baseline) | Recovers the old **hump** mock look more closely |
| Chart CM | Ref SKU unit CM% only | Aligns axis with the guardrail object |
| Recommended | Max brand contribution € in-band | Profit-dollars optimum under guards |
| Recommended | Closest feasible to today’s ref price | Minimal disruption |
| Anchor SKU | User picks SKU after brand; or closest size/pack to focus ref | Better competitive like-for-like |
| Anchor SKU | Highest switching at **SKU** level (not brand) | Finer diversion targeting |
| Cost | Require real `unit_costs.csv` (no mock) | Trustworthy CM when financials matter |
| Engine | `FastEvaluator` vectorized sweep | Speed on large HBUs |
| Corridor → Run | Map recommended index → `corridor_min`/`corridor_max` band around it | Connect preview to solver constraint |
| Dual guard on CM | Also require brand CM% ≥ floor | Stricter brand P&L story |

### Related existing capabilities

| Capability | Where | Relation |
|------------|--------|----------|
| Switching share table | Analytics `cross-brand` + normalize gains | Chooses competitor **brand** |
| `/bounds` | Optimizer | Calibrated lo/hi + resolved cost |
| `min_margin_pct` on Run | `OptSpec` | Same unit-margin idea; Run uses **fraction** (0.34), preview UI uses **percent** (34) |
| `max_share_loss_pp` on Run | Scope volume-share loss in pp | Different from preview’s **% drop vs baseline volume** — do not conflate |
| Competitive corridor on Run | `reference_sku` / `anchor_price` / min–max **ratios** | Hard ratio band; preview is a response curve |

---

## 8. Suggested follow-ups

1. Optional **anchor SKU** dropdown once a competitor brand is selected.  
2. Toggle chart primary volume series (brand vs SKU) without a new request.  
3. Map recommended price → default `corridor_min` / `corridor_max` for After Run.  
4. Debounce preview when guardrail sliders move.  
5. Golden test with fixed HBU + costs for CM numeric parity.  
6. Per-unit corridor preview when Size is available on both SKUs.

---

## 9. File map

| Path | Role |
|------|------|
| `backend/model/corridor_preview.py` | Sweep math + bounds |
| `backend/api/routes/optimizer.py` | `POST /corridor-preview`; `/bounds` costs |
| `backend/api/schemas.py` | `CorridorPreviewRequest` |
| `backend/tests/test_corridor_preview.py` | Smoke test on Demo_Study |
| `frontend/src/api/optimizer_types.ts` | Request/response types |
| `frontend/src/api/hooks.ts` | `useCorridorPreview` (`keepPreviousData`) |
| `frontend/src/pages/OptimizerPage.tsx` | Chart + bounds table |
| `frontend/src/pages/optimizer.css` | Stacked layout, dim-while-refresh |
