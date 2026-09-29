# Price corridor preview — business logic check

For commercial / product review. Numbers below are **illustrative** (rounded), not a live study output.

**Question we answer:** if we only move the focus **reference SKU pack price**, how do CM and volume respond vs a competitor **anchor**, and which prices still clear our guardrails?

---

## Working example setup

| Role | Example |
|------|---------|
| Focus brand | Maleka |
| Reference SKU (the one we reprice) | Maleka 1 kg · today **€9.00** · cost **€5.85** |
| Other focus SKUs | Prices **unchanged** (e.g. Maleka 400 g stays at its current pack price) |
| Competitor brand (user pick) | Hawaa |
| Anchor SKU (auto) | Hawaa’s highest-share SKU → **Hawaa 400 g @ €4.50** |
| Guardrails | Min ref SKU CM **≥ 35%** · Max **brand** volume drop **≤ 10%** |
| Price window tested | Maleka 1 kg calibrated **€5.00 → €15.00**, **10** evenly spaced points |

Only **Maleka 1 kg** moves. The rest of Maleka stays at today’s prices; the market still rebalances.

---

## Index vs anchor

$$
I = \frac{p_{\mathrm{ref}}}{p_{\mathrm{anchor}}} \times 100
$$

| Ref pack price | Index vs Hawaa €4.50 | Reading |
|----------------|----------------------|---------|
| €4.50 | **100** | Pack-price parity |
| €9.00 | **200** | Twice the anchor pack price |
| €13.50 | **300** | 3× the anchor pack price |

Same euros, different competitor? Euro ticks stay €5…€15 for Maleka 1 kg; only the **index under the tick** changes.

---

## Volume drop

$$
\Delta V_{\mathrm{pct}} = \frac{V_{\mathrm{base}} - V_{\mathrm{new}}}{V_{\mathrm{base}}} \times 100
$$

| | Baseline volume | At €12.00 | Drop |
|--|-----------------|-----------|------|
| **Ref SKU** (Maleka 1 kg) | 8.0 | 5.6 | **+30%** lost |
| **Brand** (all Maleka) | 22.0 | 20.2 | **+8.2%** lost |

- Positive = lost volume; negative = gained (e.g. cutting price below today).
- Chart can show both; the **≤ 10%** guardrail uses the **brand** row (8.2% OK; 12% would fail).

---

## Ref SKU CM%

$$
\mathrm{CM}_{pct} = \frac{p - c}{p} \times 100
$$

Cost fixed at €5.85:

| Pack price | CM% |
|------------|-----|
| €9.00 | $(9.00 - 5.85) / 9.00$ → **35.0%** |
| €12.00 | $(12.00 - 5.85) / 12.00$ → **51.3%** |
| €8.00 | $(8.00 - 5.85) / 8.00$ → **26.9%** ← fails 35% floor |

This 35% floor is the **input guardrail**, still set on the pack-level margin of the reference SKU. It is no longer drawn as a line on the chart — it sets the **min price point** instead.

**“Unit” in the app** = one pack of that SKU (same basis as pack price). It is **not** €/kg or €/litre.

---

## What the chart no longer shows

Brand CM% and brand volume drop have been removed as **lines**. Brand CM% only ever rose with price, so it added no information and made "recommended" degenerate into "charge the most you're allowed." The **brand volume cap is still a live guardrail** — it just appears as a bound in the table rather than a curve, since it constrains the band without helping you read the optimum.

---

## The curve we actually plot: ref SKU contribution

$$
\mathrm{Contribution}_{\mathrm{ref}}(p) = v_{\mathrm{ref}}(p) \times (p - c)
$$

Every **percentage** curve is monotone in price and so can never show an optimum: CM% is $1 - c/p$, which only rises; volume drop only rises. Contribution in money is the one that turns over — cheap prices sell volume at almost no unit margin, expensive prices earn fat margin on collapsing volume — so the chart plots **ref SKU contribution** (indexed, today = 100) against **ref SKU volume drop**, with a dashed horizontal line at the **margin floor** (the CM% slider). The brand CM% and brand volume lines are gone.

The shape below is the textbook case. Real studies are bumpier, because share moves in steps between calibrated price levels — see the recommendation rule further down.

