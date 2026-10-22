"""
Alembic runtime configuration.

Alembic calls `run_migrations_online()` (or `_offline()` in --sql mode). We use
the application's own engine and `SQLModel.metadata`, so migrations always see
exactly the models the app sees.

When real models are added (e.g. app/models.py), import them *below* this
docstring so they register their tables in SQLModel.metadata before
`--autogenerate` runs. The import looks unused but has that side effect.
"""

from logging.config import fileConfig

from alembic import context
from sqlmodel import SQLModel

from app.config import get_settings

# Alembic reads the [loggers] section of alembic.ini and configures Python
# logging accordingly.
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Single source of truth for the database URL (env var or .env).
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)

# `target_metadata` is what --autogenerate compares the database against.
# Import models here (e.g. "from app import models") once they exist;
# otherwise Alembic would think every table was deleted.
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """
    Generate SQL without connecting to a database (`alembic upgrade --sql`).

    Useful for reviewing migrations or applying them by hand in production.
    """
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # SQLite needs batch mode to alter tables; see Alembic docs.
        render_as_batch=settings.database_url.startswith("sqlite"),
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Apply migrations by connecting with the app's engine.

    We reuse `app.db.engine` instead of creating a second engine, which keeps
    SQLite settings (check_same_thread) consistent.
    """
    from app.db import engine  # imported here so offline mode needs no engine

    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite cannot ALTER most columns; batch mode recreates the table.
            render_as_batch=settings.database_url.startswith("sqlite"),
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
