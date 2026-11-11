"""Tests for local accounts: registration, login, logout and token handling."""

from collections.abc import Callable
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.auth import verify_password
from app.models import AuthToken, User, new_id, utc_now

CREDENTIALS = {"username": "Anna", "password": "correct-horse-battery"}


def test_register_returns_user_without_password_data(client: TestClient) -> None:
    """A new account comes back with its public fields only."""
    response = client.post("/api/auth/register", json=CREDENTIALS)

    assert response.status_code == 201
    assert response.json()["displayName"] == "Anna"
    assert set(response.json()) == {"id", "displayName"}


def test_register_stores_only_a_password_hash(client: TestClient, engine: Engine) -> None:
    """The plain password never reaches the database."""
    client.post("/api/auth/register", json=CREDENTIALS)

    with Session(engine) as session:
        user = session.exec(select(User)).one()

    assert CREDENTIALS["password"] not in (user.password_hash or "")
    assert verify_password(CREDENTIALS["password"], user.password_hash)


def test_register_rejects_a_name_differing_only_in_case(client: TestClient) -> None:
    """Usernames are case-insensitive, so "anna" collides with "Anna"."""
    client.post("/api/auth/register", json=CREDENTIALS)

    response = client.post("/api/auth/register", json={**CREDENTIALS, "username": "anna"})

    assert response.status_code == 409


@pytest.mark.parametrize(
    "body",
    [
        {"username": "ab", "password": "correct-horse-battery"},
        {"username": "has space", "password": "correct-horse-battery"},
        {"username": "Anna", "password": "short"},
    ],
)
def test_register_rejects_invalid_input(client: TestClient, body: dict[str, str]) -> None:
    """Names and passwords outside the allowed format are refused."""
    assert client.post("/api/auth/register", json=body).status_code == 422


def test_register_can_be_closed(client: TestClient, use_settings: Callable[..., None]) -> None:
    """POCKET_ALLOW_REGISTRATION=false blocks new local accounts."""
    use_settings(allow_registration=False)

    assert client.post("/api/auth/register", json=CREDENTIALS).status_code == 403


def test_login_with_any_name_casing_returns_a_working_token(client: TestClient) -> None:
    """The token from a login opens protected endpoints."""
    client.post("/api/auth/register", json=CREDENTIALS)

    login = client.post("/api/auth/login", json={**CREDENTIALS, "username": "ANNA"})
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {login.json()['token']}"})

    assert login.status_code == 200
    assert me.json()["displayName"] == "Anna"


def test_login_failures_look_the_same(client: TestClient) -> None:
    """A wrong password and an unknown user give an identical answer."""
    client.post("/api/auth/register", json=CREDENTIALS)

    wrong_password = client.post("/api/auth/login", json={**CREDENTIALS, "password": "wrong-one"})
    unknown_user = client.post("/api/auth/login", json={**CREDENTIALS, "username": "nobody"})

    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()


def test_login_stores_only_a_token_hash(client: TestClient, engine: Engine) -> None:
    """A leaked database must not contain usable tokens."""
    client.post("/api/auth/register", json=CREDENTIALS)
    token = client.post("/api/auth/login", json=CREDENTIALS).json()["token"]

    with Session(engine) as session:
        record = session.exec(select(AuthToken)).one()

    assert record.token_hash != token
    assert token not in record.token_hash


def test_token_lifetime_comes_from_settings(
    client: TestClient, engine: Engine, use_settings: Callable[..., None]
) -> None:
    """POCKET_TOKEN_LIFETIME_DAYS decides when a session ends."""
    use_settings(token_lifetime_days=2)
    client.post("/api/auth/register", json=CREDENTIALS)
    client.post("/api/auth/login", json=CREDENTIALS)

    with Session(engine) as session:
        record = session.exec(select(AuthToken)).one()

    assert timedelta(days=1, hours=23) < record.expires_at - utc_now() <= timedelta(days=2)


def test_logout_revokes_the_token(
    client: TestClient, register_and_login: Callable[[str], dict[str, str]]
) -> None:
    """After logout, the same token no longer works."""
    headers = register_and_login("anna")

    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_expired_token_is_rejected_and_removed(
    client: TestClient, engine: Engine, register_and_login: Callable[[str], dict[str, str]]
) -> None:
    """An expired session stops working and its row is cleaned up."""
    headers = register_and_login("anna")
    with Session(engine) as session:
        record = session.exec(select(AuthToken)).one()
        record.expires_at = utc_now() - timedelta(seconds=1)
        session.add(record)
        session.commit()

    response = client.get("/api/auth/me", headers=headers)

    assert response.status_code == 401
    with Session(engine) as session:
        assert session.exec(select(AuthToken)).first() is None


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer pkt_not-a-real-token"},
        {"Authorization": "Bearer something-else"},
    ],
)
def test_me_rejects_missing_or_unknown_tokens(client: TestClient, headers: dict[str, str]) -> None:
    """Protected endpoints answer 401 and name the expected scheme."""
    response = client.get("/api/auth/me", headers=headers)

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_auth_config_without_keycloak(client: TestClient, use_settings) -> None:
    """Clients can see that only local accounts are available."""
    use_settings(oidc_issuer="", oidc_client_id="")

    assert client.get("/api/auth/config").json() == {"registrationEnabled": True, "oidc": None}


def test_database_enforces_foreign_keys(engine: Engine) -> None:
    """A token cannot point at a user who does not exist."""
    with Session(engine) as session:
        session.add(AuthToken(user_id=new_id(), token_hash="hash", expires_at=utc_now()))
        with pytest.raises(IntegrityError):
            session.commit()


def test_deleting_a_user_deletes_their_tokens(
    engine: Engine, register_and_login: Callable[[str], dict[str, str]]
) -> None:
    """`ON DELETE CASCADE` removes dependent rows at the database level."""
    register_and_login("anna")

    with Session(engine) as session:
        # A direct statement, so the cascade is done by the database itself.
        session.connection().exec_driver_sql("DELETE FROM users")
        session.commit()
        assert session.exec(select(AuthToken)).first() is None
