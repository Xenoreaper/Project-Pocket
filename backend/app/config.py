"""
Application settings.

All configuration comes from environment variables (12-factor style) and is
validated by pydantic-settings. Every variable uses the `POCKET_` prefix, e.g.
`POCKET_DATABASE_URL`. Defaults are safe for local development; production
values are injected by docker-compose (see .env.example).

No secrets are hard-coded. When API keys are added later, they belong in the
git-ignored `.env` file only.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app import __version__


class Settings(BaseSettings):
    """
    Typed view of the backend configuration.

    Pydantic reads the attributes below from environment variables and casts
    them to the declared type (so `POCKET_ENVIRONMENT=production` becomes a
    string, a truthy env value would become a bool, and so on).
    """

    # `env_prefix` means a field named `database_url` is filled from
    # POCKET_DATABASE_URL. `env_file` also reads a local `.env` file, which is
    # convenient when running the backend outside Docker.
    model_config = SettingsConfigDict(
        env_prefix="POCKET_",
        env_file=".env",
        env_file_encoding="utf-8",
        # Ignore unrelated variables in .env (e.g. WEB_PORT used by Compose).
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "Project Pocket"
    app_version: str = __version__
    environment: str = "development"

    # SQLite by default: zero setup for development. Docker overrides this
    # with an absolute path inside the mounted data volume.
    database_url: str = "sqlite:///./data/pocket.db"

    # Comma-separated list, parsed by `cors_origin_list`. A string (instead of
    # a list) keeps .env files readable and avoids JSON-in-env quoting.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Local accounts. Closing registration matters on a publicly reachable
    # server; it does not affect existing accounts or Keycloak users.
    allow_registration: bool = True
    # `ge=1` rejects a zero or negative lifetime when the app starts.
    token_lifetime_days: int = Field(default=30, ge=1)

    # Optional Keycloak login. Leaving both values empty disables it.
    # Issuer example: http://localhost:8080/realms/pocket
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    # Only needed when the backend reaches Keycloak under another address than
    # the browser does, e.g. inside Docker, where "localhost" is the container.
    oidc_jwks_url: str = ""

    # Which external directory users log in with. "keycloak" is the default and
    # only takes effect once the OIDC values above are set; until then Pocket
    # uses its own local accounts. "ldap" replaces both: every login is checked
    # against the LDAP server below. `Literal` rejects any other value at startup.
    auth_provider: Literal["keycloak", "ldap"] = "keycloak"

    # LDAP login (only read when auth_provider is "ldap").
    # Example: ldaps://ldap.example.org:636
    ldap_url: str = ""
    # Encrypt a plain ldap:// connection with StartTLS before sending passwords.
    ldap_start_tls: bool = False
    # Service account used to look a user up. Empty means an anonymous search.
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""  # SECRET: only in .env, never in the repo
    # Where users live, e.g. ou=people,dc=example,dc=org
    ldap_user_base_dn: str = ""
    # How to find a user; {username} is replaced with the escaped login name.
    ldap_user_filter: str = "(uid={username})"
    # Attribute that identifies a user for good. `uid` works everywhere; a
    # rename-proof choice is entryUUID (OpenLDAP) or objectGUID (Active Directory).
    ldap_id_attribute: str = "uid"
    ldap_display_name_attribute: str = "cn"

    @model_validator(mode="after")
    def _check_oidc_settings(self) -> "Settings":
        """
        Refuse half-finished Keycloak settings when the app starts.

        Without this check, a forgotten client ID would silently turn Keycloak
        login off, and the mistake would only show up as failing logins.
        """
        if bool(self.oidc_issuer) != bool(self.oidc_client_id):
            raise ValueError("Set POCKET_OIDC_ISSUER and POCKET_OIDC_CLIENT_ID together.")
        return self

    @model_validator(mode="after")
    def _check_ldap_settings(self) -> "Settings":
        """
        Refuse an LDAP setup that cannot work, when the app starts.

        Choosing LDAP without a server would otherwise leave nobody able to log
        in, and a filter without the placeholder would match the same entry for
        every login name.
        """
        if self.auth_provider != "ldap":
            return self
        if not self.ldap_url or not self.ldap_user_base_dn:
            raise ValueError(
                "POCKET_AUTH_PROVIDER=ldap needs POCKET_LDAP_URL and POCKET_LDAP_USER_BASE_DN."
            )
        if "{username}" not in self.ldap_user_filter:
            raise ValueError("POCKET_LDAP_USER_FILTER must contain {username}.")
        if bool(self.ldap_bind_dn) != bool(self.ldap_bind_password):
            raise ValueError("Set POCKET_LDAP_BIND_DN and POCKET_LDAP_BIND_PASSWORD together.")
        return self

    @property
    def ldap_enabled(self) -> bool:
        """Return whether logins are checked against LDAP."""
        return self.auth_provider == "ldap"

    @property
    def oidc_enabled(self) -> bool:
        """Return whether Keycloak login is configured and selected."""
        return self.auth_provider == "keycloak" and bool(self.oidc_issuer and self.oidc_client_id)

    @property
    def active_auth_provider(self) -> Literal["local", "keycloak", "ldap"]:
        """Return what clients should offer: "local" means Pocket's own accounts only."""
        if self.ldap_enabled:
            return "ldap"
        return "keycloak" if self.oidc_enabled else "local"

    @property
    def oidc_issuer_normalized(self) -> str:
        """
        Return the issuer without a trailing slash.

        Keycloak writes the issuer into every token without one, and the check
        compares the exact string.
        """
        return self.oidc_issuer.rstrip("/")

    @property
    def oidc_jwks_endpoint(self) -> str:
        """Return the URL of Keycloak's public signing keys (JWKS)."""
        return self.oidc_jwks_url or f"{self.oidc_issuer_normalized}/protocol/openid-connect/certs"

    @property
    def cors_origin_list(self) -> list[str]:
        """
        Split `cors_origins` into a clean list for FastAPI's CORS middleware.

        Empty entries (e.g. from a trailing comma) are dropped so a typo in
        .env does not produce an invalid origin.
        """
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """
    Return the process-wide settings object.

    `lru_cache` makes this a cheap singleton: environment variables are read
    once, and tests can call `get_settings.cache_clear()` after changing them.
    """
    return Settings()
