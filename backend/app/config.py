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

    @property
    def oidc_enabled(self) -> bool:
        """Return whether Keycloak login is configured."""
        return bool(self.oidc_issuer and self.oidc_client_id)

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
