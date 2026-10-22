"""
Health endpoint.

Used by Docker's healthcheck, by the web app's start page and later by the
extension to check whether a sync server is reachable.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.config import get_settings

# A router groups endpoints; `tags` only affects the OpenAPI documentation UI.
router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    """Response body of GET /api/health."""

    status: str = Field(description="Always 'ok' when the service is running.")
    version: str = Field(description="Backend version, e.g. '0.1.0'.")


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Check whether the backend is alive",
)
def read_health() -> HealthResponse:
    """
    Return a tiny status object.

    This endpoint intentionally touches neither the database nor any external
    service: it only proves that the HTTP server is up. Deeper health checks
    can be added once sync/storage exists.
    """
    settings = get_settings()
    return HealthResponse(status="ok", version=settings.app_version)
