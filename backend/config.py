"""Application configuration and path resolution."""

from __future__ import annotations

import os
import re
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_PACKAGE_DIR = Path(__file__).resolve().parent

APP_ENV = os.getenv("APP_ENV", "development")
MARKET_SIM_STORAGE = os.getenv("MARKET_SIM_STORAGE", "local").lower()
MARKET_SIM_S3_BUCKET = os.getenv("MARKET_SIM_S3_BUCKET", "")
MARKET_SIM_S3_PREFIX = os.getenv("MARKET_SIM_S3_PREFIX", "clients").strip("/")
AWS_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "eu-west-1"))
MARKET_SIM_AUTH = os.getenv("MARKET_SIM_AUTH", "dev").lower()
MARKET_SIM_DEV_CLIENT_ID = os.getenv("MARKET_SIM_DEV_CLIENT_ID", "local-dev")
COGNITO_REGION = os.getenv("COGNITO_REGION", "")
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "")
COGNITO_APP_CLIENT_ID = os.getenv("COGNITO_APP_CLIENT_ID", "")
MARKET_SIM_CORS_ORIGINS = os.getenv("MARKET_SIM_CORS_ORIGINS", "")
MARKET_SIM_CACHE_DIR = Path(
    os.getenv("MARKET_SIM_CACHE_DIR", _PACKAGE_DIR / "data" / "cache")
)
MARKET_SIM_DATA_DIR = Path(os.getenv("MARKET_SIM_DATA_DIR", _PACKAGE_DIR / "data"))
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(MARKET_SIM_DATA_DIR / 'app.db').as_posix()}",
)

# Folder-per-study storage (Plan 1)
STUDIES_DIR = Path(os.getenv("MARKET_SIM_STUDIES_DIR", _PACKAGE_DIR / "studies"))
STUDY_INDEX_FILE = STUDIES_DIR / "index.json"

DECIMAL_COUNT = int(os.getenv("MARKET_SIM_DECIMALS", "2"))
NUMBER_FORMAT = f"{{:.{DECIMAL_COUNT}f}}"

# Brand Optimizer: mock unit cost = base price × random ratio in [lo, hi] per SKU
MOCK_UNIT_COST_RATIO_LO = float(os.getenv("MARKET_SIM_MOCK_UNIT_COST_RATIO_LO", "0.5"))
MOCK_UNIT_COST_RATIO_HI = float(os.getenv("MARKET_SIM_MOCK_UNIT_COST_RATIO_HI", "0.65"))


def ensure_directories() -> None:
    """Create runtime directories if they do not exist."""
    STUDIES_DIR.mkdir(parents=True, exist_ok=True)
    MARKET_SIM_DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Legacy root studies/index.json is not written here; catalog lives in the DB (StudyRepository).


def slugify(name: str) -> str:
    """Convert a study display name to a filesystem-safe folder slug."""
    slug = re.sub(r"[^\w\s-]", "", name.strip())
    slug = re.sub(r"[-\s]+", "_", slug)
    return slug or "study"


def _legacy_study_folder(slug: str) -> Path:
    return STUDIES_DIR / slug


def client_study_folder(client_id: str, slug: str) -> Path:
    """Tenant-scoped study directory (local layout)."""
    return STUDIES_DIR / "clients" / client_id / slug


def resolve_study_folder(client_id: str, slug: str) -> Path:
    """Resolve study root: legacy flat layout for local-dev, else clients/{id}/{slug}."""
    if client_id == MARKET_SIM_DEV_CLIENT_ID:
        legacy = _legacy_study_folder(slug)
        if (legacy / "study.json").exists() and (legacy / "hbu.parquet").exists():
            return legacy
    return client_study_folder(client_id, slug)


def study_folder(slug: str, client_id: str | None = None) -> Path:
    from api.deps import resolve_client_id

    cid = client_id or resolve_client_id()
    if MARKET_SIM_STORAGE == "s3":
        return get_storage().study_root_path(cid, slug)
    return resolve_study_folder(cid, slug)


def study_json_path(slug: str, client_id: str | None = None) -> Path:
    return study_folder(slug, client_id) / "study.json"


def hbu_parquet_path(slug: str, client_id: str | None = None) -> Path:
    return study_folder(slug, client_id) / "hbu.parquet"


def scenarios_dir(slug: str, client_id: str | None = None) -> Path:
    path = study_folder(slug, client_id) / "scenarios"
    path.mkdir(parents=True, exist_ok=True)
    return path


def validation_dir(slug: str, client_id: str | None = None) -> Path:
    path = study_folder(slug, client_id) / "validation"
    path.mkdir(parents=True, exist_ok=True)
    return path


_storage_backend = None


def get_storage():
    """Return cached StorageBackend for MARKET_SIM_STORAGE."""
    global _storage_backend
    if _storage_backend is not None:
        return _storage_backend
    if MARKET_SIM_STORAGE == "s3":
        from data.storage.s3 import S3StorageBackend

        _storage_backend = S3StorageBackend()
    else:
        from data.storage.local import LocalStorageBackend

        _storage_backend = LocalStorageBackend()
    return _storage_backend
