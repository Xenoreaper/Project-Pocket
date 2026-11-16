"""
Account endpoints under /api/auth.

Register, login and logout serve local accounts. In LDAP mode, login checks the
password against the LDAP directory instead and registration is closed. A
Keycloak user never calls register or login, because they log in on Keycloak's
page. `GET /config` tells clients which login options this server offers.
"""

from datetime import datetime
from typing import Annotated, Literal

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
    get_or_create_external_user,
    hash_password,
    revoke_login_token,
    verify_password,
)
from app.config import Settings, get_settings
from app.ldap import (
    InvalidLdapCredentialsError,
    LdapAuthenticator,
    LdapUnavailableError,
    get_ldap_authenticator,
)
from app.models import User, as_utc

router = APIRouter(prefix="/auth", tags=["auth"])

SettingsDep = Annotated[Settings, Depends(get_settings)]
LdapDep = Annotated[LdapAuthenticator | None, Depends(get_ldap_authenticator)]

_WRONG_LOGIN = "Wrong username or password."


class OidcConfig(ApiModel):
    """What a client needs to start a Keycloak login."""

    issuer: str
    client_id: str


class AuthConfig(ApiModel):
    """The login options of this server."""

    # "local": Pocket's own accounts only. "keycloak": the `oidc` login plus
    # local accounts. "ldap": the username/password form checks LDAP.
    provider: Literal["local", "keycloak", "ldap"]
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
    return AuthConfig(
        provider=settings.active_auth_provider,
        # In LDAP mode accounts are created in the directory, never in Pocket.
        registration_enabled=settings.allow_registration and not settings.ldap_enabled,
        oidc=oidc,
    )


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
    if settings.ldap_enabled:
        # A local account next to LDAP could claim a name that also exists in
        # the directory, so local accounts are switched off completely.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Accounts are managed in LDAP.")
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


def _login_with_ldap(
    body: LoginRequest, session: SessionDep, settings: Settings, ldap: LdapAuthenticator
) -> User:
    """
    Check a login against LDAP and return the matching Pocket user.

    Raises:
        HTTPException: 401 for a rejected login, 503 if LDAP cannot be reached.
            A 503 tells clients to try again later instead of asking for another
            password.
    """
    try:
        identity = ldap.authenticate(body.username, body.password)
    except InvalidLdapCredentialsError as error:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, _WRONG_LOGIN) from error
    except LdapUnavailableError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "The login service is currently unavailable."
        ) from error
    # The base DN names the directory, so users of two directories cannot collide.
    issuer = f"ldap:{settings.ldap_user_base_dn}"
    return get_or_create_external_user(session, issuer, identity.subject, identity.display_name)


@router.post("/login", response_model=LoginResponse, summary="Log in with username and password")
def login(
    body: LoginRequest, session: SessionDep, settings: SettingsDep, ldap: LdapDep
) -> LoginResponse:
    """
    Exchange a username and password for a login token.

    The password is checked against LDAP if the server uses it, otherwise against
    the local accounts. Both ways end with the same kind of token.

    Raises:
        HTTPException: 401 with the same message for a wrong name or password, so
            the response does not reveal which usernames exist.
    """
    if ldap is not None:
        user = _login_with_ldap(body, session, settings, ldap)
    else:
        user = session.exec(select(User).where(User.username == body.username.lower())).first()
        if not verify_password(body.password, user.password_hash if user else None) or user is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, _WRONG_LOGIN)

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