| Ref pack price | Volume | Unit margin | Contribution | Index (today = 100) |
|---|---|---|---|---|
| €8.00 | 9.8 | 2.15 | 21.1 | 84 |
| €9.00 (today) | 8.0 | 3.15 | 25.2 | 100 |
| €10.00 | 6.6 | 4.15 | 27.4 | 109 |
| €11.00 | 5.4 | 5.15 | **27.8** | **110** ← peak |
| €12.00 | 4.2 | 6.15 | 25.8 | 102 |
| €13.00 | 3.1 | 7.15 | 22.2 | 88 |

---

## Feasible band → min / recommended / max

The band edges are **solved exactly**, not picked from the 10 swept points. Each guardrail owns one edge, and contribution is not a constraint at all — it is what you read to choose a price *inside* the band.

**Min = the margin floor.** CM% is $1 - c/p$, which only rises with price, so the margin floor can only ever cut off the cheap end:

$$
p_{\min} = \frac{c}{1 - m}, \qquad m = 0.35 \;\Rightarrow\; p_{\min} = \frac{5.85}{0.65} = \textbf{€9.00}
$$

Rounded **up** to the cent so the quoted price genuinely clears 35%. If the study's calibrated price floor is higher, it wins and the bound reads **calibrated price floor**.

**Max = the brand volume cap.** Volume drop rises with price, so we bisect between $p_{\min}$ and the calibrated ceiling for the highest price still at ≤ 10% brand volume drop (say **€12.60**). If the cap never bites, max is the **calibrated price ceiling**.

> **Why the margin floor cannot set the max.** An earlier version converted the margin floor into a contribution *level* and used the far-side crossing as the max. It backfired: the floor price is a discount, and on an elastic SKU a discount earns *more* contribution than today, so the level it set was a bar almost nothing could clear. Loosening the margin slider then **shrank** the corridor and could push the whole band below today's price. One guardrail, one edge.

| € | Index | Ref CM% | Contribution idx | Brand vol drop | Role |
|---|-------|---------|------------------|----------------|------|
| 8.00 | 178 | 26.9 | 84 | −2% | Below band — margin floor breached |
| **9.00** | **200** | **35.0** | 100 | 1% | **Min** — margin floor |
| 11.00 | 244 | 46.8 | **110** | 6% | **Recommended** — best contribution |
| 12.00 | 267 | 51.3 | 102 | 8% | In band |
| **12.60** | **280** | 53.6 | 97 | **10.0%** | **Max** — volume cap |
| 14.00 | 311 | 58.2 | 71 | 13% | Above band |

**Recommended = the highest contribution found by scanning the band** at ~24 prices. We deliberately do *not* assume a single smooth hump: real share curves respond to price in steps, so contribution can be jagged with several local peaks. In the Savola pasta study, Hedeya 400 Gram peaks at €3.25, dips at €4.00, rises again to €4.50, dips at €4.75 and peaks again at €5.50. A peak-following search lands on whichever bump it started nearest; a scan finds the best one.

Because the edges are solved rather than sampled, a band can be valid even when **no** grid point passes both guardrails. Today's price is always inside the band unless today's own margin breaches the floor. We fall back to a least-bad recommendation and mark the band **infeasible** only when the margin-floor price itself breaches the volume cap or sits above the calibrated ceiling.

---

## Please confirm

1. Only the **reference SKU** is repriced (not a whole-brand % lift).
2. Index **100 = pack-price parity** with the competitor’s top-share SKU (not €/kg).
3. Volume cap = **brand**; margin floor = **ref SKU pack CM%** (margin on that pack: $(\text{pack price} - \text{pack cost}) / \text{pack price}$).
4. The chart plots **ref SKU contribution** (today = 100), not the rising margin curves; brand lines are gone.
5. Min = **margin floor**, max = **brand volume cap** (or the calibrated price edge). Contribution constrains nothing; recommended = its **best value inside the band**.
6. Changing anchor changes **indexes**, not the ref SKU’s € window.

**Not this preview:** full multi-SKU optimizer run; shocking every focus SKU; per-unit indexing; Run’s min/max corridor **ratio band** (preview recommends a **price point**).
