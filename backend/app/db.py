"""
Database engine and session handling.

SQLModel wraps SQLAlchemy, so this file is deliberately small: one engine per
process and one short-lived session per request. The first real models (Page,
User, …) arrive in the next milestone; Alembic already points at
`SQLModel.metadata` so they will be picked up automatically.
"""

from collections.abc import Generator
from pathlib import Path

from sqlmodel import Session, create_engine

from app.config import get_settings


def _ensure_sqlite_parent_directory(database_url: str) -> None:
    """
    Create the folder for a SQLite database file if it does not exist.

    SQLite creates the *file* itself but not missing directories. Docker mounts
    `/app/data` as a volume, and locally `./data` may not exist yet.
    Non-SQLite URLs (e.g. PostgreSQL later) are ignored.
    """
    if not database_url.startswith("sqlite:///"):
        return

    # "sqlite:///./data/pocket.db" -> "./data/pocket.db"
    # "sqlite:////app/data/pocket.db" -> "/app/data/pocket.db"
    raw_path = database_url.removeprefix("sqlite:///")
    if raw_path in {"", ":memory:"}:
        return

    Path(raw_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


_settings = get_settings()
_ensure_sqlite_parent_directory(_settings.database_url)

# `check_same_thread=False` is required because FastAPI may serve one request
# on a different thread than the one that opened the SQLite connection.
# It is safe here because each request gets its own session.
engine = create_engine(
    _settings.database_url,
    # SQLite only: allow the connection to be used from a different thread.
    connect_args={"check_same_thread": False}
    if _settings.database_url.startswith("sqlite")
    else {},
)


def get_session() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a database session.

    The `with` block closes the session even if the endpoint raises, so
    connections cannot leak. Usage in an endpoint:

        def endpoint(session: Session = Depends(get_session)): ...
    """
    with Session(engine) as session:
        yield session
