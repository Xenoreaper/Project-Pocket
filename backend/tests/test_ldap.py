"""
Tests for LDAP login.

No LDAP server runs here. ldap3 ships an offline mock server (`MOCK_SYNC`) that
keeps entries in memory and checks binds and searches like a real one, so the
tests exercise our real LDAP code without a network.
"""

import contextlib
from collections.abc import Callable
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from ldap3 import MOCK_SYNC, OFFLINE_SLAPD_2_4, Connection, Server
from ldap3.core.exceptions import LDAPSocketOpenError
from pydantic import ValidationError
from sqlalchemy import Engine
from sqlmodel import Session, select

from app.config import Settings
from app.ldap import (
    InvalidLdapCredentialsError,
    LdapAuthenticator,
    LdapUnavailableError,
    get_ldap_authenticator,
)
from app.models import User

BASE_DN = "ou=people,dc=example,dc=org"
SERVICE_DN = "cn=pocket-service,dc=example,dc=org"
SERVICE_PASSWORD = "service-secret"
LDAP_SETTINGS = {
    "auth_provider": "ldap",
    "ldap_url": "ldap://ldap.test",
    "ldap_user_base_dn": BASE_DN,
}

# The directory most tests use: one service account and two people.
DEFAULT_ENTRIES: dict[str, dict[str, Any]] = {
    SERVICE_DN: {"objectClass": "person", "cn": "pocket-service", "userPassword": SERVICE_PASSWORD},
    f"uid=anna,{BASE_DN}": {
        "objectClass": "inetOrgPerson",
        "uid": "anna",
        "cn": "Anna Example",
        "userPassword": "anna-password",
    },
    f"uid=ben,{BASE_DN}": {
        "objectClass": "inetOrgPerson",
        "uid": "ben",
        "cn": "Ben Example",
        "userPassword": "ben-password",
    },
}


class Directory:
    """An in-memory LDAP directory that hands out mock connections."""

    def __init__(self, entries: dict[str, dict[str, Any]]) -> None:
        self.entries = entries
        self.connections: list[Connection] = []

    def connect(self) -> Connection:
        """Open a mock connection that knows all entries of this directory."""
        # OFFLINE_SLAPD_2_4 gives the mock the schema of a real OpenLDAP server.
        server = Server("ldap.test", get_info=OFFLINE_SLAPD_2_4)
        connection = Connection(server, client_strategy=MOCK_SYNC, raise_exceptions=False)
        for dn, attributes in self.entries.items():
            connection.strategy.add_entry(dn, dict(attributes))
        self.connections.append(connection)
        return connection


def make_authenticator(directory: Directory, **overrides: Any) -> LdapAuthenticator:
    """Build an authenticator for a mock directory; keyword arguments replace defaults."""
    options: dict[str, Any] = {
        "bind_dn": SERVICE_DN,
        "bind_password": SERVICE_PASSWORD,
        "user_base_dn": BASE_DN,
        "user_filter": "(uid={username})",
        "id_attribute": "uid",
        "display_name_attribute": "cn",
    }
    options.update(overrides)
    return LdapAuthenticator(directory.connect, **options)


@pytest.fixture
def directory() -> Directory:
    """Return a fresh copy of the default directory."""
    return Directory({dn: dict(attributes) for dn, attributes in DEFAULT_ENTRIES.items()})


# ── LdapAuthenticator ────────────────────────────────────────────────────────


def test_correct_login_returns_the_identity(directory: Directory) -> None:
    """A known user with the right password is identified by the configured attributes."""
    identity = make_authenticator(directory).authenticate("anna", "anna-password")

    assert identity.subject == "anna"
    assert identity.display_name == "Anna Example"


@pytest.mark.parametrize(
    ("username", "password"),
    [
        pytest.param("anna", "wrong-password", id="wrong-password"),
        pytest.param("anna", "ben-password", id="other-users-password"),
        pytest.param("nobody", "anna-password", id="unknown-user"),
    ],
)
def test_wrong_logins_are_rejected(directory: Directory, username: str, password: str) -> None:
    """A wrong password and an unknown user raise the same error."""
    with pytest.raises(InvalidLdapCredentialsError):
        make_authenticator(directory).authenticate(username, password)


@pytest.mark.parametrize(
    ("username", "password"),
    [("anna", ""), ("", "anna-password"), ("   ", "anna-password")],
)
def test_empty_input_never_reaches_the_server(
    directory: Directory, username: str, password: str
) -> None:
    """An empty password would count as an anonymous bind, which "succeeds"."""
    with pytest.raises(InvalidLdapCredentialsError):
        make_authenticator(directory).authenticate(username, password)

    assert directory.connections == []


@pytest.mark.parametrize("username", ["*", "an*", "anna)(uid=*", "*)(objectClass=*"])
def test_filter_characters_in_the_name_are_escaped(username: str) -> None:
    """
    Without escaping, "*" would match the only user and her password would log in.

    The directory holds just one person, so an unescaped wildcard gives exactly
    one match, the case the code accepts.
    """
    single = Directory(
        {dn: attrs for dn, attrs in DEFAULT_ENTRIES.items() if not dn.startswith("uid=ben")}
    )

    with pytest.raises(InvalidLdapCredentialsError):
        make_authenticator(single).authenticate(username, "anna-password")


