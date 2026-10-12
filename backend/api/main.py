"""FastAPI application factory for the Market Simulator API.

Run (dev, from backend/):   uvicorn api.main:app --reload --port 8000
The React dev server (Vite, :5173) proxies /api to this service.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from config import APP_ENV, MARKET_SIM_CORS_ORIGINS, ensure_directories
from api.middleware import ClientContextMiddleware
from api.routes import analytics, auth, optimizer, scenarios, sessions, studies, validation, wizard
from db.bootstrap import init_db


def cors_origins() -> list[str]:
    """Local Vite in development; explicit origins otherwise. Never a wildcard."""
    origins: list[str] = []
    if APP_ENV == "development":
        origins.extend(["http://localhost:5173", "http://127.0.0.1:5173"])
    for origin in MARKET_SIM_CORS_ORIGINS.split(","):
        cleaned = origin.strip()
        if cleaned and cleaned != "*" and cleaned not in origins:
            origins.append(cleaned)
    return origins

# Built locally: scripts/build_spa.ps1 → api/spa_dist (bundled in the wheel)
FRONTEND_DIST = Path(__file__).resolve().parent / "spa_dist"


def create_app() -> FastAPI:
    ensure_directories()
    init_db()
    app = FastAPI(title="Market Simulator API", version="0.1.0")

    app.add_middleware(ClientContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health", tags=["meta"])
    def health() -> dict:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(studies.router)
    app.include_router(sessions.router)
    app.include_router(scenarios.router)
    app.include_router(validation.router)
    app.include_router(wizard.router)
    app.include_router(optimizer.router)
    app.include_router(analytics.router)


    # In production the built SPA is served from the same process.
    if FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="spa")
    else:

        @app.get("/", tags=["meta"])
        def root() -> JSONResponse:
            return JSONResponse(
                {
                    "message": "Market Simulator API running. Build the SPA (frontend/) "
                    "or use the Vite dev server at http://localhost:5173.",
                    "docs": "/docs",
                }
            )

    return app


app = create_app()
