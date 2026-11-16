"""
Integration tests against a stack with the test LDAP server (GLAuth).

They prove that the LDAP login works against a real LDAP server over the
network: the service bind, the search, and the bind with the user's password.
"""

from collections.abc import Callable
from typing import Any

import httpx
import pytest

from tests_integration.conftest import bearer, upload_and_list

# Every test in this file belongs to the "ldap" run of the test script.
pytestmark = pytest.mark.ldap


def login(api: httpx.Client, username: str, password: str) -> httpx.Response:
    """Send a login to the backend."""
    return api.post("/api/auth/login", json={"username": username, "password": password})


def test_backend_announces_ldap(api: httpx.Client) -> None:
    """Clients learn that the password form is the login and registration is off."""
    assert api.get("/api/auth/config").json() == {
        "provider": "ldap",
        "registrationEnabled": False,
        "oidc": None,
    }


def test_ldap_login_opens_the_users_pocket(
    api: httpx.Client, make_page: Callable[..., dict[str, Any]]
) -> None:
    """The whole path works: LDAP login, token, upload, and the item is listed."""
    response = login(api, "demo", "pocket-demo")
    assert response.status_code == 200, response.text
    headers = bearer(response.json()["token"])
    page = make_page()

    assert api.get("/api/auth/me", headers=headers).json()["displayName"] == "demo"
    assert page["url"] in upload_and_list(api, headers, page)


def test_repeated_logins_are_the_same_user(api: httpx.Client) -> None:
    """The user row is created on the first login and reused afterwards."""
    first = login(api, "demo", "pocket-demo").json()["user"]["id"]
    second = login(api, "demo", "pocket-demo").json()["user"]["id"]

    assert first == second


@pytest.mark.parametrize(
    ("username", "password"),
    [
        pytest.param("demo", "wrong-password", id="wrong-password"),
        pytest.param("nobody", "pocket-demo", id="unknown-user"),
        pytest.param("*", "pocket-demo", id="wildcard-name"),
        pytest.param("pocket-service", "pocket-service", id="service-account"),
    ],
)
def test_wrong_logins_are_rejected(api: httpx.Client, username: str, password: str) -> None:
    """Wrong passwords, unknown users, filter tricks and the service account all get 401."""
    assert login(api, username, password).status_code == 401


def test_registration_is_closed(api: httpx.Client) -> None:
    """In LDAP mode Pocket creates no accounts of its own."""
    response = api.post(
        "/api/auth/register", json={"username": "someone", "password": "correct-horse-battery"}
    )

    assert response.status_code == 403
