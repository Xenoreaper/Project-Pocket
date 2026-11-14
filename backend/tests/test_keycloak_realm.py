"""
Checks on the Keycloak realm files.

There are two realms: `docker/keycloak/` is the local test realm with a demo
user, `docker/server/keycloak/` is the realm for a real server. JSON cannot hold
comments, so these tests document and guard the settings that matter: if someone
changes a realm by hand, a broken or unsafe login shows up here instead of only
in a browser. They read the files; no Keycloak is started.
"""

import json
from pathlib import Path
from typing import Any

import pytest

DOCKER_DIR = Path(__file__).resolve().parents[2] / "docker"
TEST_REALM = DOCKER_DIR / "keycloak" / "pocket-realm.json"
SERVER_REALM = DOCKER_DIR / "server" / "keycloak" / "pocket-realm.json"


def load_realm(path: Path) -> dict[str, Any]:
    """Read one realm file."""
    return json.loads(path.read_text(encoding="utf-8"))


def pocket_client(realm: dict[str, Any]) -> dict[str, Any]:
    """Return the single Pocket client of a realm."""
    clients = [c for c in realm["clients"] if c["clientId"] == "project-pocket"]
    assert len(clients) == 1
    return clients[0]


# `parametrize` runs the test once per file; `ids` names the runs in the output.
@pytest.mark.parametrize("path", [TEST_REALM, SERVER_REALM], ids=["test", "server"])
def test_realm_name_matches_the_documented_issuer(path: Path) -> None:
    """The docs and .env templates use .../realms/pocket as the issuer."""
    realm = load_realm(path)

    assert realm["realm"] == "pocket"
    assert realm["enabled"] is True
    assert realm["registrationAllowed"] is False


@pytest.mark.parametrize("path", [TEST_REALM, SERVER_REALM], ids=["test", "server"])
def test_client_is_public_with_pkce(path: Path) -> None:
    """Browsers cannot keep a secret, so the client is public and protected by PKCE."""
    client = pocket_client(load_realm(path))

    assert client["publicClient"] is True
    assert "secret" not in client
    assert client["standardFlowEnabled"] is True
    assert client["implicitFlowEnabled"] is False
    assert client["attributes"]["pkce.code.challenge.method"] == "S256"


def test_test_realm_redirects_only_to_the_local_web_app() -> None:
    """A wildcard redirect to any site would let tokens leak to strangers."""
    client = pocket_client(load_realm(TEST_REALM))

    for uri in client["redirectUris"]:
        assert uri.startswith(("http://localhost:3000/", "http://localhost:5173/"))


def test_demo_user_can_log_in_without_extra_steps() -> None:
    """A complete profile and a permanent password avoid forced setup screens."""
    realm = load_realm(TEST_REALM)
    demo = next(user for user in realm["users"] if user["username"] == "demo")

    assert demo["enabled"] is True
    assert demo["emailVerified"] is True
    assert demo["credentials"][0]["temporary"] is False
    assert not demo.get("requiredActions")


def test_server_realm_ships_no_accounts() -> None:
    """A public server must not start with a user whose password is in the repo."""
    assert not load_realm(SERVER_REALM).get("users")


def test_server_realm_disables_the_password_grant() -> None:
    """Passwords are typed into Keycloak's own page only, never sent by an app."""
    client = pocket_client(load_realm(SERVER_REALM))

    assert client["directAccessGrantsEnabled"] is False


def test_server_realm_redirects_only_to_the_configured_web_app() -> None:
    """The address comes from POCKET_PUBLIC_URL, so no domain is hard-coded."""
    client = pocket_client(load_realm(SERVER_REALM))

    assert client["redirectUris"] == ["${POCKET_PUBLIC_URL}/*"]
