"""
Tests that the Alembic migrations match the models.

A hand-written migration can drift from `app/models.py` without any other test
noticing, because the other tests create their tables directly from the models.
Alembic runs in its own process here because its setup reads the database URL when
the app is imported.
"""

import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def run_alembic(database_file: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    """
    Run an Alembic command against a temporary database.

    Args:
        database_file: where the SQLite file lives.
        *arguments: the Alembic command, e.g. "upgrade", "head".

    Returns:
        The finished process, including its output for failure messages.
    """
    return subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=BACKEND_DIR,
        env={**os.environ, "POCKET_DATABASE_URL": f"sqlite:///{database_file}"},
        capture_output=True,
        text=True,
        check=False,
    )


def test_migrations_produce_the_model_schema(tmp_path: Path) -> None:
    """After `upgrade head`, Alembic finds no difference to the models."""
    database = tmp_path / "migrated.db"

    upgrade = run_alembic(database, "upgrade", "head")
    check = run_alembic(database, "check")

    assert upgrade.returncode == 0, upgrade.stderr
    assert check.returncode == 0, check.stdout + check.stderr


def test_migrations_can_be_rolled_back(tmp_path: Path) -> None:
    """Downgrading to the start and upgrading again both succeed."""
    database = tmp_path / "rollback.db"

    results = [
        run_alembic(database, "upgrade", "head"),
        run_alembic(database, "downgrade", "base"),
        run_alembic(database, "upgrade", "head"),
    ]

    for result in results:
        assert result.returncode == 0, result.stderr
