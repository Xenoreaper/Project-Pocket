from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class PageCreate(BaseModel):
    url: str
    title: Optional[str] = ""
    title_is_manual: Optional[bool] = False
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
    resave_count: int
    is_shared_received: bool
    is_shared_sent: bool
    shared_by: str
    shared_to: str
    share_status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PageShareIn(BaseModel):
    recipient_username: str
    recipient_profile: Optional[str] = None


class PageShareOut(BaseModel):
    page_id: int
    recipient_username: str
    recipient_profile: str
    created_recipient_page: bool


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


# ── Auth ─────────────────────────────────────────────────────────────────────

class AuthCredentials(BaseModel):
    username: str
    password: str


class AuthPasswordChangeIn(BaseModel):
    # Either supply plaintext current_password/new_password (legacy) OR the derived forms below.
    current_password: Optional[str] = None
    new_password: Optional[str] = None

    # Derived (client-side PBKDF2) fields — preferred to avoid sending plaintext over HTTP.
    # current_password_derived: hex digest of PBKDF2(current_password, stored_salt, iterations)
    current_password_derived: Optional[str] = None
    # new_password_salt: hex salt chosen by client (should be 16 bytes hex)
    new_password_salt: Optional[str] = None
    # new_password_derived: hex digest of PBKDF2(new_password, new_password_salt, iterations)
    new_password_derived: Optional[str] = None


class AuthForcedPasswordChangeIn(BaseModel):
    # Either supply plaintext new_password (legacy) OR the derived form below.
    new_password: Optional[str] = None
    # Client-generated salt (hex) and derived digest (hex) for new password
    new_password_salt: Optional[str] = None
    new_password_derived: Optional[str] = None


class AuthOut(BaseModel):
    token: str
    username: str


class AuthUserOut(BaseModel):
    username: str
    is_admin: bool
    is_disabled: bool = False
    sharing_enabled: bool = True
    force_password_change: bool = False


class UserOut(BaseModel):
    username: str
    is_admin: bool
    is_disabled: bool
    sharing_enabled: bool = True
    is_system_account: bool = False
    force_password_change: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    is_admin: Optional[bool] = None
    is_disabled: Optional[bool] = None
    sharing_enabled: Optional[bool] = None
    force_password_change: Optional[bool] = None


class AuthSharingPreferenceIn(BaseModel):
    sharing_enabled: bool


class AuthShareBlockIn(BaseModel):
    username: str


class AuthShareBlockOut(BaseModel):
    username: str
    created_at: datetime


class ContactCreate(BaseModel):
    contact_username: str
    alias: Optional[str] = ""


class ContactOut(BaseModel):
    id: int
    contact_username: str
    alias: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ContactRequestCreate(BaseModel):
    recipient_username: str
    message: Optional[str] = ""


class ContactRequestOut(BaseModel):
    id: int
    requester_username: str
    recipient_username: str
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


class IngredientCanonicalItem(BaseModel):
    input: str
    canonical: str


class IngredientCanonicalizeIn(BaseModel):
    items: list[str]


class IngredientCanonicalizeOut(BaseModel):
    items: list[IngredientCanonicalItem]
