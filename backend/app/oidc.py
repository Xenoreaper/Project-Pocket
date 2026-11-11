"""
Verification of Keycloak access tokens (OpenID Connect).

With Keycloak, the browser logs in on Keycloak's own page and receives a signed
JSON Web Token (JWT). The backend never sees the password: it only checks that
the token was signed by the configured Keycloak, is still valid, and was issued
for Project Pocket. The check works offline except for fetching Keycloak's public
keys, which PyJWT caches.
"""

from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWTError

from app.config import Settings, get_settings


class InvalidOidcTokenError(Exception):
    """The token is forged, expired or meant for another application."""


class OidcUnavailableError(Exception):
    """Keycloak's keys could not be fetched, so the token cannot be judged."""


@dataclass(frozen=True)
class OidcIdentity:
    """The verified facts about a Keycloak user that the backend needs."""

    issuer: str
    subject: str
    display_name: str


class OidcVerifier:
    """
    Check Keycloak access tokens for one issuer and one client.

    Args:
        issuer: expected `iss` claim, compared exactly.
        client_id: the Keycloak client that web app and extension log in through.
        key_resolver: returns the public key for a token. Production asks Keycloak;
            tests pass a local key, so they need no network.
    """

    def __init__(self, issuer: str, client_id: str, key_resolver: Callable[[str], Any]) -> None:
        self._issuer = issuer
        self._client_id = client_id
        self._key_resolver = key_resolver

    def verify(self, token: str) -> OidcIdentity:
        """
        Validate a token and return who it belongs to.

        Args:
            token: the raw bearer token from the request.

        Returns:
            The identity from the verified token.

        Raises:
            InvalidOidcTokenError: the token must be rejected.
            OidcUnavailableError: Keycloak could not be reached for its keys.
        """
        try:
            key = self._key_resolver(token)
            claims = jwt.decode(
                token,
                key,
                # A fixed list stops an attacker from choosing a weaker algorithm
                # in the token's own header. RS256 is Keycloak's default.
                algorithms=["RS256"],
                issuer=self._issuer,
                options={
                    "require": ["exp", "iss", "sub"],
                    # Keycloak access tokens usually carry aud="account", so the
                    # client is checked by hand in `_is_for_this_client`.
                    "verify_aud": False,
                },
            )
        except PyJWKClientConnectionError as error:
            raise OidcUnavailableError("Could not fetch Keycloak's signing keys.") from error
        except PyJWTError as error:
            raise InvalidOidcTokenError("The token is not valid.") from error

        # Keycloak marks its token kinds in `typ`. ID tokens are signed the same
        # way, but they are meant for reading, not for calling an API.
        if claims.get("typ", "Bearer") != "Bearer":
            raise InvalidOidcTokenError("This is not an access token.")
        if not self._is_for_this_client(claims):
            raise InvalidOidcTokenError("The token was issued for another application.")

        return OidcIdentity(
            issuer=claims["iss"],
            subject=claims["sub"],
            display_name=claims.get("preferred_username") or claims["sub"],
        )

    def _is_for_this_client(self, claims: dict[str, Any]) -> bool:
        """
        Check that a token belongs to Project Pocket.

        Without this, a token from any other application in the same Keycloak
        realm would also open the user's pocket. `azp` names the client that
        requested the token; `aud` is set instead if an audience mapper is used.
        """
        audience = claims.get("aud", [])
        audiences = [audience] if isinstance(audience, str) else audience
        return claims.get("azp") == self._client_id or self._client_id in audiences


@lru_cache
def _build_verifier(issuer: str, client_id: str, jwks_url: str) -> OidcVerifier:
    """
    Create one verifier per configuration.

    The cache keeps the same `PyJWKClient` alive between requests. A new client
    for each request would fetch Keycloak's keys every time.
    """
    # The timeout stops a hanging Keycloak from blocking requests indefinitely.
    client = PyJWKClient(jwks_url, timeout=5)
    return OidcVerifier(issuer, client_id, lambda token: client.get_signing_key_from_jwt(token).key)


def get_oidc_verifier(
    settings: Annotated[Settings, Depends(get_settings)],
) -> OidcVerifier | None:
    """
    FastAPI dependency that provides the verifier, or None if Keycloak is off.

    Tests replace this function through `app.dependency_overrides`.
    """
    if not settings.oidc_enabled:
        return None
    return _build_verifier(
        settings.oidc_issuer_normalized,
        settings.oidc_client_id,
        settings.oidc_jwks_endpoint,
    )
