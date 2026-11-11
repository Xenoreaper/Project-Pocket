"""
Tests for Keycloak login.

No Keycloak runs here. The tests generate their own RSA key pair and sign tokens
the way Keycloak does, so all checks run locally and without a network.
"""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jwt.exceptions import PyJWKClientConnectionError
from pydantic import ValidationError
from sqlalchemy import Engine
from sqlmodel import Session, select

from app.config import Settings
from app.models import User
from app.oidc import OidcVerifier, get_oidc_verifier

ISSUER = "http://keycloak.test/realms/pocket"
CLIENT_ID = "project-pocket"


@pytest.fixture(scope="module")
def signing_key() -> RSAPrivateKey:
    """Create the key pair once per file, because RSA generation is slow."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def oidc_app(app: FastAPI, signing_key: RSAPrivateKey) -> FastAPI:
    """Give the app a verifier that trusts the test key instead of a real Keycloak."""
    public_key = signing_key.public_key()
    verifier = OidcVerifier(ISSUER, CLIENT_ID, lambda _token: public_key)
    app.dependency_overrides[get_oidc_verifier] = lambda: verifier
    return app


@pytest.fixture
def oidc_client(oidc_app: FastAPI) -> TestClient:
    """Return an HTTP client for the Keycloak-enabled app."""
    return TestClient(oidc_app)


def make_token(key: RSAPrivateKey, algorithm: str = "RS256", **overrides: Any) -> str:
    """
    Sign a token with the claims of a typical Keycloak access token.

    Args:
        key: the signing key.
        algorithm: the signature algorithm.
        **overrides: claims to replace; a value of None removes that claim.

    Returns:
        The encoded token.
    """
    claims: dict[str, Any] = {
        "iss": ISSUER,
        "sub": "keycloak-user-1",
        "aud": "account",
        "azp": CLIENT_ID,
        "typ": "Bearer",
        "preferred_username": "kim",
        "exp": datetime.now(UTC) + timedelta(minutes=5),
    }
    claims.update(overrides)
    claims = {name: value for name, value in claims.items() if value is not None}
    return jwt.encode(claims, key, algorithm=algorithm)


def bearer(token: str) -> dict[str, str]:
    """Build the auth header for a token."""
    return {"Authorization": f"Bearer {token}"}


def test_valid_token_creates_the_user_once(
    oidc_client: TestClient, signing_key: RSAPrivateKey, engine: Engine
) -> None:
    """The first request creates the account and later ones reuse it."""
    headers = bearer(make_token(signing_key))

    first = oidc_client.get("/api/auth/me", headers=headers)
    second = oidc_client.get("/api/auth/me", headers=headers)

    assert first.status_code == 200
    assert first.json()["displayName"] == "kim"
    assert first.json()["id"] == second.json()["id"]
    with Session(engine) as session:
        user = session.exec(select(User)).one()
    assert (user.oidc_issuer, user.oidc_subject) == (ISSUER, "keycloak-user-1")
    assert user.password_hash is None


def test_token_with_client_in_audience_is_accepted(
    oidc_client: TestClient, signing_key: RSAPrivateKey
) -> None:
    """An audience mapper puts the client into `aud` instead of `azp`."""
    token = make_token(signing_key, azp="other", aud=["account", CLIENT_ID])

    assert oidc_client.get("/api/auth/me", headers=bearer(token)).status_code == 200


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"exp": datetime(2020, 1, 1, tzinfo=UTC)}, id="expired"),
        pytest.param({"exp": None}, id="no-expiry"),
        pytest.param({"iss": "http://evil.test/realms/pocket"}, id="other-issuer"),
        pytest.param({"sub": None}, id="no-subject"),
        pytest.param({"azp": "other-app", "aud": "account"}, id="other-client"),
        pytest.param({"typ": "ID"}, id="id-token"),
    ],
)
def test_invalid_claims_are_rejected(
    oidc_client: TestClient, signing_key: RSAPrivateKey, overrides: dict[str, Any], engine: Engine
) -> None:
    """Each broken claim alone is enough to refuse the token and create no user."""
    token = make_token(signing_key, **overrides)

    assert oidc_client.get("/api/auth/me", headers=bearer(token)).status_code == 401
    with Session(engine) as session:
        assert session.exec(select(User)).first() is None


def test_token_signed_with_another_key_is_rejected(oidc_client: TestClient) -> None:
    """A forged token with otherwise perfect claims must fail."""
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    assert oidc_client.get("/api/auth/me", headers=bearer(make_token(other_key))).status_code == 401


def test_token_with_a_shared_secret_algorithm_is_rejected(oidc_client: TestClient) -> None:
    """Only RS256 is allowed, so an attacker cannot pick an HMAC algorithm."""
    token = jwt.encode(
        {
            "iss": ISSUER,
            "sub": "x",
            "azp": CLIENT_ID,
            "exp": datetime.now(UTC) + timedelta(hours=1),
        },
        "a-guessable-shared-secret-of-sufficient-length",
        algorithm="HS256",
    )

    assert oidc_client.get("/api/auth/me", headers=bearer(token)).status_code == 401


def test_malformed_token_is_rejected(oidc_client: TestClient) -> None:
    """A token that is not a JWT is an ordinary authentication failure."""
    assert oidc_client.get("/api/auth/me", headers=bearer("not-a-jwt")).status_code == 401


def test_keycloak_token_is_rejected_when_keycloak_is_off(
    client: TestClient, signing_key: RSAPrivateKey, use_settings: Callable[..., None]
) -> None:
    """Without configuration, the backend trusts no external tokens."""
    use_settings(oidc_issuer="", oidc_client_id="")

    assert client.get("/api/auth/me", headers=bearer(make_token(signing_key))).status_code == 401


def test_unreachable_keycloak_returns_503(
    app: FastAPI, client: TestClient, signing_key: RSAPrivateKey
) -> None:
    """An outage says "try again later", so clients do not log the user out."""

    def failing_resolver(_token: str) -> Any:
        raise PyJWKClientConnectionError("connection refused")

    verifier = OidcVerifier(ISSUER, CLIENT_ID, failing_resolver)
    app.dependency_overrides[get_oidc_verifier] = lambda: verifier

    response = client.get("/api/auth/me", headers=bearer(make_token(signing_key)))

    assert response.status_code == 503


def test_keycloak_user_and_same_named_local_user_stay_separate(
    oidc_client: TestClient,
    signing_key: RSAPrivateKey,
    register_and_login: Callable[[str], dict[str, str]],
) -> None:
    """Equal names must not link accounts, or one could take over the other."""
    local_headers = register_and_login("kim")

    local = oidc_client.get("/api/auth/me", headers=local_headers)
    keycloak = oidc_client.get("/api/auth/me", headers=bearer(make_token(signing_key)))

    assert local.json()["id"] != keycloak.json()["id"]


def test_keycloak_user_cannot_log_in_with_a_password(
    oidc_client: TestClient, signing_key: RSAPrivateKey
) -> None:
    """A Keycloak account has no password and no local username."""
    oidc_client.get("/api/auth/me", headers=bearer(make_token(signing_key)))

    response = oidc_client.post(
        "/api/auth/login", json={"username": "kim", "password": "correct-horse-battery"}
    )

    assert response.status_code == 401


def test_keycloak_user_can_log_out_without_error(
    oidc_client: TestClient, signing_key: RSAPrivateKey
) -> None:
    """Logout is harmless here; the session itself ends at Keycloak."""
    response = oidc_client.post("/api/auth/logout", headers=bearer(make_token(signing_key)))

    assert response.status_code == 204


def test_auth_config_announces_keycloak(
    client: TestClient, use_settings: Callable[..., None]
) -> None:
    """Clients learn the issuer and client ID, with no trailing slash."""
    use_settings(oidc_issuer=f"{ISSUER}/", oidc_client_id=CLIENT_ID)

    assert client.get("/api/auth/config").json()["oidc"] == {
        "issuer": ISSUER,
        "clientId": CLIENT_ID,
    }


@pytest.mark.parametrize(
    "values",
    [{"oidc_issuer": ISSUER, "oidc_client_id": ""}, {"oidc_issuer": "", "oidc_client_id": "x"}],
)
def test_half_configured_keycloak_fails_at_startup(values: dict[str, str]) -> None:
    """A forgotten value is an error, not a silently disabled login."""
    with pytest.raises(ValidationError):
        Settings(**values)


def test_jwks_endpoint_can_be_overridden() -> None:
    """Inside Docker, the backend fetches keys under an internal address."""
    derived = Settings(oidc_issuer=ISSUER, oidc_client_id=CLIENT_ID)
    overridden = Settings(
        oidc_issuer=ISSUER,
        oidc_client_id=CLIENT_ID,
        oidc_jwks_url="http://keycloak:8080/realms/pocket/protocol/openid-connect/certs",
    )

    assert derived.oidc_jwks_endpoint == f"{ISSUER}/protocol/openid-connect/certs"
    assert overridden.oidc_jwks_endpoint.startswith("http://keycloak:8080/")
