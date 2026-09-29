# Deployment

Market Simulator is a monorepo: FastAPI in `backend/`, React (Vite) in `frontend/`.

**Live API / combined app:** https://marketsimulator.fastapicloud.dev/

| Piece | Role |
|---|---|
| Application Directory (FastAPI Cloud) | `backend` |
| SPA bundle path | `backend/api/spa_dist` (built, not committed) |
| Entrypoint | `api.main:app` in `backend/pyproject.toml` |

`api/spa_dist` is gitignored. It must exist **before** upload (local script or CI). `.fastapicloudignore` un-ignores it so FastAPI Cloud includes it.

---

## A. Deploy with GitHub Actions (recommended)

Pushes to `main` build the SPA, then deploy the full monorepo to FastAPI Cloud.

### One-time setup

1. **Disconnect** FastAPI Cloud’s native “deploy on every commit” (if enabled):
   - [FastAPI Cloud dashboard](https://fastapicloud.com/) → your app → **Settings** → **Source Repository** → **Disconnect**
   - Otherwise GitHub pushes deploy without building the SPA → JSON fallback at `/`.

2. Confirm **Application Directory** is `backend`:
   - App → **Settings** → **Application Directory** → `backend`

3. Create CI secrets (pick one):

   | Secret | Meaning |
   |---|---|
   | `FASTAPI_CLOUD_TOKEN` | Deploy token (not your personal login) |
   | `FASTAPI_CLOUD_APP_ID` | App UUID (e.g. `e46d6aee-…`) |

   **Option A — CLI (automatic)**  
   From a machine already logged in with `fastapi login` (needs [GitHub CLI](https://cli.github.com/) `gh` for auto-setting secrets):

   ```powershell
   cd backend
   fastapi cloud setup-ci --secrets-only
   ```

   That creates a deploy token and writes both secrets to the GitHub repo. If `gh` is missing, the command prints the values for you to paste manually (Option B steps 3–4).

   **Option B — manual**

   1. Open [FastAPI Cloud dashboard](https://fastapicloud.com/) → your app.
   2. Sidebar → **Deploy Tokens** → **Create Token** → name it (e.g. `GitHub Actions`) → set expiry → create.
   3. **Copy the token immediately** (shown once). If lost, regenerate.
   4. Note the **App ID** (Settings, or local `backend/.fastapicloud/cloud.json` → `app_id`).
   5. GitHub → your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
      - Name: `FASTAPI_CLOUD_TOKEN` → paste the deploy token
      - Name: `FASTAPI_CLOUD_APP_ID` → paste the app UUID
   6. Save both. Re-run the workflow if a prior run failed on auth.

4. Ensure these files are on `main`:
   - `.github/workflows/deploy.yml`
   - `backend/scripts/build_spa.sh`
   - `.fastapicloudignore` (repo root, with `!backend/api/spa_dist/`)

### Every deploy

```powershell
git push origin main
```

Or: **Actions → Deploy → Run workflow**.

Workflow does:

1. `npm ci` + `npm run build` in `frontend/`
2. Copy `frontend/dist` → `backend/api/spa_dist`
3. `fastapi deploy ..` from `backend/` (uploads **repo root** so Application Directory `backend` resolves)

### Verify

- https://marketsimulator.fastapicloud.dev/ → React UI (not JSON)
- https://marketsimulator.fastapicloud.dev/api/health → `{"status":"ok"}`
- https://marketsimulator.fastapicloud.dev/docs → Swagger

### Common failures

| Error | Fix |
|---|---|
| `The specified token is not valid` | Regenerate deploy token; update `FASTAPI_CLOUD_TOKEN` |
| `No such file or directory (os error 2)` during install | Application Directory must be `backend`; CI must upload repo root (`fastapi deploy ..`) |
| JSON message at `/` | SPA not in upload — native GitHub deploy still on, or build step skipped |

---

## B. Deploy from the terminal (no GitHub Actions)

Use this for a one-off or when CI is not set up. You still need a FastAPI Cloud account and the app linked.

### Prerequisites

```powershell
cd backend
pip install "fastapi[standard]"   # or: uv add "fastapi[standard]"
fastapi login
```

Application Directory in the dashboard: `backend`.

### Deploy steps

```powershell
# 1. Build SPA into backend/api/spa_dist
powershell -ExecutionPolicy Bypass -File backend/scripts/build_spa.ps1
# Linux/macOS: bash backend/scripts/build_spa.sh

# 2. Confirm bundle exists
dir backend\api\spa_dist\index.html

# 3. Deploy full monorepo (Application Directory = backend)
cd backend
fastapi deploy ..
```

`fastapi deploy ..` uploads the **repo root** (parent of `backend/`), same as CI.  
If your app has Application Directory **empty** and you only ever upload `backend/` contents, use `fastapi deploy` from inside `backend/` instead — keep one consistent layout.

### Verify

Same URLs as above.

### Notes

- Do **not** commit `backend/api/spa_dist`, `backend/build/`, or `*.egg-info`.
- Study data under `backend/studies/` is ephemeral on FastAPI Cloud (lost on restart). Fine for demos; not durable production storage.
- Local login (`fastapi login`) is enough for terminal deploys. Deploy tokens are for CI only.

---

## C. Later: split frontend to Vercel (or similar)

Today the SPA is served from FastAPI (`api/spa_dist`). To host the UI on Vercel and keep the API on FastAPI Cloud:

### 1. Frontend: call the API by absolute URL

`frontend/src/api/client.ts` currently uses relative `/api/...` (same origin). Change to something like:

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

// use `${API_BASE}${path}` in fetch(...)
```

Set on Vercel:

```text
VITE_API_BASE_URL=https://marketsimulator.fastapicloud.dev
```

Keep empty (or unset) for local Vite + proxy.

### 2. Backend: tighten CORS

In `backend/api/main.py`, replace the open `*` origin with your Vercel URL:

```python
DEV_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://your-app.vercel.app",
]
```

Redeploy the API after changing CORS.

### 3. Stop bundling the SPA into FastAPI deploys

- Remove (or skip) the `build_spa` steps from CI / terminal deploy.
- Optionally drop StaticFiles mount when `spa_dist` is absent (already falls back to JSON at `/`).
- Point users at the Vercel URL for the UI; keep `/docs` and `/api/*` on FastAPI Cloud.

### 4. Vercel project settings

- **Root Directory:** `frontend`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- Env: `VITE_API_BASE_URL` as above

### 5. Optional: remove SPA from the Python package

Once Vercel is primary, you can remove `api = ["spa_dist/**/*"]` from `pyproject.toml` and the `FRONTEND_DIST` mount — API-only deploys become smaller and simpler.

---

## Quick reference

| Goal | Command / action |
|---|---|
| CI deploy | `git push origin main` |
| Terminal deploy | `build_spa` then `cd backend; fastapi deploy ..` |
| CI secrets | CLI: `fastapi cloud setup-ci --secrets-only` — or manual: Deploy Tokens + GitHub Actions secrets |
| App ID | Dashboard or `backend/.fastapicloud/cloud.json` (`app_id`) |
| Split UI later | `VITE_API_BASE_URL` + CORS + Vercel on `frontend/` |
