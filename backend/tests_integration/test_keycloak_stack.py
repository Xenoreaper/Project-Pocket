"""
Integration tests against a stack with the test Keycloak.

They prove what unit tests cannot: that a token issued by a real Keycloak is
accepted by the running backend, including the fetch of Keycloak's signing keys.
"""

import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from tests_integration.conftest import KEYCLOAK_URL, bearer, upload_and_list, wait_until_up

# Every test in this file belongs to the "keycloak" run of the test script.
pytestmark = pytest.mark.keycloak

REALM_URL = f"{KEYCLOAK_URL}/realms/pocket"


@pytest.fixture(scope="module")
def demo_token() -> str:
    """
    Get an access token for the realm's demo user.

    The test realm allows the password grant for exactly this purpose; a browser
    login would need a browser.
    """
    wait_until_up(f"{REALM_URL}/.well-known/openid-configuration")
    response = httpx.post(
        f"{REALM_URL}/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "project-pocket",
            "username": "demo",
            "password": "pocket-demo",
        },
        timeout=15,
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def test_backend_announces_keycloak(api: httpx.Client) -> None:
    """Clients learn the provider and where to send users for the login."""
    config = api.get("/api/auth/config").json()

    assert config["provider"] == "keycloak"
    assert config["oidc"]["clientId"] == "project-pocket"
    assert config["oidc"]["issuer"].endswith("/realms/pocket")


def test_keycloak_token_opens_the_users_pocket(
    api: httpx.Client, demo_token: str, make_page: Callable[..., dict[str, Any]]
) -> None:
    """The whole path works: real token, upload, and the item is listed."""
    headers = bearer(demo_token)
    page = make_page()

    me = api.get("/api/auth/me", headers=headers)

    assert me.status_code == 200, me.text
    assert me.json()["displayName"] == "demo"
    assert page["url"] in upload_and_list(api, headers, page)


def test_tampered_token_is_rejected(api: httpx.Client, demo_token: str) -> None:
    """Changing one character breaks the signature."""
    assert api.get("/api/auth/me", headers=bearer(demo_token + "x")).status_code == 401


def test_local_accounts_work_next_to_keycloak_and_stay_separate(
    api: httpx.Client, demo_token: str, make_page: Callable[..., dict[str, Any]]
) -> None:
    """A local user can register, sync, and never sees the Keycloak user's pages."""
    demo_page = make_page()
    upload_and_list(api, bearer(demo_token), demo_page)
    credentials = {"username": f"it-{uuid.uuid4().hex[:12]}", "password": "correct-horse-battery"}

    assert api.post("/api/auth/register", json=credentials).status_code == 201
    login = api.post("/api/auth/login", json=credentials)
    assert login.status_code == 200, login.text
    local_headers = bearer(login.json()["token"])
    local_page = make_page()

    visible = upload_and_list(api, local_headers, local_page)

    assert visible == [local_page["url"]]
    assert demo_page["url"] not in visible
