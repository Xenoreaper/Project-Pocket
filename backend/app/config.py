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
