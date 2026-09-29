# Market Simulator — Frontend (React SPA)

React + FastAPI UI for the Market Simulator (see `../ROADMAP.md`).

## What is implemented

- App shell: top bar, sidebar nav, study-context card
- **Home / Study Manager** — list studies, edit metadata, delete, set default
- **Study Wizard** — design + HBU upload, review, create
- **Simulator** — editable grid, recalculate, reset, segmentation, groups, scenarios, bulk edit, export, and an integrated Compare Scenarios section (pivot table, charts, Excel export)
- **Scenario Library** — reorder, import from Excel, delete

## Run (dev)

Two processes:

```powershell
# 1) API (from backend/, venv active)
cd ..\backend
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000

# 2) Frontend (this folder)
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the API on `:8000` (override with
`VITE_API_PORT` in `.env` if the API runs on another port, e.g. `8001`).

## Build (prod, single process)

```powershell
npm run build          # outputs frontend/dist
cd ..\backend
uvicorn api.main:app --port 8000
```

When `frontend/dist` exists, the API serves the SPA at `/`.
