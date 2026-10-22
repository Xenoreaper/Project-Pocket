"""
Initial migration (empty).

There are no tables yet, so this revision only creates Alembic's own
`alembic_version` table. It exists to prove the migration pipeline works and
to give the first real model migration a parent revision (`down_revision`).

Revision ID: 0001
Revises: None
Create Date: 2026-10-22
"""

from collections.abc import Sequence

# Revision identifiers used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply the schema change (none yet)."""


def downgrade() -> None:
    """Undo the schema change (none yet)."""
