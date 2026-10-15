# Price Optimizer — Search Algorithm

Status: implemented
Applies to: Price Optimization page (`POST /api/{slug}/optimizer/run`)
Solver: `optimize_coordinate_ascent` in `backend/model/optimizer.py`. The evaluation
core (`FastEvaluator`, `preference_engine`, `share_calculator`, `metrics`) is
unchanged.

---

## 1. Summary

The optimizer chooses a price for each decision SKU to maximise a commercial
objective, subject to commercial guardrails.

The recommended method is **menu-based coordinate ascent with multi-start**:

1. Precompute, for each SKU, the finite list of prices it is *allowed* to take.
2. Optimise one SKU at a time by scanning its entire list.
3. Cycle over SKUs until no single change improves the objective.
4. Repeat from several starting points and keep the best result.

The central design decision is step 1. Once every per-SKU constraint is folded
into the candidate list, the inner loop has no constraint handling left except a
single aggregate feasibility check, and no infeasible evaluations are wasted.

Note: the Price Optimization page does **not** use the Pack Price Architecture
ladder. That assumption is what makes the problem fully separable. See §8.

---

## 2. Problem statement

**Decision variables.** One pack price `p_i` per decision SKU `i = 1..n`.
Typical `n` is 3 to 10.

**Objective.** Maximise one of `revenue`, `value_share`, `volume_share`, or
`margin`, aggregated over the scope SKUs (normally the whole focus brand).

**Evaluation.** There is no closed-form demand curve. Each candidate price
vector is scored by running the conjoint simulator: price is interpolated into
per-respondent utilities, an MNL produces preference shares, then weighted
distribution and size adjustments produce volume shares, then metrics produce
revenue and value share. One evaluation costs roughly 1–3 ms via
`FastEvaluator`, or 30–100 ms through the full pipeline.

**Constraints.**

| Constraint | Depends on | Type |
|---|---|---|
| Price box `[lo, hi]` from calibrated study levels | one SKU | separable |
| Movement cap `±m%` from base price | one SKU | separable |
| Margin floor `(p − c)/p ≥ μ` | one SKU | separable |
| Shelf endings (`.00`, `.49`, `.95`, `.99`) | one SKU | separable, discrete |
| Corridor vs competitive anchor | one SKU | separable |
| Brand volume-share loss floor | all SKUs jointly | aggregate, requires evaluation |

The corridor is separable because the anchor is a **fixed competitor price
snapshot**, not a decision variable. It therefore reduces to a lower and upper
bound on the reference SKU alone.

Five of the six constraints depend on a single SKU. Only the share-loss floor
couples the decision variables, and it is a single scalar test.

---

## 3. Step 1 — Build the price menu

For each decision SKU, compute a feasible interval and then enumerate the
sellable prices inside it.

```
lo_i = max(
    bounds.lo,                                # calibrated study range
    base_i * (1 - max_price_movement_pct),    # movement cap, downward
    cost_i / (1 - min_margin_pct),            # margin floor, rearranged
    corridor_min * anchor_price               # reference SKU only
)

hi_i = min(
    bounds.hi,
    base_i * (1 + max_price_movement_pct),
    corridor_max * anchor_price               # reference SKU only
)
```

For a unit-basis corridor, substitute
`corridor_min * (anchor_price / anchor_size) * reference_size`, and likewise for
the maximum.

Then:

```
M_i = { p : p in [lo_i, hi_i], p has an allowed shelf ending }
```

Rules:

- **Empty interval** (`lo_i > hi_i`): the SKU is infeasible. Report which two
  bounds collided, by name and value, in `constraint_conflicts`. See §7.
- **Empty menu** but non-empty interval: the interval is narrower than the
  ending grid. Fall back to the interval endpoints rounded inward.
- **Oversized menu**: cap at `max_menu` entries (default 12–15), evenly spaced,
  always retaining `lo_i`, `hi_i`, and the entry nearest `base_i`.

The menu is built once per run. After this point the five separable constraints
are structurally impossible to violate, so the inner loop never checks them.

### Consequences

- **No wasted evaluations.** Today `_eval` returns `-inf` for prices rejected by
  these constraints, and `infeasible_trials` counts the waste. That waste goes
  to zero.
