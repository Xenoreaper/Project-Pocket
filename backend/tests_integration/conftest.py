"""
Fixtures for the integration tests.

Unlike `backend/tests/`, these tests do not start the app in-process. They send
real HTTP requests to a running stack (backend, plus Keycloak or LDAP) that
`docker/integration/run.sh` starts in a throwaway Compose project. They are not
part of `make backend-test`; run them with `make integration-test`.

The tests run inside the Compose network, so they reach the services by their
service names (`backend`, `keycloak`).
"""

import os
import time
import uuid
from collections.abc import Callable, Generator
from typing import Any

import httpx
import pytest

BACKEND_URL = os.environ.get("POCKET_IT_BACKEND_URL", "http://backend:8000")
KEYCLOAK_URL = os.environ.get("POCKET_IT_KEYCLOAK_URL", "http://keycloak:8080")


def wait_until_up(url: str, timeout_seconds: int = 180) -> None:
    """
    Poll a URL until it answers with a success status.

    Containers report "started" before the service inside accepts requests;
    Keycloak in particular needs up to a minute.

    Raises:
        TimeoutError: the URL did not answer in time.
    """
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=5).is_success:
                return
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise TimeoutError(f"{url} did not come up within {timeout_seconds} seconds")


# `scope="session"`: wait once per test run, not once per test.
@pytest.fixture(scope="session")
def api() -> Generator[httpx.Client, None, None]:
    """Return an HTTP client for the running backend, once it is healthy."""
    wait_until_up(f"{BACKEND_URL}/api/health")
    with httpx.Client(base_url=BACKEND_URL, timeout=15) as client:
        yield client


@pytest.fixture
def make_page() -> Callable[..., dict[str, Any]]:
    """Return a factory for valid uploads, each with its own URL."""

    def build(**overrides: Any) -> dict[str, Any]:
        # A random URL keeps repeated runs against the same database independent.
        body: dict[str, Any] = {
            "url": f"https://example.com/{uuid.uuid4()}",
            "title": "Integration soup",
            "category": "recipes",
            "categoryLabel": "Recipes",
            "tags": ["integration"],
            "note": "",
            "snapshot": {
                "jsonLd": [],
                "text": "Boil water.",
                "capturedAt": "2026-11-16T10:00:00Z",
                "truncated": False,
            },
            "savedAt": "2026-11-16T10:00:00Z",
            "updatedAt": "2026-11-16T10:00:00Z",
        }
        body.update(overrides)
        return body

    return build


def bearer(token: str) -> dict[str, str]:
    """Build the auth header for a token."""
    return {"Authorization": f"Bearer {token}"}


def upload_and_list(api: httpx.Client, headers: dict[str, str], page: dict[str, Any]) -> list[str]:
    """Upload one page and return the URLs the same user then sees."""
    created = api.post("/api/items", json=page, headers=headers)
    assert created.status_code == 201, created.text

    listing = api.get("/api/items", params={"limit": 200}, headers=headers)
    assert listing.status_code == 200, listing.text
    return [item["url"] for item in listing.json()["items"]]
