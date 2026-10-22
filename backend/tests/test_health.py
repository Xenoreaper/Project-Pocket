"""
Tests for GET /api/health.

The TestClient runs the real FastAPI app in-process (no server, no network).
"""

from fastapi.testclient import TestClient

from app import __version__
from app.main import create_app


def test_health_returns_status_and_version() -> None:
    """The endpoint reports a running service and the package version."""
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": __version__}


def test_health_is_documented_in_openapi() -> None:
    """A smoke test that the router is mounted under /api in the schema."""
    client = TestClient(create_app())

    schema = client.get("/openapi.json").json()

    assert "/api/health" in schema["paths"]