@pytest.mark.parametrize("username", ["*", "de*", "anna)(uid=*", "back\\slash", "nul\x00"])
def test_names_with_filter_characters_never_reach_the_server(
    directory: Directory, username: str
) -> None:
    """
    Some servers read even an escaped "*" as a wildcard (GLAuth does; the
    integration test found it). So such names are refused before any search.
    """
    with pytest.raises(InvalidLdapCredentialsError):
        make_authenticator(directory).authenticate(username, "anna-password")

    assert directory.connections == []


def test_ambiguous_filter_is_rejected(directory: Directory) -> None:
    """A filter that matches several people must not log in as one of them."""
    authenticator = make_authenticator(directory, user_filter="(|(uid={username})(uid=ben))")

    with pytest.raises(InvalidLdapCredentialsError):
        authenticator.authenticate("anna", "anna-password")


def test_search_is_limited_to_the_user_subtree(directory: Directory) -> None:
    """The service account lives outside the user base DN and cannot log in."""
    authenticator = make_authenticator(directory, user_filter="(cn={username})")

    with pytest.raises(InvalidLdapCredentialsError):
        authenticator.authenticate("pocket-service", SERVICE_PASSWORD)


def test_display_name_falls_back_to_the_login_name(directory: Directory) -> None:
    """A missing display attribute does not block the login."""
    authenticator = make_authenticator(directory, display_name_attribute="displayName")

    assert authenticator.authenticate("anna", "anna-password").display_name == "anna"


def test_missing_id_attribute_is_a_configuration_error(directory: Directory) -> None:
    """Without a stable ID the user cannot be stored, which is not the user's fault."""
    authenticator = make_authenticator(directory, id_attribute="entryUUID")

    with pytest.raises(LdapUnavailableError):
        authenticator.authenticate("anna", "anna-password")


def test_failed_search_is_a_configuration_error(directory: Directory) -> None:
    """A base DN that does not exist is a setup problem, not a wrong password."""
    authenticator = make_authenticator(directory, user_base_dn="ou=missing,dc=example,dc=org")

    with pytest.raises(LdapUnavailableError):
        authenticator.authenticate("anna", "anna-password")


def test_rejected_service_account_is_a_configuration_error(directory: Directory) -> None:
    """A wrong service password must not look like a wrong user password."""
    authenticator = make_authenticator(directory, bind_password="outdated")

    with pytest.raises(LdapUnavailableError):
        authenticator.authenticate("anna", "anna-password")


def test_unreachable_server_is_reported_as_unavailable() -> None:
    """Network errors from ldap3 are translated into our own error type."""

    def failing_factory() -> Connection:
        raise LDAPSocketOpenError("connection refused")

    authenticator = LdapAuthenticator(
        failing_factory,
        bind_dn="",
        bind_password="",
        user_base_dn=BASE_DN,
        user_filter="(uid={username})",
        id_attribute="uid",
        display_name_attribute="cn",
    )

    with pytest.raises(LdapUnavailableError):
        authenticator.authenticate("anna", "anna-password")


@pytest.mark.parametrize("password", ["anna-password", "wrong-password"])
def test_connection_is_closed_after_every_attempt(directory: Directory, password: str) -> None:
    """Connections must not pile up, whether the login succeeds or fails."""
    # `suppress` ignores the expected error of the wrong-password run.
    with contextlib.suppress(InvalidLdapCredentialsError):
        make_authenticator(directory).authenticate("anna", password)

    assert [connection.closed for connection in directory.connections] == [True]


def test_binary_and_multi_valued_attributes_become_stable_text() -> None:
    """
    objectGUID arrives as bytes and an attribute can hold several values.

    `_first_value` must turn both into the same text on every login, or the
    same person would get a new Pocket user each time.
    """
    multi = Directory(
        {
            **DEFAULT_ENTRIES,
            f"uid=anna,{BASE_DN}": {
                **DEFAULT_ENTRIES[f"uid=anna,{BASE_DN}"],
                "cn": ["Anna Example", "Anna E."],
                "audio": b"\x01\xff",
            },
        }
    )

    identity = make_authenticator(multi, id_attribute="audio").authenticate("anna", "anna-password")

    assert identity.subject == "01ff"
    assert identity.display_name == "Anna Example"


# ── API in LDAP mode ─────────────────────────────────────────────────────────


@pytest.fixture
def ldap_client(
    app: FastAPI, directory: Directory, use_settings: Callable[..., None]
) -> TestClient:
    """Return a client for an app that checks logins against the mock directory."""
    use_settings(**LDAP_SETTINGS)
    authenticator = make_authenticator(directory)
    app.dependency_overrides[get_ldap_authenticator] = lambda: authenticator
    return TestClient(app)


def ldap_login(client: TestClient, username: str = "anna", password: str = "anna-password") -> Any:
    """Post a login and return the response."""
    return client.post("/api/auth/login", json={"username": username, "password": password})


