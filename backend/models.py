from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from datetime import datetime, timezone
from database import Base


class AutoTagRule(Base):
    __tablename__ = "auto_tag_rules"

    id = Column(Integer, primary_key=True, index=True)
    # What to match against: domain | url_contains | title_contains
    match_type = Column(String, nullable=False)
    pattern = Column(String, nullable=False)   # e.g. "youtube.com"
    tags = Column(String, nullable=False)       # comma-separated tags to apply


class Page(Base):
    __tablename__ = "pages"

    id = Column(Integer, primary_key=True, index=True)
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
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