- **No cliffs in the search space.** The corridor currently punches a `-inf`
  discontinuity into the reference SKU's line search, which is why
  `_has_coupled_price_constraints` exists and forces a slower dense-grid path.
  With the corridor in the menu, there is no discontinuity and no need for the
  branch.
- **Shelf prices are correct by construction.** `apply_shelf_snap` currently
  runs *after* the search and reverts when snapping breaks feasibility, which is
  why the result payload carries both `raw_prices` and `prices`. Baking endings
  into the menu removes the post-processing step and the duality: the price that
  was optimised is the price that ships.
- **The grid indices are known**, so the search can use
  `FastEvaluator.evaluate(level_indices)` — the precomputed price-utility table
  path — rather than `evaluate_at_prices`, which recomputes utilities for every
  product on every call.

---

## 4. Steps 2–4 — The search

```
menus     = build_menus(spec)                  # §3
baseline  = evaluate(current_true_prices)      # for honest uplift reporting
floor     = baseline.brand_volume_share - max_share_loss_pp

def feasible(x):                               # the only in-loop check
    return evaluate(x).brand_volume_share >= floor

best_overall = None

for start in starts:                           # §4.2
    x = snap_to_menu(start)
    v = score(x)

    for pass in 1..max_passes:                 # default 6
        improved = False
        for i in sku_order:                    # §4.1
            for p in menus[i]:
                trial = x with x[i] = p
                t = score(trial)
                if feasible(trial) and t > v + tol:
                    v, x[i], improved = t, p, True
        if not improved:
            break

    if best_overall is None or v > best_overall.value:
        best_overall = (v, x)

return best_overall
```

### 4.1 SKU ordering

Process SKUs in descending order of base volume share. The largest SKUs move the
objective most, so settling them first reduces the number of passes needed.

### 4.2 Starting points

| Label | Definition |
|---|---|
| `current` | Current prices, snapped to the nearest menu entry |
| `min` | `lo_i` for every SKU |
| `max` | `hi_i` for every SKU |
| `midpoint` | Menu entry nearest the interval centre |
| `random` | Uniform draw from each menu, seeded for reproducibility |

Every start is feasible with respect to the five separable constraints by
construction — the menu guarantees it. A start can still fail the aggregate
share floor; when it does, run the ascent anyway and discard the start if no
feasible point is reached.

The `max` start matters more than it looks. For revenue and margin objectives
the optimum is usually *above* current price, and a single seed near current
prices systematically under-explores the upper half of the box.

### 4.3 Evaluation cache

Memoise on the tuple of menu indices. Coordinate ascent re-tests the incumbent
price on every pass, and multi-start runs frequently converge to overlapping
regions, so a plain dictionary cache typically removes 20–30% of calls.

### 4.4 Termination

The objective strictly increases at every accepted move, and the feasible set
`M_1 × … × M_n` is finite. The algorithm therefore cannot cycle and terminates.
In practice it converges in 3–4 passes.

### 4.5 Cost

Evaluations ≈ `starts × passes × n × |M|`.

| Configuration | Evaluations | At 2 ms | At 0.5 ms (table path) |
|---|---|---|---|
| 5 SKUs, 12 prices, 4 passes, 5 starts | 1,200 | 2.4 s | 0.6 s |
| 10 SKUs, 12 prices, 4 passes, 5 starts | 2,400 | 4.8 s | 1.2 s |
| 10 SKUs, 20 prices, 6 passes, 5 starts | 6,000 | 12 s | 3 s |

Cost is **linear** in SKU count, not exponential. Doubling the SKUs doubles the
runtime.

At these speeds the search is faster than the surrounding I/O:
`_prepare_optimizer_project` loads the study from disk, and
`_build_result_payload` loads it a second time and runs two full pandas
pipelines. That fixed overhead of roughly 1–4 s now dominates. Two implications:
cache the prepared project on the job record to remove the duplicate load, and
consider returning the default run synchronously instead of via job polling.

---

## 5. Why this is good enough

The algorithm does not prove global optimality. This section sets out what it
does guarantee and why the remaining gap does not matter in practice.

