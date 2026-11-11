"""
Account endpoints under /api/auth.

Register, login and logout serve local accounts. A Keycloak user never calls
register or login, because they log in on Keycloak's page. `GET /config` tells
clients which login options this server offers.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.api.schemas import ApiModel
from app.auth import (
    LOCAL_TOKEN_PREFIX,
    BearerCredentials,
    CurrentUser,
    SessionDep,
    create_login_token,
    hash_password,
    revoke_login_token,
    verify_password,
)
from app.config import Settings, get_settings
from app.models import User, as_utc

router = APIRouter(prefix="/auth", tags=["auth"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


class OidcConfig(ApiModel):
    """What a client needs to start a Keycloak login."""

    issuer: str
    client_id: str


class AuthConfig(ApiModel):
    """The login options of this server."""

    registration_enabled: bool
    oidc: OidcConfig | None


class RegisterRequest(ApiModel):
    """Body of POST /api/auth/register."""

    # The pattern keeps names unambiguous, with no spaces or look-alike characters.
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    # The upper limit stops very long inputs from wasting hashing time.
    password: str = Field(min_length=8, max_length=256)


class LoginRequest(ApiModel):
    """Body of POST /api/auth/login."""

    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


class UserResponse(ApiModel):
    """Public view of a user. It never includes the password hash."""

    id: str
    display_name: str


class LoginResponse(ApiModel):
    """The login result. The client sends `token` as `Authorization: Bearer ...`."""

    token: str
    expires_at: datetime
    user: UserResponse


def _user_response(user: User) -> UserResponse:
    """Convert a database user to its public API shape."""
    return UserResponse(id=user.id, display_name=user.display_name)


@router.get("/config", response_model=AuthConfig, summary="Show the available login options")
def read_auth_config(settings: SettingsDep) -> AuthConfig:
    """Return the login options. Public, because clients need it before login."""
    oidc = (
        OidcConfig(issuer=settings.oidc_issuer_normalized, client_id=settings.oidc_client_id)
        if settings.oidc_enabled
        else None
    )
    return AuthConfig(registration_enabled=settings.allow_registration, oidc=oidc)


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a local account",
)
def register(body: RegisterRequest, session: SessionDep, settings: SettingsDep) -> UserResponse:
    """
    Create a local account.

    Raises:
        HTTPException: 403 if registration is closed, 409 if the name is taken.
    """
    if not settings.allow_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is closed on this server.")

    # Names are stored in lower case, so "Anna" and "anna" are the same account.
    username = body.username.lower()
    user = User(
        username=username,
        display_name=body.username,
        password_hash=hash_password(body.password),
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError as error:
        # Relying on the unique index, not a check beforehand, also covers two
        # simultaneous registrations of the same name.
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This username is taken.") from error
    session.refresh(user)
    return _user_response(user)


@router.post("/login", response_model=LoginResponse, summary="Log in with a local account")
def login(body: LoginRequest, session: SessionDep, settings: SettingsDep) -> LoginResponse:
    """
    Exchange a username and password for a login token.

    Raises:
        HTTPException: 401 with the same message for a wrong name or password, so
            the response does not reveal which usernames exist.
    """
    user = session.exec(select(User).where(User.username == body.username.lower())).first()
    if not verify_password(body.password, user.password_hash if user else None) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password.")

    token, record = create_login_token(session, user, settings.token_lifetime_days)
    return LoginResponse(
        token=token,
        expires_at=as_utc(record.expires_at),
        user=_user_response(user),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="End this login session")
def logout(credentials: BearerCredentials, _user: CurrentUser, session: SessionDep) -> None:
    """
    Revoke the local token used for this request.

    A Keycloak token cannot be revoked here. Those clients end the session at
    Keycloak instead, so nothing happens on this side.
    """
    if credentials is not None and credentials.credentials.startswith(LOCAL_TOKEN_PREFIX):
        revoke_login_token(session, credentials.credentials)


@router.get("/me", response_model=UserResponse, summary="Show the logged-in user")
def read_me(user: CurrentUser) -> UserResponse:
    """Return the logged-in user, which also shows that a token is still valid."""
    return _user_response(user)
