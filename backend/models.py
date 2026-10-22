from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from datetime import datetime, timezone
from database import Base


class AutoTagRule(Base):
    __tablename__ = "auto_tag_rules"

    id = Column(Integer, primary_key=True, index=True)
    owner = Column(String, index=True, nullable=False, default="default")
    profile = Column(String, index=True, nullable=False, default="default")
    # What to match against: domain | url_contains | title_contains
    match_type = Column(String, nullable=False)
    pattern = Column(String, nullable=False)   # e.g. "youtube.com"
    tags = Column(String, nullable=False)       # comma-separated tags to apply


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    is_disabled = Column(Boolean, default=False, nullable=False)
    sharing_enabled = Column(Boolean, default=True, nullable=False)
    force_password_change = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
 

class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    owner = Column(String, index=True, nullable=False)
    contact_username = Column(String, index=True, nullable=False)
    alias = Column(String, default="")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ContactRequest(Base):
    __tablename__ = "contact_requests"

    id = Column(Integer, primary_key=True, index=True)
    requester_username = Column(String, index=True, nullable=False)
    recipient_username = Column(String, index=True, nullable=False)
    message = Column(Text, default="")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, index=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_used_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class UserShareBlock(Base):
    __tablename__ = "user_share_blocks"

    id = Column(Integer, primary_key=True, index=True)
    blocker_username = Column(String, index=True, nullable=False)
    blocked_username = Column(String, index=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Page(Base):
    __tablename__ = "pages"

    id = Column(Integer, primary_key=True, index=True)
    owner = Column(String, index=True, nullable=False, default="default")
    profile = Column(String, index=True, nullable=False, default="default")
    url = Column(String, nullable=False)
    title = Column(String, nullable=False, default="")
    description = Column(Text, default="")
    domain = Column(String, index=True, default="")
    tags = Column(String, default="")           # comma-separated
    is_recipe = Column(Boolean, default=False)
    is_music = Column(Boolean, default=False)
    recipe_ingredients = Column(Text, default="")
    recipe_instructions = Column(Text, default="")
    favicon = Column(String, default="")
    notes = Column(Text, default="")
    device = Column(String, default="")   # e.g. "Chrome on macOS"
    saved_via = Column(String, default="")  # "web" or "extension"
    resave_count = Column(Integer, nullable=False, default=0)
    is_shared_received = Column(Boolean, default=False, nullable=False)
    is_shared_sent = Column(Boolean, default=False, nullable=False)
    shared_by = Column(String, default="")
    shared_to = Column(String, default="")
    share_status = Column(String, default="accepted")  # "pending", "accepted", or "declined"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
