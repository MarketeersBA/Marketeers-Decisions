# Market Simulator — Pure Python

React + FastAPI web app for the Marketeers Market Simulator. No `.mdb`, no Access Engine, no .NET DLL.

## Features

- **Study Wizard** — Create studies from design Excel + HBU Excel
- **Simulator** — Edit attributes, recalculate shares, save/load JSON scenarios; includes an integrated Compare Scenarios section with side-by-side metrics (volume, value, revenue, preference, penetration, **audit share**) and charts
- **Brand Price Optimizer** — Optimal SKU prices for a brand (revenue, share, or margin). See [`OPTIMIZER_GUIDE.md`](OPTIMIZER_GUIDE.md)
- **Chart Analysis** — Elasticity, price index, brand interaction, SoM vs SoP, fair share, validation, intro/removal. See [`CHART_ANALYSIS.md`](CHART_ANALYSIS.md)
- **Validation waves** — Upload held-out Product List + audit on **Data Hub & Trust**. See [`VALIDATION.md`](VALIDATION.md)
- **Scenario Library** — Reorder, import from Excel, delete scenarios
- **Settings** — Decimal places, share color threshold, metric visibility (browser-local)
- **Excel export** — Formatted results (header style, frozen header, ± share colors, Groups sheet)

## Layout

```
market_simulator/
├── backend/          # FastAPI + simulation engine
│   ├── api/
│   ├── model/
│   ├── data/
│   ├── utils/
│   ├── tests/
│   ├── scripts/
│   ├── studies/      # On-disk study data (gitignored)
│   ├── config.py
│   └── requirements.txt
├── frontend/         # React SPA (Vite + TypeScript)
└── *.md              # Docs
```

## Study storage

Each study is a folder under `backend/studies/`:

```
backend/studies/
  index.json
  My_Study_Name/
    study.json      # metadata, products, attributes, segments
    hbu.parquet     # respondent utility matrix
    scenarios/
      index.json
      scenario_name.json
```

## Setup

Requires **Python 3.12 or newer** (`requires-python` in `backend/pyproject.toml`; `backend/.python-version` pins 3.12).

```powershell
cd market_simulator
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
cd frontend
npm install
```

## Run (development)

Two processes:

```powershell
# Terminal 1 — API (from backend/, venv active)
cd backend
uvicorn api.main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open http://localhost:5173

## Run (production, single process)

```powershell
cd frontend
npm run build
cd ..\backend
uvicorn api.main:app --port 8000
```

The API serves the SPA from `backend/api/spa_dist` after `scripts/build_spa.ps1`. `npm run build` alone writes `frontend/dist`, which the API does not mount.

For FastAPI Cloud (GitHub Actions or terminal), see [`DEPLOY.md`](DEPLOY.md).

## Create a study

1. Open **Study Wizard**
2. Upload **design** Excel (Description, Attributes, Product List, …)
3. Upload **HBU** Excel (respondent utilities; column layout must match products/attributes)
4. Review and **Create Study**

## Excel template sheets (design file)

| Sheet | Purpose |
|-------|---------|
| Description | Study name, company, MSU, sales unit |
| Attributes | Attribute definitions |
| Product List | SKUs, base shares, WD |
| Segments Shares & WD | Segment weights |
| Segments / Segmentation | Respondent segments |
| `{Name} Attribute Levels` | Conditional attribute levels per product |

HBU file: first sheet, columns `RespondentID`, `RespondentWeight`, `ProductID1..N`, attribute level columns.

## Smoke test

```powershell
cd backend
python -m scripts.smoke_study
python -m scripts.smoke_study --slug demo_study
```

Creates a minimal demo study if none exists, loads it, runs a price change, checks shares sum ~100%.

## Architecture

| Module | Role |
|--------|------|
| `backend/api/` | FastAPI REST service wrapping the engine |
| `frontend/` | React SPA (Vite + TypeScript) |
| `backend/data/excel_importer.py` | Parse design + HBU Excel |
| `backend/data/study_writer.py` | Write study folder |
| `backend/data/study_loader.py` | Load study.json + hbu.parquet |
| `backend/model/share_engine.py` | Full simulation pipeline (ports findPredictedShares) |
| `backend/model/preference_engine.py` | Per-respondent MNL preference shares |
| `backend/model/share_calculator.py` | WD/size adjustment + zero-sum rebasing |
| `backend/model/attribute_utilities.py` | HBU utilities + conditional interpolation |
| `backend/model/attribute_engine.py` | Attribute changes |
| `backend/model/project_core.py` | UI-facing simulation API |
| `backend/model/analytics/` | Chart Analysis ports (elasticity, fair share, validation, …) |
| `backend/model/optimizer.py` | Brand SKU price optimization (coordinate ascent, grid, scipy) |
| `backend/utils/excel_export.py` | Formatted Excel export (REQ-EXP-01) |

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) — multi-segment AND and golden `.exe` parity tests remain open until fixtures / UI land.
