from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.app_server import router as app_server_router
from app.api.routes.auth import router as auth_router
from app.api.routes.setup import router as setup_router
from app.api.routes.health import router as health_router
from app.db.session import init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Codex Control Desktop Server",
        version="0.1.0",
        description="Local-first FastAPI backend for monitoring and controlling Codex tasks.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:8081",
            "http://127.0.0.1:8081",
            "http://localhost:19006",
            "http://127.0.0.1:19006",
        ],
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(auth_router, prefix="/auth", tags=["auth"])
    app.include_router(setup_router, prefix="/setup", tags=["setup"])
    app.include_router(app_server_router, prefix="/app-server", tags=["app-server"])
    return app


app = create_app()
