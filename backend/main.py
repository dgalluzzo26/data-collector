from pathlib import Path
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.routes import ai, genie, health, lookups, me, projects, uc

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _run_startup_migrations() -> None:
    try:
        from backend import config
        from backend.db import get_connection
        from backend.provisioning import run_migrations

        with get_connection() as conn:
            with conn.cursor() as cur:
                run_migrations(cur, config.CATALOG, config.SCHEMA)
    except Exception as exc:
        logger.warning("Startup schema migrations skipped: %s", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _run_startup_migrations()
    yield


app = FastAPI(title="Data Collector API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(me.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(lookups.router, prefix="/api")
app.include_router(genie.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(uc.router, prefix="/api")

dist_dir = Path(__file__).resolve().parent.parent / "dist"
if dist_dir.exists():
    assets_dir = dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        file_path = dist_dir / full_path
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(dist_dir / "index.html"))
