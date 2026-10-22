"""
Tests for the settings loader.

These tests prove that configuration really comes from the environment and
that the CORS string is split correctly. They never read the developer's local
.env (we pass `_env_file=None`), so results are reproducible.
"""

from app.config import Settings


def test_defaults_are_development_safe() -> None:
    """Without any environment variables the app runs locally with SQLite."""
    settings = Settings(_env_file=None)

    assert settings.environment == "development"
    assert settings.database_url.startswith("sqlite:///")
    assert settings.app_version == "0.1.0"


def test_environment_variables_override_defaults(monkeypatch) -> None:
    """POCKET_* variables take precedence over the built-in defaults."""
    monkeypatch.setenv("POCKET_APP_VERSION", "9.9.9")
    monkeypatch.setenv("POCKET_ENVIRONMENT", "test")

    settings = Settings(_env_file=None)

    assert settings.app_version == "9.9.9"
    assert settings.environment == "test"


def test_cors_origins_are_split_and_trimmed() -> None:
    """Comma-separated origins become a clean list for the middleware."""
    settings = Settings(
        _env_file=None,
        cors_origins="http://localhost:5173, http://localhost:3000,",
    )

    assert settings.cors_origin_list == [
        "http://localhost:5173",
        "http://localhost:3000",
    ]
