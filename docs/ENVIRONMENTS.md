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

To click through signup and sign-in without AWS, set `MARKET_SIM_AUTH=mock` and keep `APP_ENV=development`, then restart the API. Accounts live in `backend/data/mock_auth/` (gitignored). The confirmation code is `000000`. Each email is its own tenant, not `local-dev`. The mock issuer stays off when `APP_ENV` is anything else. Production uses `cognito`.

## AWS production (target)

| Variable | Value |
|----------|--------|
| `MARKET_SIM_STORAGE` | `s3` |
| `MARKET_SIM_S3_BUCKET` | your bucket |
| `DATABASE_URL` | `postgresql+psycopg://...@rds.../marketsim` |
| `APP_ENV` | `production` (empty CORS list means same-origin only) |
| `MARKET_SIM_AUTH` | `cognito` |
| `COGNITO_REGION` | user pool region |
| `COGNITO_USER_POOL_ID` | user pool id |
| `COGNITO_APP_CLIENT_ID` | public app client id (no secret, SRP enabled) |
| `MARKET_SIM_CORS_ORIGINS` | comma-separated origins, only if the UI is not served by this API |

Compute: EC2 Docker, single `uvicorn` worker (`--workers 1`).

Create the user pool once in that AWS account: email as the username, email verification on, Lite or Essentials. The API verifies Cognito ID tokens and maps `sub` to a `clients` row. Direct sign-in stays inside Cognito's 10,000 monthly-active-user allowance.

Before deploy or container start, run migrations against RDS:

```bash
cd backend && alembic upgrade head
```

(`DATABASE_URL` must point at Postgres.) Startup also runs migrations, but running them explicitly in CI/deploy is recommended.

Phase 4 (ops checklist: IAM, backups, TLS) is documented when you deploy.
