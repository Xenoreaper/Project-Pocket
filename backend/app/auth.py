"""
Authentication: password hashing, login tokens and "who is calling?".

Two kinds of bearer token reach the API in the same `Authorization` header:
- local tokens, random strings this backend issued, starting with `pkt_`;
- Keycloak tokens, signed JWTs, accepted only if Keycloak is configured.

`get_current_user` hides that difference, so an endpoint just declares a
`CurrentUser` parameter and works with both.
"""

import hashlib
import secrets
from datetime import timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, InvalidHashError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db import get_session
from app.models import AuthToken, User, utc_now
from app.oidc import (
    InvalidOidcTokenError,
    OidcIdentity,
    OidcUnavailableError,
    OidcVerifier,
    get_oidc_verifier,
)

LOCAL_TOKEN_PREFIX = "pkt_"

_password_hasher = PasswordHasher()
# Compared when a username does not exist, so that case takes as long as a wrong
# password. Otherwise response times would reveal which usernames exist.
_DUMMY_PASSWORD_HASH = _password_hasher.hash("placeholder-for-unknown-users")

# `auto_error=False` lets us answer with our own 401. Declaring HTTPBearer also
# adds the "Authorize" button to the API docs at /docs.
_bearer_scheme = HTTPBearer(auto_error=False)

BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)]
SessionDep = Annotated[Session, Depends(get_session)]


def hash_password(password: str) -> str:
    """Return an Argon2id hash; it includes its own random salt and settings."""
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """
    Check a password in roughly constant time, even if the user has no password.

    Args:
        password: what the user typed.
        password_hash: stored hash, or None for an unknown or Keycloak user.

    Returns:
        True only if a real hash exists and the password matches it.
    """
    try:
        matches = _password_hasher.verify(password_hash or _DUMMY_PASSWORD_HASH, password)
    except (Argon2Error, InvalidHashError):
        return False
    return matches and password_hash is not None


def _hash_token(token: str) -> str:
    """
    Hash a login token for storage or lookup.

    Plain SHA-256 is enough here, unlike for passwords: a token is 256 random
    bits, so there is nothing to guess, and lookups stay fast.
    """
    return hashlib.sha256(token.encode()).hexdigest()


def create_login_token(session: Session, user: User, lifetime_days: int) -> tuple[str, AuthToken]:
    """
    Create a login session for a local account.

    Args:
        session: database session; this function commits.
        user: the user who just logged in.
        lifetime_days: how long the token stays valid.

    Returns:
        The raw token, which exists only in this response, and its database row.
    """
    raw_token = f"{LOCAL_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
    record = AuthToken(
        user_id=user.id,
        token_hash=_hash_token(raw_token),
        expires_at=utc_now() + timedelta(days=lifetime_days),
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return raw_token, record


def revoke_login_token(session: Session, raw_token: str) -> None:
    """Delete a local login session; unknown tokens are ignored."""
    record = session.exec(
        select(AuthToken).where(AuthToken.token_hash == _hash_token(raw_token))
    ).first()
    if record is not None:
        session.delete(record)
        session.commit()


def _unauthorized(detail: str = "Not authenticated.") -> HTTPException:
    """Build a 401 response; the header is required by the HTTP standard."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _user_from_local_token(session: Session, raw_token: str) -> User:
    """
    Find the user of a local token.

    Raises:
        HTTPException: 401 if the token is unknown or expired.
    """
    record = session.exec(
        select(AuthToken).where(AuthToken.token_hash == _hash_token(raw_token))
    ).first()
    if record is None:
        raise _unauthorized()
    if record.expires_at <= utc_now():
        # Expired sessions can never be used again, so this is a good moment to
        # remove them.
        session.delete(record)
        session.commit()
        raise _unauthorized("The session has expired.")

    user = session.get(User, record.user_id)
    if user is None:
        raise _unauthorized()
    return user


def _find_oidc_user(session: Session, identity: OidcIdentity) -> User | None:
    """Look up the user for a verified Keycloak identity."""
    return session.exec(
        select(User).where(
            User.oidc_issuer == identity.issuer,
            User.oidc_subject == identity.subject,
        )
    ).first()


def _get_or_create_oidc_user(session: Session, identity: OidcIdentity) -> User:
    """
    Return the user for a Keycloak identity, creating them on their first visit.

    This does not depend on `POCKET_ALLOW_REGISTRATION`, because Keycloak already
    decides who has an account.
    """
    user = _find_oidc_user(session, identity)
    if user is not None:
        return user

    user = User(
        oidc_issuer=identity.issuer,
        oidc_subject=identity.subject,
        display_name=identity.display_name,
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        # Two first requests can arrive at once. The unique constraint lets only
        # one insert succeed, so the other one uses the row that now exists.
        session.rollback()
        existing = _find_oidc_user(session, identity)
        if existing is None:
            raise
        return existing
    session.refresh(user)
    return user


def get_current_user(
    credentials: BearerCredentials,
    session: SessionDep,
    oidc_verifier: Annotated[OidcVerifier | None, Depends(get_oidc_verifier)],
) -> User:
    """
    FastAPI dependency that resolves the bearer token to a user.

    FastAPI calls this before the endpoint. If it raises, the endpoint never runs.

    Returns:
        The authenticated user.

    Raises:
        HTTPException: 401 for a missing or invalid token, 503 if Keycloak's keys
            are unreachable. A 503 tells clients to retry instead of logging out.
    """
    if credentials is None:
        raise _unauthorized()

    token = credentials.credentials
    if token.startswith(LOCAL_TOKEN_PREFIX):
        return _user_from_local_token(session, token)
    if oidc_verifier is None:
        raise _unauthorized()

    try:
        identity = oidc_verifier.verify(token)
    except InvalidOidcTokenError as error:
        raise _unauthorized() from error
    except OidcUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The login service is currently unavailable.",
        ) from error
    return _get_or_create_oidc_user(session, identity)


CurrentUser = Annotated[User, Depends(get_current_user)]
