from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class PageCreate(BaseModel):
    url: str
    title: Optional[str] = ""
    description: Optional[str] = ""
    tags: Optional[str] = ""
    is_recipe: Optional[bool] = False
    is_music: Optional[bool] = False
    notes: Optional[str] = ""
    device: Optional[str] = ""
    saved_via: Optional[str] = ""


class PageUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[str] = None
    is_recipe: Optional[bool] = None
    is_music: Optional[bool] = None
    notes: Optional[str] = None


class PageOut(BaseModel):
    id: int
    url: str
    title: str
    description: str
    domain: str
    tags: str
    is_recipe: bool
    is_music: bool
    recipe_ingredients: str
    recipe_instructions: str
    favicon: str
    notes: str
    device: str
    saved_via: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Auto-tag rules ────────────────────────────────────────────────────────────

class AutoTagRuleCreate(BaseModel):
    match_type: str   # "domain" | "url_contains" | "title_contains"
    pattern: str
    tags: str


class AutoTagRuleOut(BaseModel):
    id: int
    match_type: str
    pattern: str
    tags: str

    model_config = {"from_attributes": True}