### 5.1 What is guaranteed

**Exactness in every single dimension.** Because each step enumerates a SKU's
*entire* menu rather than performing a line search, the result cannot be trapped
by a local bump within one dimension.

**Coordinatewise optimality at convergence.** No change to any single SKU's
price improves the objective. Every one-SKU deviation has been tested and
rejected.

**Monotone, finite convergence.** As shown in §4.4.

The only way to beat the result is to move **two or more SKUs simultaneously**,
along a ridge where neither move helps alone but both together do.

### 5.2 Why such ridges are rare in this model

Demand is MNL. For shares `s_i` and utilities `u_j`:

```
∂s_i/∂u_i =  s_i (1 − s_i)        own effect
∂s_i/∂u_j = −s_i s_j              cross effect
```

The ratio of cross effect to own effect is `s_j / (1 − s_i)`. For SKUs with
10% share that is about 0.11 — cross-SKU interaction is roughly an order of
magnitude weaker than own-price response.

The objective is therefore dominated by separable own-price terms with a
comparatively weak coupling term; in Hessian terms it is strongly diagonally
dominant. Coordinate ascent is well behaved precisely under diagonal dominance.
Ridges requiring simultaneous moves need coupling comparable to own-response,
which would mean two SKUs holding very large shares of the same choice set.

Where interaction *is* strong — SKUs in the same size ladder of the same brand —
the effect is predominantly **pairwise**, which is exactly what the optional
polish in §9 addresses.

Multi-start covers the residual risk of separated basins.

### 5.3 Why exhaustive search is not worth it

**It does not scale.** With 12 menu prices per SKU:

| SKUs | Combinations | At 2 ms |
|---|---|---|
| 4 | 20,736 | 41 s |
| 5 | 248,832 | 8 min |
| 6 | 2,985,984 | 100 min |
| 8 | 430 million | 10 days |
| 10 | 62 billion | 4 years |

Full enumeration is usable to about four SKUs. Reducing the menu barely helps,
because the exponent dominates the base: going from 12 prices to 7 cuts the work
by 35×, while ten SKUs need a reduction of roughly a million. Faster evaluation
does not rescue it either — a 10× speedup buys exactly one more SKU.

**It is exact about the wrong thing.** Exhaustive search over a menu is exact
*on the menu only*. It eliminates search error but leaves discretisation error
untouched, and with a 12-price menu the discretisation error is almost certainly
the larger of the two. You would pay an astronomical cost to remove the smaller
error.

**It is false precision given model uncertainty.** The utilities driving the
simulator come from conjoint estimation on a finite respondent sample. Predicted
shares carry confidence intervals on the order of ±1–2 percentage points.
Spending hours to close a search gap of a fraction of a percent, inside a model
with that much inherent uncertainty, buys no decision-relevant accuracy. The
recommendation would not change.

**The claim is testable rather than assumed.** See §6.

### 5.4 Why not a coarse-to-fine discrete search

A coarse pass followed by refinement around the top candidates is a reasonable
generic strategy, but it adds machinery for little gain here. Coordinate ascent
already achieves fine resolution cheaply — resolution costs linearly, not
exponentially, so a 30-price menu at 10 SKUs is still only 6,000 evaluations.
Coarse-to-fine also reintroduces a failure mode this design removes: the true
optimum can fall outside every coarse candidate's refinement neighbourhood.

---

## 6. Validation plan

The reasoning in §5 should be confirmed empirically, not taken on faith.

1. Pick a real study and restrict it to 4 decision SKUs.
2. Run true exhaustive search over the menus (about 21,000 evaluations, under a
   minute). This is the reference answer.
3. Run menu-based coordinate ascent with multi-start on the same problem.
4. Record the objective gap and whether the recommended prices differ.
5. Repeat across several studies, objectives, and guardrail settings.

Acceptance: a mean gap under 0.1% of the objective with identical recommended
prices in the large majority of cases. If met, exhaustive search can be
permanently ruled out for this page. If not, the pairwise polish in §9 becomes
the first remedy and should be re-measured against the same reference.

`backend/tests/test_fast_evaluator.py` already establishes the pattern of
validating a fast path against an authoritative slow path; this fits alongside
it as a search-quality parity test.