def test_ldap_login_returns_a_working_token(ldap_client: TestClient) -> None:
    """After an LDAP login the client holds an ordinary Pocket token."""
    login = ldap_login(ldap_client)
    headers = {"Authorization": f"Bearer {login.json()['token']}"}

    assert login.status_code == 200
    assert login.json()["token"].startswith("pkt_")
    assert ldap_client.get("/api/auth/me", headers=headers).json()["displayName"] == "Anna Example"
    assert ldap_client.get("/api/items", headers=headers).json() == {"items": [], "total": 0}


def test_ldap_user_is_created_once_without_a_password(
    ldap_client: TestClient, engine: Engine
) -> None:
    """Repeated logins reuse one user row, and no password is stored for it."""
    first = ldap_login(ldap_client).json()["user"]["id"]
    second = ldap_login(ldap_client).json()["user"]["id"]

    with Session(engine) as session:
        user = session.exec(select(User)).one()

    assert first == second == user.id
    assert (user.oidc_issuer, user.oidc_subject) == (f"ldap:{BASE_DN}", "anna")
    assert user.password_hash is None
    assert user.username is None


def test_ldap_login_failures_look_the_same(ldap_client: TestClient) -> None:
    """A wrong password and an unknown user give an identical 401."""
    wrong_password = ldap_login(ldap_client, password="wrong-password")
    unknown_user = ldap_login(ldap_client, username="nobody")

    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()


def test_ldap_outage_returns_503(app: FastAPI, ldap_client: TestClient) -> None:
    """An outage says "try again later", not "wrong password"."""

    class BrokenLdap:
        """Stands in for an authenticator whose server is down."""

        def authenticate(self, _username: str, _password: str) -> None:
            raise LdapUnavailableError("down")

    app.dependency_overrides[get_ldap_authenticator] = BrokenLdap

    assert ldap_login(ldap_client).status_code == 503


def test_registration_is_closed_in_ldap_mode(ldap_client: TestClient) -> None:
    """Accounts come from the directory, so Pocket creates none itself."""
    response = ldap_client.post(
        "/api/auth/register", json={"username": "anna", "password": "correct-horse-battery"}
    )

    assert response.status_code == 403


def test_local_accounts_cannot_log_in_in_ldap_mode(
    app: FastAPI,
    client: TestClient,
    directory: Directory,
    register_and_login: Callable[[str], dict[str, str]],
    use_settings: Callable[..., None],
) -> None:
    """A local account from before the switch does not bypass the directory."""
    register_and_login("carl")
    use_settings(**LDAP_SETTINGS)
    authenticator = make_authenticator(directory)
    app.dependency_overrides[get_ldap_authenticator] = lambda: authenticator

    assert ldap_login(client, username="carl", password="correct-horse-battery").status_code == 401


def test_auth_config_announces_ldap(ldap_client: TestClient) -> None:
    """Clients learn that the password form is the way in and registration is off."""
    assert ldap_client.get("/api/auth/config").json() == {
        "provider": "ldap",
        "registrationEnabled": False,
        "oidc": None,
    }


# ── Settings ─────────────────────────────────────────────────────────────────


def test_ldap_replaces_keycloak_when_selected() -> None:
    """Only one external directory is active, even if both are configured."""
    settings = Settings(
        **LDAP_SETTINGS,
        oidc_issuer="http://keycloak.test/realms/pocket",
        oidc_client_id="project-pocket",
    )

    assert settings.ldap_enabled is True
    assert settings.oidc_enabled is False
    assert settings.active_auth_provider == "ldap"


def test_keycloak_is_the_default_provider_and_falls_back_to_local() -> None:
    """Without any configuration, Pocket runs on its own accounts."""
    assert Settings(oidc_issuer="", oidc_client_id="").active_auth_provider == "local"
    assert (
        Settings(
            oidc_issuer="http://keycloak.test/realms/pocket", oidc_client_id="project-pocket"
        ).active_auth_provider
        == "keycloak"
    )


@pytest.mark.parametrize(
    "values",
    [
        pytest.param({"auth_provider": "ldap"}, id="no-server"),
        pytest.param({**LDAP_SETTINGS, "ldap_user_base_dn": ""}, id="no-base-dn"),
        pytest.param({**LDAP_SETTINGS, "ldap_user_filter": "(uid=anna)"}, id="no-placeholder"),
        pytest.param({**LDAP_SETTINGS, "ldap_bind_dn": "cn=svc"}, id="bind-dn-without-password"),
        pytest.param({"auth_provider": "saml"}, id="unknown-provider"),
    ],
)
def test_broken_ldap_settings_fail_at_startup(values: dict[str, str]) -> None:
    """A setup that cannot work is refused before anyone tries to log in."""
    with pytest.raises(ValidationError):
        Settings(**values)


def test_authenticator_is_only_built_in_ldap_mode() -> None:
    """The dependency returns None unless LDAP is selected."""
    assert get_ldap_authenticator(Settings(oidc_issuer="", oidc_client_id="")) is None
    assert isinstance(get_ldap_authenticator(Settings(**LDAP_SETTINGS)), LdapAuthenticator)
