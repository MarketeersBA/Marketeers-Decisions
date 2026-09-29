# Environments (local vs AWS)

One codebase; behavior is selected with environment variables.

## Local development (default)

| Variable | Value |
|----------|--------|
| `APP_ENV` | `development` |
| `MARKET_SIM_STORAGE` | `local` |
| `MARKET_SIM_AUTH` | `dev` |
| `MARKET_SIM_DEV_CLIENT_ID` | `local-dev` |
| `DATABASE_URL` | unset → SQLite at `backend/data/app.db` |

Schema changes use **Alembic** (`backend/alembic/`). On app startup, `init_db()` runs `alembic upgrade head` (or stamps head if the DB was created before Alembic was added). Manual:

```powershell
cd backend
$env:DATABASE_URL = "sqlite:///./data/app.db"   # optional; default matches config
python -m alembic upgrade head
python -m alembic current
```

Run:

```powershell
cd backend
uvicorn api.main:app --reload --port 8000
cd ../frontend
npm run dev
```

Open http://localhost:5173

Legacy studies under `backend/studies/{slug}/` are still read when `client_id=local-dev`.

## AWS production (target)

| Variable | Value |
|----------|--------|
| `MARKET_SIM_STORAGE` | `s3` |
| `MARKET_SIM_S3_BUCKET` | your bucket |
| `DATABASE_URL` | `postgresql+psycopg://...@rds.../marketsim` |
| `MARKET_SIM_AUTH` | `cognito` (Phase 3) |

Compute: EC2 Docker, single `uvicorn` worker (`--workers 1`).

Before deploy or container start, run migrations against RDS:

```bash
cd backend && alembic upgrade head
```

(`DATABASE_URL` must point at Postgres.) Startup also runs migrations, but running them explicitly in CI/deploy is recommended.

Phase 4 (ops checklist: IAM, backups, TLS) is documented when you deploy.