---

## 7. Infeasibility reporting

With all separable constraints reduced to interval arithmetic, infeasibility is
detected before any evaluation, and the cause is known exactly. Emit the
colliding pair by name and value into `constraint_conflicts`:

> **Heineken 33cl** — no feasible price. The 34% margin floor requires at least
> €1.52, but the ±10% movement cap allows at most €1.45. Lower the margin floor
> to 31% or widen the movement cap to ±17%.

This replaces the current generic "No feasible prices found under commercial
constraints", is available instantly, and tells the user which slider to move.

---

## 8. Assumption: no PPA ladder on this page

The Price Optimization page does not apply the Pack Price Architecture ladder,
which is the only constraint that would tie SKUs together structurally. That is
what makes the problem separable and this algorithm appropriate.

`enforce_ppa_ladder` should remain in `RunOptimizerRequest`, defaulting to
`false`, for other consumers. When it is set, the correct approach is **block
coordinate ascent**: treat each size chain as one block and enumerate it jointly
with depth-first search, pruning as soon as the price or €/unit ordering breaks
— ordering constraints eliminate roughly 95% of a 4-SKU chain's combinations, so
an exact block solve costs about a thousand evaluations. Blocks then cycle
exactly as SKUs do above. This is a strict generalisation: with no ladder, every
block has size one and it reduces to the algorithm in §4.

---

## 9. Optional: pairwise (2-opt) polish

Deferred. Add only if §6 shows a measurable gap.

Coordinate ascent's sole blind spot is joint moves, and the strongest
interactions between a brand's own SKUs are pairwise. A polish pass closes most
of that gap directly.

**Method.** After coordinate ascent converges, take each pair of SKUs `(i, j)`
and re-optimise them jointly over `M_i × M_j` while all other prices stay fixed.
Accept any improvement and repeat until a full sweep of pairs yields none.

**Cost.** `C(n,2) × |M|²` per sweep. At 10 SKUs and 12 prices: 45 pairs × 144 =
6,480 evaluations, roughly 13 s at 2 ms or 3 s on the table path.

**Reduce it** by only testing pairs likely to interact: same brand and adjacent
pack size, or pairs whose cross-brand switching share exceeds a threshold. The
data for this already exists in `model/analytics/cross_brand.py`. Restricting to
plausible pairs typically cuts the cost by 3–5×.

**Guarantee.** Convergence to a point where no single-SKU *and* no two-SKU move
improves the objective — pairwise optimality, strictly stronger than §5.1.

**Exposure.** A `thorough` flag on the run request, off by default, surfaced in
the UI as a slower, more exhaustive option with the estimated runtime shown
before the user commits.

---

## 10. Why other solver classes were considered and rejected

### 10.0 Grid search and differential evolution

**Grid search** (exhaustive enumeration over a fixed price grid) was considered and rejected for multi-SKU runs because the combinatorial cost is exponential in SKU count — see §5.3 for the exact numbers. It remains academically correct for 1–2 SKUs but adds implementation complexity for a case that is already handled efficiently by coordinate ascent with a dense menu.

**Differential evolution** was considered as a global stochastic search to complement coordinate ascent. It was rejected because: (a) it requires continuous or penalty-handled constraints and performs poorly with discrete shelf endings; (b) for the problem sizes here (3–10 SKUs, millisecond evaluations) the population-times-generations evaluation count is comparable to or exceeds coordinate ascent with multi-start; and (c) it provides the same class of probabilistic-global guarantee already covered by multi-start.

Neither is implemented. If systematic CA failures are observed on real studies, the pairwise polish in §9 is the first remedy; grid search for `n ≤ 2` regression tests is the next.

### 10.1 Why SLSQP, IPOPT, and trust-constr are not suitable

These are gradient-based constrained nonlinear programming solvers. They are
excellent for smooth problems with analytic derivatives, and this problem has
neither.

### 10.2 The objective is not differentiable

Price enters utility by **linear interpolation between calibrated conditional
price levels** (`_conditional_price_utility_vec` in
`backend/model/fast_evaluator.py`). The objective is therefore piecewise linear
in each price, with a kink at every calibrated level.

