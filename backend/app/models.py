"""
Database tables.

Each class with `table=True` is one table. SQLModel combines SQLAlchemy (the
table definition) with Pydantic (typed attributes). Changing a table here also
needs an Alembic migration in `alembic/versions/`.

Timestamps are stored as naive UTC because SQLite drops time zones when it reads
a value back. `utc_now()` and `to_stored_utc()` create such values; `as_utc()`
restores the time zone before a value leaves the API. The columns use the type
`NaiveDatetime`, because SQLModel otherwise refuses values without a time zone.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import NaiveDatetime
from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def new_id() -> str:
    """Return a random UUID string as a primary key that reveals no row count."""
    return str(uuid4())


def utc_now() -> datetime:
    """Return the current time as naive UTC, the stored timestamp format."""
    return datetime.now(UTC).replace(tzinfo=None)


def to_stored_utc(value: datetime) -> datetime:
    """Convert a time-zone-aware datetime to naive UTC for storage."""
    return value.astimezone(UTC).replace(tzinfo=None)


def as_utc(value: datetime) -> datetime:
    """Mark a stored naive UTC datetime as UTC again."""
    return value.replace(tzinfo=UTC)


class User(SQLModel, table=True):
    """
    One person with their own pocket.

    A local account has `username` and `password_hash`. A Keycloak user has
    `oidc_issuer` and `oidc_subject` instead. The two kinds are never linked
    automatically: if they were, someone who registers a matching name in one
    system could take over the other person's pocket.
    """

    # "user" is a reserved word in some databases, so the table name is plural.
    __tablename__ = "users"
    # NULL values do not collide, so local accounts can all leave these empty.
    __table_args__ = (
        UniqueConstraint("oidc_issuer", "oidc_subject", name="uq_users_oidc_identity"),
    )

    id: str = Field(default_factory=new_id, primary_key=True)
    # Lower-case and unique for local accounts, empty for Keycloak users.
    username: str | None = Field(default=None, unique=True, index=True)
    password_hash: str | None = None
    # `sub` is Keycloak's stable user ID; its username can change.
    oidc_issuer: str | None = None
    oidc_subject: str | None = None
    display_name: str
    created_at: NaiveDatetime = Field(default_factory=utc_now)


class AuthToken(SQLModel, table=True):
    """
    A login session of a local account.

    Only a hash of the token is stored, so a leaked database backup contains no
    usable logins. Keycloak tokens never appear here; they prove themselves with
    their signature.
    """

    __tablename__ = "auth_tokens"

    id: str = Field(default_factory=new_id, primary_key=True)
    # `ondelete="CASCADE"`: deleting a user also deletes their sessions.
    user_id: str = Field(foreign_key="users.id", ondelete="CASCADE", index=True)
    token_hash: str = Field(unique=True, index=True)
    created_at: NaiveDatetime = Field(default_factory=utc_now)
    expires_at: NaiveDatetime


class SavedItem(SQLModel, table=True):
    """
    A page synced from the extension; mirrors `SavedPage` in `packages/shared`.

    Every query must filter by `user_id`, because that filter is what keeps each
    pocket private.
    """

    __tablename__ = "saved_items"
    # The same URL from two browsers is one item, but two users can both have it.
    __table_args__ = (UniqueConstraint("user_id", "url", name="uq_saved_items_user_url"),)

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="users.id", ondelete="CASCADE")
    url: str
    title: str
    favicon: str | None = None
    description: str | None = None
    site_name: str | None = None
    canonical_url: str | None = None
    lang: str | None = None
    category: str
    # Stored with the item because custom categories exist only in the extension.
    category_label: str
    # JSON columns, because `sa_column` tells SQLAlchemy the exact column type.
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    note: str = ""
    # Same JSON shape as `PageSnapshot`; the input for extraction in M3.
    snapshot: dict[str, Any] = Field(sa_column=Column(JSON, nullable=False))
    saved_at: NaiveDatetime
    updated_at: NaiveDatetime
    # When the server last accepted a newer version of this item.
    synced_at: NaiveDatetime = Field(default_factory=utc_now)
