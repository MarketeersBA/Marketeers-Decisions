# Validation waves (Data Hub)

Held-out checks that the calibrated model still matches observed shares when you apply **validation-period** shelf inputs (prices, WD, attributes) from the market.

Upload and manage waves only on **Data Hub & Trust** while a study is loaded. Initial study ingest (design + HBU) is unchanged.

## Quick note

**Data Hub predicted company share is after rebase; Runner scenario compare volume share is not.** The same price change (e.g. one SKU to 25) can show **~44.9%** in Runner and **~43.7%** on Data Hub — both can be correct. Validation follows legacy Chart Analysis: predict → rebase simulated volume to the **audit total from the workbook** → compare. Runner applies the scenario and reports raw **N.Share** without rebase and without workbook audit overlays.

---

## Workbook format (one file = one wave)

Two sheets only:

### Description

Key/value rows (column A = label, column B = value):

| Label | Required |
|-------|----------|
| Validation Name | Yes (unique per study) |
| Validation Date | Yes (chart x-axis) |
| Notes | No |

Example:

| Field | Value |
|-------|-------|
| Validation Name | April 2026 holdout |
| Validation Date | 2026-04-01 |

Do not use row 1 as the only data row without a header row named `Field` / `Value` unless labels are in column A and values in column B on **data** rows (see importer: first row may become Excel column headers).

### Product List

Same column conventions as the study **design** Product List:

- **SKU name** — must match the study exactly.
- **`Base {Attribute}`** — validation-period values (e.g. `Base Price`).
- **`WD`** — optional; else study default.
- **Benchmark:** `Audit Share` if present, else **Market Share** (`audit = audit ?? market`).

Policies:

- SKUs in the file but **not in the study** → upload fails (row errors).
- SKUs in the study **missing from the file** → keep study base inputs and study audit for that SKU.
- Duplicate **Validation Name** → HTTP 409; delete or rename the existing wave.

Include/exclusion is **not** driven from the validation file (unlike design ingest’s market-share rules). Inclusion stays from the study unless you add explicit support later.

---

## Storage

```
studies/{client}/{slug}/validation/
  index.json
  {wave_id}.json
```

Each wave stores meta (name, date, notes, source filename) and per-SKU inputs + benchmark share. **study.json** and HBU are not modified on upload.

---

## Scoring pipeline (backend)

For each wave:

1. Clone study → `apply_validation_wave` (inputs + **per-SKU audit** from the wave).
2. `find_predicted_shares()`.
3. `rebase_product_new_share(get_total_products_audit_share())` — legacy parity with desktop Validation chart.
4. Chart points:
   - **Predicted** — sum of company SKUs’ **NewShare** (volume %, after rebase).
   - **Actual** — sum of company SKUs’ **AuditShare** from the wave.

Aggregate fit metrics (context bar, optimizer confidence): **mean abs Δ (pp)**, **WMAPE**, **max Δ** over included SKUs with audit &gt; 0 (see `validation_scenario_score` / wave series helpers).

API:

| Method | Path |
|--------|------|
| POST | `/api/studies/{slug}/validation/upload` |
| GET | `/api/studies/{slug}/validation` |
| GET | `/api/studies/{slug}/validation/series` |
| DELETE | `/api/studies/{slug}/validation/{id}` |

---

## vs Runner / saved scenarios

| | Validation wave (Data Hub) | Saved scenario (Runner) |
|---|---------------------------|-------------------------|
| **Create** | Upload Excel | Save scenario (validation flag **deprecated**) |
| **Inputs** | Product List row | Session overrides in JSON |
| **Audit benchmark** | From workbook | Study base audit only |
| **Rebase** | Yes | No |
| **Chart / trust** | Data Hub time series | Compare uses **N.Share** (no rebase) |

Legacy scenarios with **V** still load and appear in Chart Analysis validation tab; new validation should use waves only.

---

## Code references

- Import: `backend/data/validation_importer.py`
- Store: `backend/data/validation_store.py`
- Apply wave: `ProjectCore.apply_validation_wave`
- Series / legacy scenario score: `backend/model/analytics/validation.py`
- UI: `frontend/src/components/ModelValidationPanel.tsx`

Legacy desktop flow (decompiled): `ChartForm.validationDoneButton_Click` — bind scenario → predict → rebase → Audit vs Rebased Simulator Share.