At a kink the gradient does not exist, and a finite-difference approximation
straddling one returns a slope belonging to neither adjacent segment. SLSQP's
line search relies on predicted descent from that gradient; when the prediction
is wrong it shrinks the step, re-evaluates, and stalls. Calibrated levels are
spaced closely enough within a typical price box that kinks are encountered
constantly rather than rarely.

### 10.3 There are no analytic gradients, and numerical ones are expensive

No derivative of the simulator with respect to price is available, so every
gradient costs `n + 1` full evaluations. With 10 SKUs that is 11 evaluations per
gradient, and SLSQP typically needs 50–200 iterations plus line-search
evaluations — several thousand evaluations in total. That is *more* than the
2,400 the proposed algorithm needs, with worse robustness. Constraint Jacobians
add more still.

### 10.4 Part of the decision space is genuinely discrete

Shelf endings are not a smooth restriction; they are a finite set. Continuous
solvers cannot represent them. The only workaround is to solve continuously and
round afterwards, which sacrifices optimality (the rounded point is no longer a
solution to anything) and can break feasibility (rounding up can violate the
movement cap; rounding down can violate the margin floor). That is precisely the
fragile post-processing this design eliminates.

### 10.5 The constraints are not in the required form

These solvers need constraints as smooth functions `g(x) ≥ 0` with derivatives.
The current implementation enforces feasibility by **rejection** — `_eval`
returns `-inf` via `_constraints_ok` — and `-inf` carries no gradient
information.

The box, movement, margin, and corridor constraints could be rewritten smoothly
with effort. The share-loss floor could not, usefully: evaluating it requires a
full simulator run, and its Jacobian would require `n` more per iteration.

Under the proposed design this is moot. Those five constraints stop being
constraints at all, which is a cleaner outcome than making them differentiable.

### 10.6 The guarantee on offer is no better

SLSQP, IPOPT, and trust-constr are **local** solvers. Without convexity — which
this problem does not have — they return a local stationary point. That is the
same class of guarantee as coordinate ascent, reached by a more fragile route,
and it would still need multi-start. Coordinate ascent additionally enumerates
each dimension exhaustively, so it cannot be trapped *within* a dimension the
way a gradient method can.

### 10.7 The problem is the wrong size to benefit

Gradient methods earn their complexity when the dimension is in the hundreds or
thousands and derivatives are cheap. Here `n` is 3 to 10 and each evaluation is
milliseconds. Direct enumeration of a small discrete space is both simpler and
faster.

### 10.8 Summary

| Requirement | This problem |
|---|---|
| Smooth objective | No — piecewise linear, kinked at every calibrated level |
| Analytic gradients | No — `n+1` simulator runs per gradient |
| Continuous variables | No — shelf endings are discrete |
| Smooth constraints `g(x) ≥ 0` | No — enforced by rejection with `-inf` |
| Convexity for a global guarantee | No |
| High dimension to justify the machinery | No — 3 to 10 variables |

Gradient-based NLP is the right tool for a different problem.

---

## 11. Implementation notes

**Reuse unchanged.** `FastEvaluator`, `preference_engine`, `share_calculator`,
`metrics`, the job/polling API, and the result payload builders.

**Preserve.** Compute `baseline_value` at the **true current prices**, not at
the nearest menu entry, so reported uplift stays honest. The result already
separates `baseline_value` from `objective_value`.

**Fix while here.**

- `min_margin_pct` is a fraction in `RunOptimizerRequest` (0.34) but percent
  points in `CorridorPreviewRequest` (34), while the UI sliders are in percent
  points. Unify on percent points before wiring the page, or the margin floor
  will silently be applied as 0.34%.
- If `_try_create_fast_evaluator` returns `None` (no Price attribute), each
  evaluation is 20–50× slower. Detect this and either reduce the menu and start
  count or refuse the run with a clear message.

**Diagnostics to return.** Per-start objective and winning start; the spread
across starts (if consistently near zero, the default start count can be
reduced); passes to convergence; total evaluations and cache hits; menu size per
SKU; and any SKU whose optimum sits at a menu endpoint, since that indicates a
binding guardrail worth surfacing in the UI.