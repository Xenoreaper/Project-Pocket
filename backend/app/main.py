"""
FastAPI application factory.

`create_app()` builds a configured app instance. Tests call it directly, while
uvicorn imports the module-level `app` object (`uvicorn app.main:app`). Using a
factory instead of configuring a global app makes tests independent: each test
can create a fresh app with different settings.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.config import get_settings


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.

    Returns:
        A FastAPI instance with CORS and the /api routes mounted.
    """
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Project Pocket backend — scaffold with a health endpoint.",
    )

    # CORS lets browser code on another origin (extension, Vite dev server)
    # call this API. In production the web app is served through nginx on the
    # same origin, so no CORS is needed there. We never use "*" together with
    # credentials; the default list is explicit and comes from .env.
    allowed_origins = settings.cors_origin_list
    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(health_router, prefix="/api")

    return app


# Module-level instance for `uvicorn app.main:app` (see backend/Dockerfile).
app = create_app()
