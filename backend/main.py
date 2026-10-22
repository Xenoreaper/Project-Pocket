from fastapi import FastAPI, Depends, HTTPException, Query, File, UploadFile, Header, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func
from urllib.parse import parse_qs, urlencode, urlparse
from datetime import datetime, timezone, timedelta
from hashlib import pbkdf2_hmac
import os
import asyncio
import csv
import io
import re
import json
import secrets
import hmac
import unicodedata
import httpx
from bs4 import BeautifulSoup
from typing import Any, Optional

from database import Base, engine, get_db
import models
import schemas
from recipe_vocabulary import (
    RECIPE_HINT_TERMS as _RECIPE_HINT_TERMS,
    RECIPE_INGREDIENT_HEADINGS as _RECIPE_INGREDIENT_HEADINGS,
    RECIPE_INGREDIENT_HEADING_KEYWORDS,
    RECIPE_INSTRUCTION_HEADINGS as _RECIPE_INSTRUCTION_HEADINGS,
    RECIPE_INSTRUCTION_HEADING_KEYWORDS,
    RECIPE_SECTION_HEADINGS as _RECIPE_SECTION_HEADINGS,
)

Base.metadata.create_all(bind=engine)

PASSWORD_HASH_ITERATIONS = 240_000
INGREDIENT_TRANSLATE_TIMEOUT = float(os.getenv("INGREDIENT_TRANSLATE_TIMEOUT", "6"))
INGREDIENT_TRANSLATE_TARGET_LANG = os.getenv("INGREDIENT_TRANSLATE_TARGET_LANG", "en").strip() or "en"
_INGREDIENT_CANONICAL_CACHE: dict[str, str] = {}
_INGREDIENT_CANONICAL_CACHE_LIMIT = 4096
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "30"))

# ── Lightweight migrations (add columns that may be missing in existing DBs) ─
def _run_migrations():
    with engine.connect() as conn:
        from sqlalchemy import text, inspect
        inspector = inspect(engine)
        existing = {col["name"] for col in inspector.get_columns("pages")}
        additions = {
            "owner": "VARCHAR DEFAULT 'default'",
            "profile": "VARCHAR DEFAULT 'default'",
            "device": "VARCHAR DEFAULT ''",
            "saved_via": "VARCHAR DEFAULT ''",
            "resave_count": "INTEGER DEFAULT 0",
            "is_music": "BOOLEAN DEFAULT 0",
            "is_shared_received": "BOOLEAN DEFAULT 0",
            "is_shared_sent": "BOOLEAN DEFAULT 0",
            "shared_by": "VARCHAR DEFAULT ''",
            "shared_to": "VARCHAR DEFAULT ''",
            "share_status": "VARCHAR DEFAULT 'accepted'",
            "recipe_ingredients": "TEXT DEFAULT ''",
            "recipe_instructions": "TEXT DEFAULT ''",
        }
        for col, definition in additions.items():
            if col not in existing:
                conn.execute(text(f"ALTER TABLE pages ADD COLUMN {col} {definition}"))

        rules_existing = {col["name"] for col in inspector.get_columns("auto_tag_rules")}
        if "owner" not in rules_existing:
            conn.execute(text("ALTER TABLE auto_tag_rules ADD COLUMN owner VARCHAR DEFAULT 'default'"))
        if "profile" not in rules_existing:
            conn.execute(text("ALTER TABLE auto_tag_rules ADD COLUMN profile VARCHAR DEFAULT 'default'"))

        users_existing = {col["name"] for col in inspector.get_columns("users")}
        if "created_at" not in users_existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN created_at DATETIME"))
        if "is_admin" not in users_existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0"))
        if "is_disabled" not in users_existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_disabled BOOLEAN DEFAULT 0"))
        if "force_password_change" not in users_existing:
            conn.execute(text("ALTER TABLE users ADD COLUMN force_password_change BOOLEAN DEFAULT 0"))

        sessions_existing = {col["name"] for col in inspector.get_columns("auth_sessions")}
        if "created_at" not in sessions_existing:
            conn.execute(text("ALTER TABLE auth_sessions ADD COLUMN created_at DATETIME"))
        if "last_used_at" not in sessions_existing:
            conn.execute(text("ALTER TABLE auth_sessions ADD COLUMN last_used_at DATETIME"))
            # initialize last_used_at from created_at for existing rows when possible
            conn.execute(text("UPDATE auth_sessions SET last_used_at = created_at WHERE last_used_at IS NULL"))

        conn.execute(text("UPDATE pages SET owner = 'default' WHERE owner IS NULL OR TRIM(owner) = ''"))
        conn.execute(text("UPDATE pages SET profile = 'default' WHERE profile IS NULL OR TRIM(profile) = ''"))
        conn.execute(text("UPDATE pages SET resave_count = 0 WHERE resave_count IS NULL OR resave_count < 0"))
        conn.execute(text("UPDATE pages SET is_shared_received = 0 WHERE is_shared_received IS NULL"))
        conn.execute(text("UPDATE pages SET is_shared_sent = 0 WHERE is_shared_sent IS NULL"))
        conn.execute(text("UPDATE pages SET shared_by = '' WHERE shared_by IS NULL"))
        conn.execute(text("UPDATE pages SET shared_to = '' WHERE shared_to IS NULL"))
        conn.execute(text("UPDATE pages SET share_status = 'accepted' WHERE share_status IS NULL OR TRIM(share_status) = ''"))
        conn.execute(text("UPDATE auto_tag_rules SET owner = 'default' WHERE owner IS NULL OR TRIM(owner) = ''"))
        conn.execute(text("UPDATE auto_tag_rules SET profile = 'default' WHERE profile IS NULL OR TRIM(profile) = ''"))
        conn.execute(text("UPDATE users SET is_disabled = 0 WHERE is_disabled IS NULL"))
        conn.commit()

_run_migrations()


def _wildcard_to_regex(pattern: str) -> str:
    """Convert wildcard text to regex. Supports escaping with backslash."""
    out: list[str] = []
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            out.append(re.escape(pattern[i + 1]))
            i += 2
            continue
        if ch == "*":
            out.append(".*")
        elif ch == "?":
            out.append(".")
        else:
            out.append(re.escape(ch))
        i += 1
    return "".join(out)


def _wildcard_match(value: str, pattern: str) -> bool:
    """Case-insensitive wildcard full match where * = any chars and ? = one char."""
    value = (value or "").lower()
    pattern = (pattern or "").strip().lower()
    if not value or not pattern:
        return False
    return re.fullmatch(_wildcard_to_regex(pattern), value) is not None


def _contains_or_wildcard_match(value: str, pattern: str) -> bool:
    """Substring match, but enables wildcard syntax when pattern contains * or ?."""
    value = (value or "").lower()
    pattern = (pattern or "").strip().lower()
    if not pattern:
        return False
    if "*" in pattern or "?" in pattern:
        return re.search(_wildcard_to_regex(pattern), value) is not None
    return pattern in value


def _split_tags(value: str) -> list[str]:
    return [tag.strip() for tag in str(value or "").split(",") if tag.strip()]


def _merge_tag_strings(existing_tags: str, incoming_tags: str) -> str:
    merged: list[str] = []
    seen: set[str] = set()
    for source in (_split_tags(existing_tags), _split_tags(incoming_tags)):
        for tag in source:
            key = tag.casefold()
            if key in seen:
                continue
            seen.add(key)
            merged.append(tag)
    return ", ".join(merged)


def _merge_notes(existing_notes: str, incoming_notes: str) -> str:
    existing = str(existing_notes or "").strip()
    incoming = str(incoming_notes or "").strip()

    if not existing:
        return incoming
    if not incoming:
        return existing
    if existing == incoming:
        return existing

    return f"{existing}\n\n{incoming}"


def _normalize_owner(raw_value: Optional[str]) -> str:
    value = str(raw_value or "").strip()
    if not value:
        return "default"
    safe = re.sub(r"[^a-zA-Z0-9._-]", "", value)
    return safe[:64] or "default"


def _normalize_profile(raw_value: Optional[str]) -> str:
    return _normalize_owner(raw_value)


def _normalize_username(raw_value: Optional[str]) -> str:
    value = str(raw_value or "").strip().lower()
    username = re.sub(r"[^a-zA-Z0-9._-]", "", value)[:64]
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    return username


def _get_original_admin_username() -> str:
    raw_value = str(os.getenv("ADMIN_USERNAME", "") or "").strip().lower()
    username = re.sub(r"[^a-zA-Z0-9._-]", "", raw_value)[:64]
    return username if len(username) >= 3 else ""


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}${salt.hex()}${digest.hex()}"


def _verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, iterations_text, salt_hex, expected_hex = encoded_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = bytes.fromhex(salt_hex)
    except Exception:
        return False

    computed = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(computed.hex(), expected_hex)


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    value = str(authorization or "").strip()
    if not value:
        return None
    parts = value.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _create_auth_session(username: str, db: Session) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    session = models.AuthSession(token=token, username=username, created_at=now, last_used_at=now)
    db.add(session)
    db.commit()
    return token


def get_optional_owner(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> str:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication")
    return _get_authenticated_username(token, db)


def get_current_owner(current_owner: str = Depends(get_optional_owner)) -> str:
    return current_owner


def get_current_profile(x_pocket_profile: Optional[str] = Header(default=None, alias="X-Pocket-Profile")) -> str:
    return _normalize_profile(x_pocket_profile)


def _apply_auto_tags(page: models.Page, db: Session) -> None:
    """Merge tags from matching AutoTagRules into the page's tag list."""
    rules = db.query(models.AutoTagRule).filter(
        models.AutoTagRule.owner == page.owner,
        models.AutoTagRule.profile == page.profile,
    ).all()
    existing = {t.strip().lower() for t in (page.tags or "").split(",") if t.strip()}
    new_tags = [t.strip() for t in (page.tags or "").split(",") if t.strip()]

    for rule in rules:
        pattern = (rule.pattern or "").strip().lower()
        match = False

        # If user pastes a full URL for a domain rule, extract hostname gracefully.
        domain_pattern = pattern
        if "://" in domain_pattern:
            parsed = urlparse(domain_pattern)
            if parsed.hostname:
                domain_pattern = parsed.hostname.lower()
        domain_pattern = domain_pattern.split("/")[0].split(":")[0]

        if rule.match_type == "domain":
            domain = (page.domain or "").lower()
            if "*" in domain_pattern or "?" in domain_pattern:
                match = _wildcard_match(domain, domain_pattern)
            else:
                match = domain == domain_pattern or domain.endswith("." + domain_pattern)
        elif rule.match_type == "domain_wildcard":
            match = _wildcard_match(page.domain or "", domain_pattern)
        elif rule.match_type == "url_contains":
            match = _contains_or_wildcard_match(page.url or "", pattern)
        elif rule.match_type == "url_wildcard":
            match = _wildcard_match(page.url or "", pattern)
        elif rule.match_type == "title_contains":
            match = _contains_or_wildcard_match(page.title or "", pattern)
        elif rule.match_type == "title_wildcard":
            match = _wildcard_match(page.title or "", pattern)
        elif rule.match_type == "device_or_origin_contains":
            combined = " ".join([
                str(page.device or ""),
                str(page.saved_via or ""),
            ]).strip()
            match = _contains_or_wildcard_match(combined, pattern)

        if match:
            for t in rule.tags.split(","):
                t = t.strip()
                if t and t.lower() not in existing:
                    new_tags.append(t)
                    existing.add(t.lower())

    page.tags = ", ".join(new_tags)


def _get_auth_token_from_header(authorization: Optional[str] = Header(default=None, alias="Authorization")) -> str:
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token


def _get_authenticated_username(token: str, db: Session) -> str:
    session = db.query(models.AuthSession).filter(models.AuthSession.token == token).first()
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    now = datetime.now(timezone.utc)
    last_activity = session.last_used_at or session.created_at
    if last_activity is None:
        last_activity = now
    if last_activity.tzinfo is None:
        last_activity = last_activity.replace(tzinfo=timezone.utc)

    if now - last_activity > timedelta(days=SESSION_TTL_DAYS):
        db.query(models.AuthSession).filter(models.AuthSession.token == token).delete(synchronize_session=False)
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = db.query(models.User).filter(models.User.username == session.username).first()
    if not user:
        db.query(models.AuthSession).filter(models.AuthSession.token == token).delete(synchronize_session=False)
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if user.is_disabled:
        db.query(models.AuthSession).filter(models.AuthSession.username == session.username).delete(synchronize_session=False)
        db.commit()
        raise HTTPException(status_code=401, detail="Account is disabled")

    # Update last_used_at to reflect recent activity
    try:
        session.last_used_at = now
        db.add(session)
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    return session.username


def _check_admin(username: str, db: Session) -> bool:
    """Check if a user is an admin."""
    user = db.query(models.User).filter(models.User.username == username).first()
    return user and user.is_admin


def _get_current_admin(
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
) -> str:
    """Verify that the current user is an admin."""
    username = _get_authenticated_username(token, db)
    if not _check_admin(username, db):
        raise HTTPException(status_code=403, detail="Admin access required")
    return username


def _apply_category_tags(page: models.Page) -> None:
    """Auto-add category tags when booleans are enabled, but keep manual tags intact."""
    existing = [t.strip() for t in (page.tags or "").split(",") if t.strip()]
    existing_lower = {tag.lower() for tag in existing}

    if page.is_recipe and "recipe" not in existing_lower:
        existing.append("recipe")
    if getattr(page, "is_music", False) and "music" not in existing_lower:
        existing.append("music")

    page.tags = ", ".join(existing)


def _iter_ld_json_items(value: Any):
    if isinstance(value, list):
        for item in value:
            yield from _iter_ld_json_items(item)
        return

    if not isinstance(value, dict):
        return

    yield value

    graph = value.get("@graph")
    if graph:
        yield from _iter_ld_json_items(graph)


def _has_schema_type(item: dict[str, Any], schema_type: str) -> bool:
    item_type = item.get("@type")
    if isinstance(item_type, list):
        return schema_type in item_type
    return item_type == schema_type


def _compile_word_list_pattern(terms: set[str]) -> re.Pattern[str]:
    cleaned = sorted({str(term or "").strip() for term in terms if str(term or "").strip()}, key=len, reverse=True)
    if not cleaned:
        return re.compile(r"$^")
    alternatives = "|".join(re.escape(term) for term in cleaned)
    return re.compile(rf"(?<!\\w)(?:{alternatives})(?!\\w)", flags=re.I)


_RECIPE_HINT_PATTERN = _compile_word_list_pattern(_RECIPE_HINT_TERMS)

_RECIPE_SOCIAL_TAIL_PATTERN = re.compile(
    r"(?i)\b(?:follow|folge|like|save|share|comment|komment(?:ar|iere)?|subscribe|"
    r"for\s+more|mehr(?:\s+solcher)?\s+rezepte|por\s+favor\s+comparte|comparte|"
    r"sigueme|sígueme|suscribete|suscríbete|guarda|guardar|compartir|"
    r"partage|abonne|abonnez|sauvegarde|curte|curtir|segue|seguir|"
    r"compartilha|salva|link\s+in\s+bio|bio\s+link|link\s+na\s+bio|enlace\s+en\s+bio|"
    r"credits?|music|audio|werbung|anzeige|publicidad|anuncio|sponsored|promo(?:code)?)\b"
)

_RECIPE_INSTRUCTION_LINE_PATTERN = re.compile(
    r"(?i)\b(?:back(?:e|en)?|bake|cook|mixe(?:n)?|mix|r[üu]hre(?:n)?|stir|"
    r"boil|fry|brat(?:en)?|serv(?:e|ieren)|in\s+den\s+backofen|"
    r"comes?\s+at|hornea|hornear|mezcla|mezclar|agrega|añade|anade|"
    r"cuece|cocina|sirve|forno|asse|assar|misture|cozinhe|"
    r"mélange|melange|ajoute|cuire|servez|mescola|aggiungi|cuoci|servi|"
    r"hazirla|pişir|pisir|servis|готов|вари|жарь|пода(?:й|вать)|"
    r"minutes?|minuten|minutos|minuti|mins?)\b"
)

_RECIPE_INGREDIENT_LINE_PATTERN = re.compile(
    r"(?i)(?:^|\b)(?:\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]|\d+\/\d+)\s*"
    r"(?:x\s*)?(?:g|kg|mg|ml|l|cl|oz|lb|lbs|cup|cups|tbsp|tsp|"
    r"teaspoon(?:s)?|tablespoon(?:s)?|el|tl|cda|cdta|cs|cc|"
    r"gr|gram(?:s)?|gramm|lit(?:er|re)s?|pinch(?:es)?|slice(?:s)?|"
    r"piece(?:s)?|unidad(?:es)?|unid(?:ad)?|pieza(?:s)?|"
    r"st(?:k|ück)|stuck|stk|шт|г|кг|мл|л|مل|كوب)\b"
)


def _normalize_recipe_hint_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "").lower().replace("ß", "ss"))
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", normalized).strip()


_RECIPE_SECTION_HEADINGS_NORMALIZED = {
    _normalize_recipe_hint_text(value)
    for value in _RECIPE_SECTION_HEADINGS
}

_RECIPE_INGREDIENT_HEADINGS_NORMALIZED = [
    _normalize_recipe_hint_text(value)
    for value in _RECIPE_INGREDIENT_HEADINGS
]

_RECIPE_INSTRUCTION_HEADINGS_NORMALIZED = [
    _normalize_recipe_hint_text(value)
    for value in _RECIPE_INSTRUCTION_HEADINGS
]


def _cleanup_recipe_source_text(value: Any) -> str:
    text = BeautifulSoup(str(value or ""), "html.parser").get_text("\n", strip=True)
    text = text.replace("\\r\\n", "\n").replace("\\r", "\n").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\\n", "\n").replace("\\t", " ")
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _recipe_candidate_key(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _add_recipe_text_candidate(candidates: list[str], seen: set[str], value: Any) -> Optional[str]:
    text = _cleanup_recipe_source_text(value)
    if len(text) < 24:
        return None
    if len(text) > 6000:
        return None
    key = _recipe_candidate_key(text)
    if key in seen:
        return text
    seen.add(key)
    candidates.append(text)
    return text


def _looks_recipe_like_text(value: str) -> bool:
    raw_text = _cleanup_recipe_source_text(value)
    if not raw_text:
        return False

    if _RECIPE_HINT_PATTERN.search(raw_text):
        return True

    ingredient_like_count = 0
    for line in re.split(r"\n+|[|;]", raw_text):
        if _looks_like_ingredient_line(line):
            ingredient_like_count += 1
            if ingredient_like_count >= 2:
                return True

    if _RECIPE_INSTRUCTION_LINE_PATTERN.search(raw_text) and _RECIPE_INGREDIENT_LINE_PATTERN.search(raw_text):
        return True

    normalized = _normalize_recipe_hint_text(raw_text)

    has_ingredient_heading = any(head in normalized for head in _RECIPE_INGREDIENT_HEADINGS_NORMALIZED)
    has_instruction_heading = any(head in normalized for head in _RECIPE_INSTRUCTION_HEADINGS_NORMALIZED)
    if has_ingredient_heading and has_instruction_heading:
        return True

    return any(term in normalized for term in _RECIPE_HINT_TERMS)


def _recipe_candidate_score(value: str) -> int:
    text = _cleanup_recipe_source_text(value)
    if not text:
        return 0

    normalized = _normalize_recipe_hint_text(text)
    score = 0

    if any(head in normalized for head in _RECIPE_INGREDIENT_HEADINGS_NORMALIZED):
        score += 8
    if any(head in normalized for head in _RECIPE_INSTRUCTION_HEADINGS_NORMALIZED):
        score += 8

    ingredient_like = 0
    for line in re.split(r"\n+|[|;]", text):
        if _looks_like_ingredient_line(line):
            ingredient_like += 1
    score += min(6, ingredient_like)

    if _looks_like_instruction_line(text):
        score += 4
    if text.count("\n") >= 5:
        score += 2
    if 120 <= len(text) <= 7000:
        score += 1

    return score


def _is_social_tail_line(line: str) -> bool:
    value = re.sub(r"\s+", " ", str(line or "")).strip().lower()
    if not value:
        return False
    if value.startswith("#") or value.startswith("@"):
        return True
    if value.count("#") >= 2:
        return True
    if re.search(r"https?://|www\\.", value):
        return True
    return bool(_RECIPE_SOCIAL_TAIL_PATTERN.search(value))


def _looks_like_instruction_line(line: str) -> bool:
    value = re.sub(r"\s+", " ", str(line or "")).strip()
    if not value:
        return False
    if _RECIPE_INSTRUCTION_LINE_PATTERN.search(value):
        return True
    word_count = len(value.split())
    return word_count >= 11 and value.endswith((".", "!", "?"))


def _looks_like_ingredient_line(line: str) -> bool:
    value = re.sub(r"\s+", " ", str(line or "")).strip()
    if not value:
        return False

    if _RECIPE_INGREDIENT_LINE_PATTERN.search(value):
        return True

    compact = value.lower().strip("-•*+ ")
    words = compact.split()
    if len(words) <= 8 and re.match(r"^(?:\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]|\d+/\d+)", compact):
        return True
    return False


def _extract_recipe_data_without_headings(source: str) -> tuple[list[str], list[str]]:
    text = _cleanup_recipe_source_text(source)
    if not text:
        return [], []

    text = text.replace("•", "\n• ").replace("·", "\n")
    text = re.sub(r"\s*[\u2718\u2717\u2714\u2705\u2611\u25cf\u25aa]+\s*", "\n", text)
    text = re.sub(r"\s*[\u27a1\u279c\u279d\u279e\u27a4\u27a9\u27aa]+\s*", "\n", text)

    lines: list[str] = []
    for chunk in re.split(r"\n+|\|", text):
        line = re.sub(r"^\s*(?:[-*+•]+|\d{1,2}[).:-]\s+|step\s*\d{1,2}[:.)-]?\s+)", "", chunk, flags=re.I).strip()
        if not line or _is_social_tail_line(line):
            continue
        lines.append(line)

    ingredients: list[str] = []
    instructions: list[str] = []
    in_instruction_mode = False

    for line in lines:
        if not in_instruction_mode and _looks_like_ingredient_line(line):
            ingredients.append(line)
            continue

        if _looks_like_instruction_line(line):
            in_instruction_mode = True
            instructions.append(line)
            continue

        if in_instruction_mode and len(line.split()) >= 4:
            instructions.append(line)

    if len(ingredients) < 2:
        ingredients = []

    return _dedupe_recipe_entries(ingredients), _dedupe_recipe_entries(instructions)


def _decode_json_escaped_string(value: str) -> str:
    raw = str(value or "")
    raw = raw.replace("\\/", "/")

    def _decode_hex(match: re.Match[str]) -> str:
        try:
            return chr(int(match.group(1), 16))
        except Exception:
            return match.group(0)

    raw = re.sub(r"\\x([0-9a-fA-F]{2})", _decode_hex, raw)

    try:
        return json.loads(f'"{raw}"')
    except Exception:
        return raw.replace('\\"', '"').replace("\\n", "\n").replace("\\t", " ")


def _decode_script_escapes(value: str) -> str:
    raw = str(value or "")

    def _decode_hex(match: re.Match[str]) -> str:
        try:
            return chr(int(match.group(1), 16))
        except Exception:
            return match.group(0)

    def _decode_unicode(match: re.Match[str]) -> str:
        try:
            return chr(int(match.group(1), 16))
        except Exception:
            return match.group(0)

    raw = re.sub(r"\\x([0-9a-fA-F]{2})", _decode_hex, raw)
    raw = re.sub(r"\\u([0-9a-fA-F]{4})", _decode_unicode, raw)
    raw = raw.replace("\\/", "/")
    return raw


def _extract_recipe_text_candidates(
    soup: BeautifulSoup,
    preferred_texts: Optional[list[str]] = None,
    source_url: str = "",
) -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()
    candidate_bonus: dict[str, int] = {}

    target_video_id = _extract_youtube_video_id(source_url)
    target_markers: list[re.Pattern[str]] = []
    if target_video_id:
        escaped_video_id = re.escape(target_video_id)
        target_markers = [
            re.compile(rf'"videoId"\s*:\s*"{escaped_video_id}"', flags=re.I),
            re.compile(rf"watch\?v={escaped_video_id}", flags=re.I),
            re.compile(rf"/shorts/{escaped_video_id}", flags=re.I),
        ]

    def _register_candidate(value: Any, bonus: int = 0) -> None:
        added = _add_recipe_text_candidate(candidates, seen, value)
        if not added:
            return
        key = _recipe_candidate_key(added)
        candidate_bonus[key] = max(candidate_bonus.get(key, 0), bonus)

    for text in preferred_texts or []:
        _register_candidate(text)

    for attrs in (
        {"name": "description"},
        {"property": "og:description"},
        {"name": "twitter:description"},
        {"property": "twitter:description"},
    ):
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            _register_candidate(tag.get("content"))

    for script in soup.find_all("script", type="application/ld+json"):
        raw_json = script.string or script.get_text()
        if not raw_json or not raw_json.strip():
            continue
        try:
            payload = json.loads(raw_json)
        except Exception:
            continue

        for item in _iter_ld_json_items(payload):
            if not isinstance(item, dict):
                continue
            for key in ("description", "caption", "articleBody", "text"):
                if key in item:
                    _register_candidate(item.get(key))

    embedded_text_patterns = [
        re.compile(
            r'"(?:shortDescription|description|caption|articleBody|text|simpleText|content|desc)"\s*:\s*"((?:\\.|[^"\\]){18,})"',
            flags=re.I,
        ),
        re.compile(
            r'"(?:title|description|desc|text)"\s*:\s*\{\s*"(?:simpleText|content|text)"\s*:\s*"((?:\\.|[^"\\]){18,})"',
            flags=re.I,
        ),
    ]

    for script in soup.find_all("script"):
        raw = script.string or script.get_text()
        if not raw or len(raw) < 100:
            continue

        script_variants = [raw]
        decoded_script = _decode_script_escapes(raw)
        if decoded_script != raw:
            script_variants.append(decoded_script)

        for script_text in script_variants:
            marker_positions: list[int] = []
            for marker in target_markers:
                marker_positions.extend(match.start() for match in marker.finditer(script_text))

            for pattern in embedded_text_patterns:
                for match in pattern.finditer(script_text):
                    decoded = _decode_json_escaped_string(match.group(1))
                    if not _looks_recipe_like_text(decoded):
                        continue
                    bonus = 0
                    if marker_positions:
                        nearest_distance = min(abs(match.start() - pos) for pos in marker_positions)
                        if nearest_distance <= 1200:
                            bonus = 12
                        elif nearest_distance <= 2600:
                            bonus = 8
                        elif nearest_distance <= 5200:
                            bonus = 4
                    _register_candidate(decoded, bonus=bonus)

    if len(candidates) > 1:
        candidates.sort(
            key=lambda value: (
                candidate_bonus.get(_recipe_candidate_key(value), 0),
                _recipe_candidate_score(value),
            ),
            reverse=True,
        )
    if len(candidates) > 60:
        candidates = candidates[:60]

    return candidates


def _split_recipe_block_lines(block: str, instruction_mode: bool = False) -> list[str]:
    text = _cleanup_recipe_source_text(block)
    if not text:
        return []

    text = text.replace("•", "\n• ").replace("·", "\n")
    text = re.sub(r"\s*[\u2718\u2717\u2714\u2705\u2611\u25cf\u25aa]+\s*", "\n", text)
    text = re.sub(r"\s*[\u27a1\u279c\u279d\u279e\u27a4\u27a9\u27aa]+\s*", "\n", text)
    text = re.sub(
        r"(?i)\s+(?=(?:meine?\s+tipps?|notes?|hashtags?|follow|folge|for\s+more|"
        r"mehr(?:\s+solcher)?\s+rezepte|link\s+in\s+bio|bio\s+link|@\w+|#\w+)\b)",
        "\n",
        text,
    )
    if instruction_mode:
        text = re.sub(r"\s+(?=\d{1,2}[).:-]\s+)", "\n", text)
        text = re.sub(r"\s+(?=step\s*\d{1,2}[:.)-]?\s+)", "\n", text, flags=re.I)

    values: list[str] = []
    for chunk in re.split(r"\n+|\|", text):
        line = re.sub(r"^\s*(?:[-*+•]+|\d{1,2}[).:-]\s+|step\s*\d{1,2}[:.)-]?\s+)", "", chunk, flags=re.I).strip()
        if not line:
            continue
        if _is_social_tail_line(line):
            if values:
                break
            continue
        if re.fullmatch(r"(?:https?://\S+|#\w+)", line):
            continue
        if len(line) < 2:
            continue
        if not instruction_mode and _looks_like_instruction_line(line):
            if len(values) >= 2:
                break
            continue
        values.append(line)

    if not values and not instruction_mode:
        comma_parts = [part.strip() for part in text.split(",") if part.strip()]
        if len(comma_parts) >= 3:
            values = comma_parts

    return _dedupe_recipe_entries(values)


def _extract_recipe_data_from_text(text: str) -> tuple[list[str], list[str]]:
    source = _cleanup_recipe_source_text(text)
    if not source:
        return [], []

    ingredient_heads = "|".join(re.escape(value) for value in _RECIPE_INGREDIENT_HEADINGS)
    instruction_heads = "|".join(re.escape(value) for value in _RECIPE_INSTRUCTION_HEADINGS)
    source = re.sub(
        rf"(?i)\s+(?=(?:{ingredient_heads}|{instruction_heads})\s*[:\-])",
        "\n",
        source,
    )
    tail_heads = (
        r"notes?|tips?|hashtags?|follow|folge|like|save|share|comment|"
        r"komment(?:ar|iere)?|for\s+more|mehr(?:\s+solcher)?\s+rezepte|"
        r"por\s+favor\s+comparte|comparte|sigueme|sígueme|suscribete|suscríbete|"
        r"guarda|guardar|compartir|partage|abonne|abonnez|sauvegarde|"
        r"curte|curtir|segue|seguir|compartilha|salva|link\s+in\s+bio|bio\s+link|"
        r"link\s+na\s+bio|enlace\s+en\s+bio|credits?|music|audio|werbung|anzeige|"
        r"publicidad|anuncio|sponsored"
    )

    ingredient_pattern = re.compile(
        rf"(?is)(?:^|[\n\r])(?:{ingredient_heads})\s*[:\-]?\s*(.+?)(?=(?:^|[\n\r])(?:{instruction_heads}|{tail_heads})\s*[:\-]?|$)"
    )
    instruction_pattern = re.compile(
        rf"(?is)(?:^|[\n\r])(?:{instruction_heads})\s*[:\-]?\s*(.+?)(?=(?:^|[\n\r])(?:{ingredient_heads}|{tail_heads})\s*[:\-]?|$)"
    )

    ingredients: list[str] = []
    instructions: list[str] = []

    for match in ingredient_pattern.finditer(source):
        ingredients.extend(_split_recipe_block_lines(match.group(1), instruction_mode=False))
    for match in instruction_pattern.finditer(source):
        instructions.extend(_split_recipe_block_lines(match.group(1), instruction_mode=True))

    if not ingredients:
        inline_ing = re.search(
            rf"(?is)(?:{ingredient_heads})\s*[:\-]\s*(.+?)(?=(?:{instruction_heads}|{tail_heads})\b|$)",
            source,
        )
        if inline_ing:
            ingredients.extend(_split_recipe_block_lines(inline_ing.group(1), instruction_mode=False))

    if not instructions:
        inline_inst = re.search(
            rf"(?is)(?:{instruction_heads})\s*[:\-]\s*(.+?)(?=(?:{tail_heads})\b|$)",
            source,
        )
        if inline_inst:
            instructions.extend(_split_recipe_block_lines(inline_inst.group(1), instruction_mode=True))

    if not (ingredients and instructions):
        loose_ingredients, loose_instructions = _extract_recipe_data_without_headings(source)
        loose_parse_is_confident = bool(loose_instructions) or len(loose_ingredients) >= 3

        if not ingredients and loose_ingredients and loose_parse_is_confident:
            ingredients.extend(loose_ingredients)
        if not instructions and loose_instructions and loose_parse_is_confident:
            instructions.extend(loose_instructions)

    return _dedupe_recipe_entries(ingredients), _dedupe_recipe_entries(instructions)


def _normalize_recipe_text(value: Any) -> str:
    text = BeautifulSoup(str(value or ""), "html.parser").get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip("•·-: ")


def _is_recipe_heading_only(text: str) -> bool:
    normalized = _normalize_recipe_hint_text(str(text or "").strip().strip(":"))
    return normalized in _RECIPE_SECTION_HEADINGS_NORMALIZED


def _dedupe_recipe_entries(entries: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        text = _normalize_recipe_text(entry)
        if not text:
            continue
        if _is_recipe_heading_only(text):
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def _collect_recipe_text_by_selector(soup: BeautifulSoup, selector: str) -> list[str]:
    values: list[str] = []
    for node in soup.select(selector):
        # Prevent giant container blocks from becoming one noisy entry.
        list_items = node.find_all("li")
        if list_items:
            for item in list_items:
                text = _normalize_recipe_text(item.get_text(" ", strip=True))
                if text:
                    values.append(text)
            continue

        text = _normalize_recipe_text(node.get_text(" ", strip=True))
        if text:
            values.append(text)
    return values


def _extract_text_after_heading(
    soup: BeautifulSoup,
    heading_keywords: list[str],
    max_siblings: int = 6,
) -> list[str]:
    values: list[str] = []
    heading_tags = ["h1", "h2", "h3", "h4", "h5", "h6", "strong"]

    for heading in soup.find_all(heading_tags):
        title = _normalize_recipe_text(heading.get_text(" ", strip=True)).lower()
        if not title:
            continue
        if not any(keyword in title for keyword in heading_keywords):
            continue

        sibling = heading
        for _ in range(max_siblings):
            sibling = sibling.find_next_sibling()
            if sibling is None:
                break
            if sibling.name in heading_tags:
                break

            list_items = sibling.find_all("li")
            if list_items:
                for item in list_items:
                    text = _normalize_recipe_text(item.get_text(" ", strip=True))
                    if text:
                        values.append(text)
                continue

            text = _normalize_recipe_text(sibling.get_text(" ", strip=True))
            if text:
                values.append(text)

    return values


def _normalize_recipe_entries(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        text = _normalize_recipe_text(value)
        return [text] if text else []

    if isinstance(value, list):
        items: list[str] = []
        for entry in value:
            items.extend(_normalize_recipe_entries(entry))
        return items

    if isinstance(value, dict):
        # Some publishers (e.g. Chefkoch) store actual steps under itemListElement
        # and keep only a section title in name.
        if "itemListElement" in value:
            return _normalize_recipe_entries(value.get("itemListElement"))
        if "text" in value:
            return _normalize_recipe_entries(value.get("text"))
        if "name" in value:
            return _normalize_recipe_entries(value.get("name"))

    return []


def _extract_recipe_data_from_dom(soup: BeautifulSoup) -> tuple[list[str], list[str]]:
    ingredient_selectors = [
        '[itemprop="recipeIngredient"]',
        '[itemprop="ingredients"] li',
        'table[class*="ingredient"] tr',
        '[class*="ingredient"] li',
        '[id*="ingredient"] li',
        '[class*="zutat"] li',
        '[id*="zutat"] li',
        '[class*="zutat"] [class*="text"]',
    ]
    instruction_selectors = [
        '[itemprop="recipeInstructions"] [itemprop="text"]',
        '[itemprop="recipeInstructions"] li',
        '[itemprop="recipeInstructions"] p',
        'ol[class*="instruction"] li',
        'ol[class*="step"] li',
        '[class*="instruction"] [class*="text"]',
        '[class*="instruction"] li',
        '[class*="zubereitung"] li',
        '[class*="anleitung"] li',
        '[class*="step"] li',
    ]

    ingredients: list[str] = []
    instructions: list[str] = []

    for selector in ingredient_selectors:
        ingredients.extend(_collect_recipe_text_by_selector(soup, selector))
    for selector in instruction_selectors:
        instructions.extend(_collect_recipe_text_by_selector(soup, selector))

    ingredients.extend(
        _extract_text_after_heading(
            soup,
            heading_keywords=RECIPE_INGREDIENT_HEADING_KEYWORDS,
        )
    )
    instructions.extend(
        _extract_text_after_heading(
            soup,
            heading_keywords=RECIPE_INSTRUCTION_HEADING_KEYWORDS,
        )
    )

    return _dedupe_recipe_entries(ingredients), _dedupe_recipe_entries(instructions)


def _recipe_pair_score(ingredients: list[str], instructions: list[str]) -> tuple[int, int, int, int, int]:
    ing_count = len(ingredients)
    ins_count = len(instructions)
    has_both = 1 if (ing_count and ins_count) else 0
    return (
        has_both,
        min(ing_count, ins_count),
        ing_count + ins_count,
        ins_count,
        ing_count,
    )


def extract_recipe_data(
    soup: BeautifulSoup,
    preferred_texts: Optional[list[str]] = None,
    source_url: str = "",
) -> dict[str, str]:
    best_ingredients: list[str] = []
    best_instructions: list[str] = []

    for script in soup.find_all("script", type="application/ld+json"):
        raw_json = script.string or script.get_text()
        if not raw_json or not raw_json.strip():
            continue

        try:
            payload = json.loads(raw_json)
        except Exception:
            continue

        for item in _iter_ld_json_items(payload):
            if not isinstance(item, dict) or not _has_schema_type(item, "Recipe"):
                continue

            ingredients = _normalize_recipe_entries(item.get("recipeIngredient") or item.get("ingredients"))
            instructions = _normalize_recipe_entries(item.get("recipeInstructions"))
            ingredients = _dedupe_recipe_entries(ingredients)
            instructions = _dedupe_recipe_entries(instructions)

            if ingredients or instructions:
                if len(ingredients) > len(best_ingredients):
                    best_ingredients = ingredients
                if len(instructions) > len(best_instructions):
                    best_instructions = instructions
                if best_ingredients and best_instructions:
                    return {
                        "recipe_ingredients": "\n".join(best_ingredients),
                        "recipe_instructions": "\n".join(best_instructions),
                    }

    dom_ingredients, dom_instructions = _extract_recipe_data_from_dom(soup)

    candidate_pairs: list[tuple[list[str], list[str]]] = []
    if best_ingredients or best_instructions:
        candidate_pairs.append((best_ingredients, best_instructions))
    if dom_ingredients or dom_instructions:
        candidate_pairs.append((dom_ingredients, dom_instructions))

    for text_block in _extract_recipe_text_candidates(
        soup,
        preferred_texts=preferred_texts,
        source_url=source_url,
    ):
        text_ingredients, text_instructions = _extract_recipe_data_from_text(text_block)
        if text_ingredients or text_instructions:
            candidate_pairs.append((text_ingredients, text_instructions))

    if candidate_pairs:
        final_ingredients, final_instructions = max(
            candidate_pairs,
            key=lambda pair: _recipe_pair_score(pair[0], pair[1]),
        )
    else:
        final_ingredients, final_instructions = [], []

    return {
        "recipe_ingredients": "\n".join(final_ingredients),
        "recipe_instructions": "\n".join(final_instructions),
    }


def _singularize_ingredient_token(token: str) -> str:
    value = str(token or "")
    if len(value) <= 4:
        return value
    if value.endswith("ies") and len(value) > 5:
        return value[:-3] + "y"
    if value.endswith("es") and len(value) > 5:
        return value[:-2]
    if value.endswith("s") and not value.endswith("ss") and len(value) > 5:
        return value[:-1]
    return value


def _normalize_ingredient_text_for_match(value: str) -> str:
    units = re.compile(
        r"\b(g|kg|mg|ml|l|cl|oz|lb|lbs|cup|cups|tbsp|tsp|teaspoon|teaspoons|tablespoon|tablespoons|pinch|pinches|slice|slices|can|cans|pack|packs|piece|pieces|gram|grams|gramm|liter|liters|litre|litres|el|tl|essloffel|teeloffel|stuck|prise|zehe|zehen|unze|onza|onzas)\b"
    )
    filler = re.compile(
        r"\b(of|and|with|fresh|optional|to taste|for serving|for garnish|small|medium|large|und|mit|frisch|nach geschmack|zum servieren|zum garnieren|de|con|para servir|al gusto|frais|au gout|per servire)\b"
    )

    normalized = unicodedata.normalize("NFKD", str(value or "").lower().strip().replace("ß", "ss"))
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    normalized = re.sub(r"[()\[\]{}]", " ", normalized)
    normalized = re.sub(r"[0-9¼½¾⅓⅔⅛⅜⅝⅞/.,]+", " ", normalized)
    normalized = units.sub(" ", normalized)
    normalized = filler.sub(" ", normalized)
    normalized = "".join(ch if (ch.isalpha() or ch in {" ", "-"}) else " " for ch in normalized)

    tokens = [
        _singularize_ingredient_token(tok)
        for tok in re.sub(r"\s+", " ", normalized).strip().split(" ")
        if tok
    ]
    return " ".join(tokens)


async def _translate_ingredient_text(text: str, target_language: str = "en") -> str:
    query = str(text or "").strip()
    if not query:
        return ""

    url = "https://translate.googleapis.com/translate_a/single"
    params = {
        "client": "gtx",
        "sl": "auto",
        "tl": target_language,
        "dt": "t",
        "q": query,
    }

    try:
        async with httpx.AsyncClient(timeout=INGREDIENT_TRANSLATE_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(url, params=params, headers={"User-Agent": "Mozilla/5.0 ProjectPocket/1.0"})
            response.raise_for_status()
        payload = response.json()
        translated_chunks: list[str] = []
        if isinstance(payload, list) and payload and isinstance(payload[0], list):
            for chunk in payload[0]:
                if isinstance(chunk, list) and chunk and isinstance(chunk[0], str):
                    translated_chunks.append(chunk[0])
        translated = "".join(translated_chunks).strip()
        return translated or query
    except Exception:
        return query


async def _canonicalize_ingredient_text(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""

    normalized_raw = _normalize_ingredient_text_for_match(raw)
    if not normalized_raw:
        return ""

    cached = _INGREDIENT_CANONICAL_CACHE.get(normalized_raw)
    if cached is not None:
        return cached

    translated = await _translate_ingredient_text(raw, INGREDIENT_TRANSLATE_TARGET_LANG)
    canonical = _normalize_ingredient_text_for_match(translated) or normalized_raw

    if len(_INGREDIENT_CANONICAL_CACHE) >= _INGREDIENT_CANONICAL_CACHE_LIMIT:
        _INGREDIENT_CANONICAL_CACHE.clear()
    _INGREDIENT_CANONICAL_CACHE[normalized_raw] = canonical
    return canonical


app = FastAPI(
    title="Project Pocket API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)


def _parse_allowed_origins(raw_value: str) -> list[str]:
    raw = (raw_value or "").strip()
    if not raw or raw == "*":
        return ["*"]
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["*"]


allowed_origins = _parse_allowed_origins(os.getenv("BACKEND_CORS_ORIGINS", "*"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _create_admin_user():
    """Create or update the admin user from environment variables."""
    admin_username = os.getenv("ADMIN_USERNAME", "").strip()
    admin_password = os.getenv("ADMIN_PASSWORD", "").strip()
    
    if not admin_username or not admin_password:
        return  # Skip if admin credentials not configured
    
    admin_username = _normalize_username(admin_username)
    
    db = next(get_db())
    try:
        existing = db.query(models.User).filter(models.User.username == admin_username).first()
        if existing:
            # Update password and ensure is_admin is True
            existing.password_hash = _hash_password(admin_password)
            existing.is_admin = True
            db.commit()
        else:
            # Create new admin user
            user = models.User(
                username=admin_username,
                password_hash=_hash_password(admin_password),
                is_admin=True,
                is_disabled=False,
            )
            db.add(user)
            db.commit()
    finally:
        db.close()


_create_admin_user()

ADMIN_UI_BUNDLE_PATH = os.path.join(os.path.dirname(__file__), "admin_ui_bundle.js")


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/register", response_model=schemas.AuthOut, status_code=201)
def register(payload: schemas.AuthCredentials, db: Session = Depends(get_db)):
    username = _normalize_username(payload.username)
    password = str(payload.password or "")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing = db.query(models.User).filter(models.User.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = models.User(username=username, password_hash=_hash_password(password))
    db.add(user)
    db.commit()

    token = _create_auth_session(username, db)
    return {"token": token, "username": username}


@app.post("/api/auth/login", response_model=schemas.AuthOut)
def login(payload: schemas.AuthCredentials, db: Session = Depends(get_db)):
    username = _normalize_username(payload.username)
    user = db.query(models.User).filter(models.User.username == username).first()
    if user and user.is_disabled:
        db.query(models.AuthSession).filter(models.AuthSession.username == username).delete(synchronize_session=False)
        db.commit()
        raise HTTPException(status_code=403, detail="Account is disabled")
    if not user or not _verify_password(str(payload.password or ""), user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = _create_auth_session(username, db)
    return {"token": token, "username": username}


@app.get("/api/auth/me", response_model=schemas.AuthUserOut)
def auth_me(
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    username = _get_authenticated_username(token, db)
    user = db.query(models.User).filter(models.User.username == username).first()
    return {
        "username": username,
        "is_admin": user.is_admin if user else False,
        "is_disabled": user.is_disabled if user else False,
        "force_password_change": user.force_password_change if user else False,
    }


@app.get("/api/auth/password-params")
def auth_password_params(
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    """Return the PBKDF2 salt and iterations for the current user so the browser can derive password digests locally.

    Salt is not secret; exposing it allows the client to compute PBKDF2 locally and avoids sending plaintext passwords.
    """
    username = _get_authenticated_username(token, db)
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    try:
        algorithm, iterations_text, salt_hex, _ = user.password_hash.split("$", 3)
        iterations = int(iterations_text)
    except Exception:
        raise HTTPException(status_code=500, detail="Server password format error")

    return {"salt": salt_hex, "iterations": iterations}


@app.post("/api/auth/change-password", status_code=204)
def auth_change_password(
    payload: schemas.AuthPasswordChangeIn,
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    username = _get_authenticated_username(token, db)
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Determine verification of current password. Prefer derived form to avoid plaintext transport.
    if payload.current_password_derived:
        current_derived = str(payload.current_password_derived or "").lower()
        # Extract stored expected digest from password_hash
        try:
            algorithm, iterations_text, salt_hex, expected_hex = user.password_hash.split("$", 3)
        except Exception:
            raise HTTPException(status_code=500, detail="Server password format error")
        # Compare provided derived digest (hex) to stored digest
        if not hmac.compare_digest(current_derived, expected_hex.lower()):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
    else:
        current_password = str(payload.current_password or "")
        if not _verify_password(current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Now handle new password setting. Support client-supplied pre-hashed new password (salt+derived) to avoid plaintext.
    # Server enforces PASSWORD_HASH_ITERATIONS and minimum salt/digest lengths.
    if payload.new_password_derived and payload.new_password_salt:
        new_salt_hex = str(payload.new_password_salt or "").lower()
        new_digest_hex = str(payload.new_password_derived or "").lower()
        # Validate hex lengths: salt should be 16 bytes -> 32 hex chars, digest should be 32 bytes -> 64 hex chars
        if len(new_salt_hex) < 32 or len(new_digest_hex) < 64:
            raise HTTPException(status_code=400, detail="Invalid new password parameters")
        # Prevent setting identical password (compare new_digest against current stored digest)
        try:
            _, _, _, current_expected_hex = user.password_hash.split("$", 3)
        except Exception:
            raise HTTPException(status_code=500, detail="Server password format error")
        if hmac.compare_digest(new_digest_hex, current_expected_hex.lower()):
            raise HTTPException(status_code=400, detail="New password must be different from current password")
        # Enforce minimum strength: iterations are enforced server-side
        user.password_hash = f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}${new_salt_hex}${new_digest_hex}"
    else:
        new_password = str(payload.new_password or "")
        if len(new_password) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
        if _verify_password(new_password, user.password_hash):
            raise HTTPException(status_code=400, detail="New password must be different from current password")
        user.password_hash = _hash_password(new_password)

    # Keep the current browser session, revoke all others after password change.
    db.query(models.AuthSession).filter(
        models.AuthSession.username == username,
        models.AuthSession.token != token,
    ).delete(synchronize_session=False)
    db.commit()


@app.post("/api/auth/enforce-password-change", status_code=204)
def enforce_password_change(
    payload: schemas.AuthForcedPasswordChangeIn,
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    """Change password when forced to do so (no current password required)."""
    username = _get_authenticated_username(token, db)
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not user.force_password_change:
        raise HTTPException(status_code=400, detail="Password change not required for this account")

    # Support client-supplied derived new password (salt + derived digest) to avoid plaintext transport.
    if payload.new_password_derived and payload.new_password_salt:
        new_salt_hex = str(payload.new_password_salt or "").lower()
        new_digest_hex = str(payload.new_password_derived or "").lower()
        if len(new_salt_hex) < 32 or len(new_digest_hex) < 64:
            raise HTTPException(status_code=400, detail="Invalid new password parameters")
        try:
            _, _, _, current_expected_hex = user.password_hash.split("$", 3)
        except Exception:
            raise HTTPException(status_code=500, detail="Server password format error")
        if hmac.compare_digest(new_digest_hex, current_expected_hex.lower()):
            raise HTTPException(status_code=400, detail="New password must be different from current password")
        user.password_hash = f"pbkdf2_sha256${PASSWORD_HASH_ITERATIONS}${new_salt_hex}${new_digest_hex}"
    else:
        new_password = str(payload.new_password or "")
        if len(new_password) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
        if _verify_password(new_password, user.password_hash):
            raise HTTPException(status_code=400, detail="New password must be different from current password")
        user.password_hash = _hash_password(new_password)

    user.force_password_change = False
    # Revoke all existing sessions so the user signs in again with the new credentials.
    db.query(models.AuthSession).filter(
        models.AuthSession.username == username,
    ).delete(synchronize_session=False)
    db.commit()


@app.post("/api/auth/logout", status_code=204)
def auth_logout(
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    db.query(models.AuthSession).filter(models.AuthSession.token == token).delete(synchronize_session=False)
    db.commit()


# ── Share blocks (privacy) ──────────────────────────────────────────────────

@app.get("/api/auth/share-blocks", response_model=list[schemas.AuthShareBlockOut])
def list_share_blocks(
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    username = _get_authenticated_username(token, db)
    rows = (
        db.query(models.UserShareBlock)
        .filter(models.UserShareBlock.blocker_username == username)
        .order_by(models.UserShareBlock.created_at.asc())
        .all()
    )
    return [
        {"username": str(r.blocked_username or ""), "created_at": r.created_at}
        for r in rows
    ]


@app.post("/api/auth/share-blocks", response_model=schemas.AuthShareBlockOut, status_code=201)
def create_share_block(
    payload: schemas.AuthShareBlockIn,
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    username = _get_authenticated_username(token, db)
    blocked = _normalize_username(payload.username)
    if blocked == username:
        raise HTTPException(status_code=400, detail="Cannot block yourself")

    user = db.query(models.User).filter(models.User.username == blocked).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = (
        db.query(models.UserShareBlock)
        .filter(models.UserShareBlock.blocker_username == username, models.UserShareBlock.blocked_username == blocked)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="User already blocked")

    entry = models.UserShareBlock(blocker_username=username, blocked_username=blocked)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"username": blocked, "created_at": entry.created_at}


@app.delete("/api/auth/share-blocks/{blocked_username}", status_code=204)
def delete_share_block(
    blocked_username: str,
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    username = _get_authenticated_username(token, db)
    normalized = _normalize_username(blocked_username)
    deleted = (
        db.query(models.UserShareBlock)
        .filter(models.UserShareBlock.blocker_username == username, models.UserShareBlock.blocked_username == normalized)
        .delete(synchronize_session=False)
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Block not found")
    db.commit()


@app.patch("/api/auth/sharing", response_model=schemas.AuthUserOut)
def update_sharing_preference(
    payload: schemas.AuthSharingPreferenceIn,
    token: str = Depends(_get_auth_token_from_header),
    db: Session = Depends(get_db),
):
    username = _get_authenticated_username(token, db)
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user.sharing_enabled = bool(payload.sharing_enabled)
    db.commit()

    return {
        "username": user.username,
        "is_admin": bool(user.is_admin),
        "is_disabled": bool(getattr(user, "is_disabled", False)),
        "sharing_enabled": bool(user.sharing_enabled),
        "force_password_change": bool(user.force_password_change),
    }


# ── User Management ────────────────────────────────────────────────────────────

@app.get("/api/admin/ui.js")
def get_admin_ui_bundle(
    admin: str = Depends(_get_current_admin),
):
    """Serve admin UI JavaScript only to authenticated admins."""
    _ = admin
    try:
        with open(ADMIN_UI_BUNDLE_PATH, "r", encoding="utf-8") as bundle_file:
            content = bundle_file.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to load admin UI bundle") from exc

    return Response(content=content, media_type="application/javascript")

@app.get("/api/users", response_model=list[schemas.UserOut])
def list_users(
    admin: str = Depends(_get_current_admin),
    db: Session = Depends(get_db),
):
    """List all users (admin only)."""
    users = db.query(models.User).order_by(models.User.created_at).all()
    original_admin = _get_original_admin_username()
    return [
        {
            "username": user.username,
            "is_admin": bool(user.is_admin),
            "is_disabled": bool(getattr(user, "is_disabled", False)),
            "is_system_account": bool(original_admin and str(user.username or "").lower() == original_admin),
            "force_password_change": bool(user.force_password_change),
            "created_at": user.created_at,
        }
        for user in users
    ]


@app.get("/api/admin/analytics")
def get_admin_analytics(
    admin: str = Depends(_get_current_admin),
    db: Session = Depends(get_db),
    span: str = Query(default="14d"),
):
    """Return aggregate platform/user activity analytics for admins."""
    _ = admin

    def _as_utc(value: Any) -> Optional[datetime]:
        if not isinstance(value, datetime):
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _as_iso(value: Any) -> str:
        dt = _as_utc(value)
        return dt.isoformat() if dt else ""

    def _day_key(value: Any) -> str:
        dt = _as_utc(value)
        return dt.date().isoformat() if dt else ""

    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)
    since_7d = now - timedelta(days=7)
    since_30d = now - timedelta(days=30)

    # helper to add months to a datetime (used for monthly buckets)
    def _add_months(dt: datetime, months: int) -> datetime:
        year = dt.year + (dt.month - 1 + months) // 12
        month = (dt.month - 1 + months) % 12 + 1
        return dt.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)

    # Determine buckets and labels based on requested span
    _span = (str(span or "14d")).strip().lower()
    resolution = 'day'
    bucket_datetimes: list[datetime] = []
    labels: list[str] = []
    bucket_keys: list[str] = []
    filter_since = (now - timedelta(days=13)).replace(hour=0, minute=0, second=0, microsecond=0)

    if _span in ('24h', '24', 'hour', 'last24h'):
        resolution = 'hour'
        bucket_count = 24
        start_dt = (now - timedelta(hours=bucket_count - 1)).replace(minute=0, second=0, microsecond=0)
        bucket_datetimes = [start_dt + timedelta(hours=i) for i in range(bucket_count)]
        bucket_keys = [dt.replace(minute=0, second=0, microsecond=0).isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %d %H:00") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    elif _span in ('7d', '7', 'week', 'last7d'):
        resolution = 'day'
        bucket_count = 7
        start_dt = (now - timedelta(days=bucket_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        bucket_datetimes = [start_dt + timedelta(days=i) for i in range(bucket_count)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %d") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    elif _span in ('30d', '30', 'month', 'last30d'):
        resolution = 'day'
        bucket_count = 30
        start_dt = (now - timedelta(days=bucket_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        bucket_datetimes = [start_dt + timedelta(days=i) for i in range(bucket_count)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %d") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    elif _span in ('all', 'alltime', 'all-time', 'all_time'):
        resolution = 'month'
        # Determine earliest created_at across pages and users to build month buckets from first activity
        page_min = db.query(func.min(models.Page.created_at)).scalar()
        user_min = db.query(func.min(models.User.created_at)).scalar()
        first_dt = None
        for cand in (page_min, user_min):
            cand_dt = _as_utc(cand)
            if cand_dt is None:
                continue
            if first_dt is None or cand_dt < first_dt:
                first_dt = cand_dt
        if first_dt is None:
            first_dt = now
        first_month = first_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        months = (now.year - first_month.year) * 12 + (now.month - first_month.month) + 1
        # cap to a sensible max (e.g., 240 months = 20 years) to avoid extremely large arrays
        max_months = 240
        months = min(max_months, max(1, months))
        bucket_datetimes = [_add_months(first_month, i) for i in range(months)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %Y") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    elif _span in ('365d', '365', 'year', 'last365d', 'lastyear'):
        resolution = 'month'
        # build last 12 months (month-start datetimes)
        start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        first_month = _add_months(start_month, -11)
        bucket_datetimes = [_add_months(first_month, i) for i in range(12)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %Y") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    else:
        # default: last 14 days
        resolution = 'day'
        bucket_count = 14
        start_dt = (now - timedelta(days=bucket_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        bucket_datetimes = [start_dt + timedelta(days=i) for i in range(bucket_count)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %d") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]

    original_admin = _get_original_admin_username()
    users = db.query(models.User).all()
    user_by_username = {str(user.username or ""): user for user in users}

    total_users = len(users)
    admin_users = sum(1 for user in users if bool(user.is_admin))
    disabled_users = sum(1 for user in users if bool(getattr(user, "is_disabled", False)))
    enabled_users = max(0, total_users - disabled_users)
    force_password_change_users = sum(1 for user in users if bool(user.force_password_change))
    system_account_users = sum(
        1 for user in users
        if original_admin and str(user.username or "").lower() == original_admin
    )

    valid_since = now - timedelta(days=SESSION_TTL_DAYS)
    active_sessions = int(
        db.query(func.count(models.AuthSession.id))
        .filter(func.coalesce(models.AuthSession.last_used_at, models.AuthSession.created_at) >= valid_since)
        .scalar() or 0
    )
    users_with_active_sessions = int(
        db.query(func.count(func.distinct(models.AuthSession.username)))
        .filter(func.coalesce(models.AuthSession.last_used_at, models.AuthSession.created_at) >= valid_since)
        .scalar() or 0
    )

    total_saves = int(db.query(func.count(models.Page.id)).scalar() or 0)
    recipes_count = int(db.query(func.count(models.Page.id)).filter(models.Page.is_recipe.is_(True)).scalar() or 0)
    music_count = int(db.query(func.count(models.Page.id)).filter(models.Page.is_music.is_(True)).scalar() or 0)
    # Recent per-type counts (24h / 7d)
    recipes_last_24h = int(db.query(func.count(models.Page.id)).filter(models.Page.is_recipe.is_(True), models.Page.created_at >= since_24h).scalar() or 0)
    recipes_last_7d = int(db.query(func.count(models.Page.id)).filter(models.Page.is_recipe.is_(True), models.Page.created_at >= since_7d).scalar() or 0)
    music_last_24h = int(db.query(func.count(models.Page.id)).filter(models.Page.is_music.is_(True), models.Page.created_at >= since_24h).scalar() or 0)
    music_last_7d = int(db.query(func.count(models.Page.id)).filter(models.Page.is_music.is_(True), models.Page.created_at >= since_7d).scalar() or 0)
    shared_received_count = int(db.query(func.count(models.Page.id)).filter(models.Page.is_shared_received.is_(True)).scalar() or 0)
    shared_sent_count = int(db.query(func.count(models.Page.id)).filter(models.Page.is_shared_sent.is_(True)).scalar() or 0)
    # Count only completed recipient-side shares so each share is counted once.
    shared_total_count = int(
        db.query(func.count(models.Page.id))
        .filter(
            models.Page.is_shared_received.is_(True),
            models.Page.share_status == "accepted",
        )
        .scalar()
        or 0
    )
    pending_share_requests = int(
        db.query(func.count(models.Page.id)).filter(models.Page.share_status == "pending").scalar() or 0
    )
    # Accepted / declined share counts and unique domain count
    # accepted shares: count of completed recipient-side shares (same as shared_total_count above)
    accepted_shares = int(db.query(func.count(models.Page.id))
                           .filter(models.Page.is_shared_received.is_(True), models.Page.share_status == "accepted")
                           .scalar() or 0)
    declined_shares = int(db.query(func.count(models.Page.id))
                           .filter(models.Page.is_shared_received.is_(True), models.Page.share_status == "declined")
                           .scalar() or 0)
    unique_domains = int(db.query(func.count(func.distinct(models.Page.domain))).filter(models.Page.domain != "").scalar() or 0)
    saves_last_24h = int(db.query(func.count(models.Page.id)).filter(models.Page.created_at >= since_24h).scalar() or 0)
    saves_last_7d = int(db.query(func.count(models.Page.id)).filter(models.Page.created_at >= since_7d).scalar() or 0)
    signups_last_30d = int(db.query(func.count(models.User.id)).filter(models.User.created_at >= since_30d).scalar() or 0)

    # initialize bucket counters
    saves_by_bucket = {key: 0 for key in bucket_keys}
    signups_by_bucket = {key: 0 for key in bucket_keys}
    share_requests_by_bucket = {key: 0 for key in bucket_keys}
    share_accepted_by_bucket = {key: 0 for key in bucket_keys}
    share_declined_by_bucket = {key: 0 for key in bucket_keys}

    def _bucket_key(value: Any) -> str:
        dt = _as_utc(value)
        if not dt:
            return ""
        if resolution == 'hour':
            return dt.replace(minute=0, second=0, microsecond=0).isoformat()
        if resolution == 'day':
            return dt.date().isoformat()
        if resolution == 'month':
            return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0).date().isoformat()
        return dt.date().isoformat()

    for (created_at,) in db.query(models.Page.created_at).filter(models.Page.created_at >= filter_since).all():
        key = _bucket_key(created_at)
        if key in saves_by_bucket:
            saves_by_bucket[key] += 1

    for (created_at,) in db.query(models.User.created_at).filter(models.User.created_at >= filter_since).all():
        key = _bucket_key(created_at)
        if key in signups_by_bucket:
            signups_by_bucket[key] += 1

    # populate share metrics
    for (created_at,) in db.query(models.Page.created_at).filter(models.Page.created_at >= filter_since, models.Page.share_status == "pending").all():
        key = _bucket_key(created_at)
        if key in share_requests_by_bucket:
            share_requests_by_bucket[key] += 1

    for (created_at,) in db.query(models.Page.created_at).filter(models.Page.created_at >= filter_since, models.Page.is_shared_received.is_(True), models.Page.share_status == "accepted").all():
        key = _bucket_key(created_at)
        if key in share_accepted_by_bucket:
            share_accepted_by_bucket[key] += 1

    for (created_at,) in db.query(models.Page.created_at).filter(models.Page.created_at >= filter_since, models.Page.is_shared_received.is_(True), models.Page.share_status == "declined").all():
        key = _bucket_key(created_at)
        if key in share_declined_by_bucket:
            share_declined_by_bucket[key] += 1

    top_user_rows = (
        db.query(
            models.Page.owner.label("owner"),
            func.count(models.Page.id).label("save_count"),
            func.count(func.distinct(models.Page.profile)).label("profile_count"),
            func.max(models.Page.created_at).label("last_save_at"),
        )
        .group_by(models.Page.owner)
        .order_by(func.count(models.Page.id).desc(), models.Page.owner.asc())
        .limit(12)
        .all()
    )

    top_users: list[dict[str, Any]] = []
    for row in top_user_rows:
        username = str(row.owner or "")
        user = user_by_username.get(username)
        top_users.append({
            "username": username,
            "save_count": int(row.save_count or 0),
            "profile_count": int(row.profile_count or 0),
            "last_save_at": _as_iso(row.last_save_at),
            "is_admin": bool(user.is_admin) if user else False,
            "is_disabled": bool(getattr(user, "is_disabled", False)) if user else False,
            "is_system_account": bool(original_admin and username.lower() == original_admin),
        })

    # Top domains by save count using a percentage cutoff: show domains
    # that account for >= 1% of all domain saves, group the rest into "Other".
    total_domain_saves = int(db.query(func.count(models.Page.id)).filter(models.Page.domain != "").scalar() or 0)

    top_domains: list[dict[str, Any]] = []
    if total_domain_saves > 0:
        domain_rows = (
            db.query(
                models.Page.domain.label("domain"),
                func.count(models.Page.id).label("save_count"),
            )
            .filter(models.Page.domain != "")
            .group_by(models.Page.domain)
            .order_by(func.count(models.Page.id).desc(), models.Page.domain.asc())
            .all()
        )

        sum_top = 0
        for row in domain_rows:
            cnt = int(row.save_count or 0)
            # include domains contributing >=1% of total domain saves
            if cnt * 100 >= total_domain_saves:  # equivalent to cnt/total >= 0.01
                top_domains.append({
                    "domain": str(row.domain or ""),
                    "save_count": cnt,
                })
                sum_top += cnt

        other_count = max(0, total_domain_saves - sum_top)
        if other_count > 0:
            top_domains.append({"domain": "Other", "save_count": other_count})

    return {
        "generated_at": now.isoformat(),
        "users": {
            "total": total_users,
            "enabled": enabled_users,
            "disabled": disabled_users,
            "admins": admin_users,
            "system_accounts": system_account_users,
            "force_password_change": force_password_change_users,
            "with_active_sessions": users_with_active_sessions,
            "signups_last_30d": signups_last_30d,
        },
        "sessions": {
            "active": active_sessions,
        },
        "saves": {
            "total": total_saves,
            "recipes": recipes_count,
            "music": music_count,
            "recipes_last_24h": recipes_last_24h,
            "recipes_last_7d": recipes_last_7d,
            "music_last_24h": music_last_24h,
            "music_last_7d": music_last_7d,
            "shared_total": shared_total_count,
            "accepted_shares": accepted_shares,
            "declined_shares": declined_shares,
            "unique_domains": unique_domains,
            "shared_received": shared_received_count,
            "shared_sent": shared_sent_count,
            "pending_share_requests": pending_share_requests,
            "created_last_24h": saves_last_24h,
            "created_last_7d": saves_last_7d,
        },
        "trends": {
            "labels": labels,
            "saves": [saves_by_bucket.get(key, 0) for key in bucket_keys],
            "signups": [signups_by_bucket.get(key, 0) for key in bucket_keys],
            "share_requests": [share_requests_by_bucket.get(key, 0) for key in bucket_keys],
            "share_accepted": [share_accepted_by_bucket.get(key, 0) for key in bucket_keys],
            "share_declined": [share_declined_by_bucket.get(key, 0) for key in bucket_keys],
        },
        "top_users": top_users,
        "top_domains": top_domains,
    }


@app.get("/api/admin/user-analytics")
def get_admin_user_analytics(
    username: str = Query(...),
    span: str = Query(default="14d"),
    admin: str = Depends(_get_current_admin),
    db: Session = Depends(get_db),
):
    """Return per-user analytics for admins (trends, totals, top domains/tags)."""
    _ = admin

    def _as_utc(value: Any) -> Optional[datetime]:
        if not isinstance(value, datetime):
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _as_iso(value: Any) -> str:
        dt = _as_utc(value)
        return dt.isoformat() if dt else ""

    def _bucket_key(value: Any) -> str:
        dt = _as_utc(value)
        if not dt:
            return ""
        # bucketing follows the same resolution used by platform analytics
        try:
            if resolution == 'hour':
                return dt.replace(minute=0, second=0, microsecond=0).isoformat()
            if resolution == 'day':
                return dt.date().isoformat()
            if resolution == 'month':
                return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0).date().isoformat()
        except Exception:
            pass
        return dt.date().isoformat()

    now = datetime.now(timezone.utc)
    since_7d = now - timedelta(days=7)
    since_30d = now - timedelta(days=30)

    # derive buckets/labels from span (simple fallback to 14d daily)
    _span = (str(span or "14d")).strip().lower()
    resolution = 'day'
    bucket_datetimes: list[datetime] = []
    labels: list[str] = []
    bucket_keys: list[str] = []
    filter_since = (now - timedelta(days=13)).replace(hour=0, minute=0, second=0, microsecond=0)

    # helper to add months to a datetime (used for monthly buckets)
    def _add_months(dt: datetime, months: int) -> datetime:
        year = dt.year + (dt.month - 1 + months) // 12
        month = (dt.month - 1 + months) % 12 + 1
        return dt.replace(year=year, month=month, day=1, hour=0, minute=0, second=0, microsecond=0)

    if _span in ('24h', '24', 'hour', 'last24h'):
        resolution = 'hour'
        bucket_count = 24
        start_dt = (now - timedelta(hours=bucket_count - 1)).replace(minute=0, second=0, microsecond=0)
        bucket_datetimes = [start_dt + timedelta(hours=i) for i in range(bucket_count)]
        bucket_keys = [dt.replace(minute=0, second=0, microsecond=0).isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %d %H:00") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    elif _span in ('7d', '7', 'week', 'last7d'):
        resolution = 'day'
        bucket_count = 7
        start_dt = (now - timedelta(days=bucket_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        bucket_datetimes = [start_dt + timedelta(days=i) for i in range(bucket_count)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %d") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    elif _span in ('30d', '30', 'month', 'last30d'):
        resolution = 'day'
        bucket_count = 30
        start_dt = (now - timedelta(days=bucket_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        bucket_datetimes = [start_dt + timedelta(days=i) for i in range(bucket_count)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %d") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    elif _span in ('all', 'alltime', 'all-time', 'all_time'):
        resolution = 'month'
        # Determine earliest created_at across pages and users to build month buckets from first activity
        page_min = db.query(func.min(models.Page.created_at)).scalar()
        user_min = db.query(func.min(models.User.created_at)).scalar()
        first_dt = None
        for cand in (page_min, user_min):
            cand_dt = _as_utc(cand)
            if cand_dt is None:
                continue
            if first_dt is None or cand_dt < first_dt:
                first_dt = cand_dt
        if first_dt is None:
            first_dt = now
        first_month = first_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        months = (now.year - first_month.year) * 12 + (now.month - first_month.month) + 1
        # cap to a sensible max (e.g., 240 months = 20 years) to avoid extremely large arrays
        max_months = 240
        months = min(max_months, max(1, months))
        bucket_datetimes = [_add_months(first_month, i) for i in range(months)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %Y") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    elif _span in ('365d', '365', 'year', 'last365d', 'lastyear'):
        resolution = 'month'
        # build last 12 months (month-start datetimes)
        start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        first_month = _add_months(start_month, -11)
        bucket_datetimes = [_add_months(first_month, i) for i in range(12)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %Y") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]
    else:
        # default: last 14 days
        resolution = 'day'
        bucket_count = 14
        start_dt = (now - timedelta(days=bucket_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        bucket_datetimes = [start_dt + timedelta(days=i) for i in range(bucket_count)]
        bucket_keys = [dt.date().isoformat() for dt in bucket_datetimes]
        labels = [dt.strftime("%b %d") for dt in bucket_datetimes]
        filter_since = bucket_datetimes[0]

    normalized_username = str(username or "").strip()
    user = db.query(models.User).filter(models.User.username == normalized_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    total_saves = int(db.query(func.count(models.Page.id)).filter(models.Page.owner == normalized_username).scalar() or 0)
    saves_last_7d = int(db.query(func.count(models.Page.id)).filter(models.Page.owner == normalized_username, models.Page.created_at >= since_7d).scalar() or 0)
    saves_last_30d = int(db.query(func.count(models.Page.id)).filter(models.Page.owner == normalized_username, models.Page.created_at >= since_30d).scalar() or 0)
    last_save_at = db.query(func.max(models.Page.created_at)).filter(models.Page.owner == normalized_username).scalar()

    # bucket counts
    saves_by_bucket = {key: 0 for key in bucket_keys}
    for (created_at,) in db.query(models.Page.created_at).filter(models.Page.owner == normalized_username, models.Page.created_at >= filter_since).all():
        key = _bucket_key(created_at)
        if key in saves_by_bucket:
            saves_by_bucket[key] += 1

    # top domains for this user
    domain_rows = (
        db.query(
            models.Page.domain.label("domain"),
            func.count(models.Page.id).label("save_count"),
        )
        .filter(models.Page.owner == normalized_username, models.Page.domain != "")
        .group_by(models.Page.domain)
        .order_by(func.count(models.Page.id).desc(), models.Page.domain.asc())
        .all()
    )
    top_domains: list[dict[str, Any]] = []
    for row in domain_rows:
        cnt = int(row.save_count or 0)
        if cnt > 0:
            top_domains.append({"domain": str(row.domain or ""), "save_count": cnt})
    # limit to top 12
    if len(top_domains) > 12:
        top_domains = top_domains[:12]

    # Do not collect per-user tags here to avoid exposing personal tag data.
    # Tags are intentionally omitted for privacy.

    # last session for user
    last_session_at = db.query(func.max(func.coalesce(models.AuthSession.last_used_at, models.AuthSession.created_at))).filter(models.AuthSession.username == normalized_username).scalar()

    return {
        "generated_at": now.isoformat(),
        "username": normalized_username,
        "exists": True,
        "user": {
            "created_at": _as_iso(user.created_at),
            "is_admin": bool(user.is_admin),
            "is_disabled": bool(getattr(user, "is_disabled", False)),
        },
        "saves": {
            "total": total_saves,
            "created_last_7d": saves_last_7d,
            "created_last_30d": saves_last_30d,
        },
        "trends": {
            "labels": labels,
            "saves": [saves_by_bucket.get(key, 0) for key in bucket_keys],
        },
        "top_domains": top_domains,
        "last_save_at": _as_iso(last_save_at),
        "last_session_at": _as_iso(last_session_at),
    }


@app.delete("/api/users/{username}", status_code=204)
def delete_user(
    username: str,
    admin: str = Depends(_get_current_admin),
    db: Session = Depends(get_db),
):
    """Delete a user (admin only). Cannot delete yourself."""
    normalized_username = _normalize_username(username)
    if normalized_username == _get_original_admin_username():
        raise HTTPException(status_code=400, detail="Cannot delete the original admin account")
    if normalized_username == admin.lower():
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = db.query(models.User).filter(models.User.username == normalized_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db.delete(user)
    db.query(models.AuthSession).filter(models.AuthSession.username == normalized_username).delete(synchronize_session=False)
    db.commit()


@app.patch("/api/users/{username}", response_model=schemas.UserOut)
def update_user(
    username: str,
    payload: schemas.UserUpdate,
    admin: str = Depends(_get_current_admin),
    db: Session = Depends(get_db),
):
    """Update user properties (admin only)."""
    normalized_username = _normalize_username(username)
    user = db.query(models.User).filter(models.User.username == normalized_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_original_admin = normalized_username == _get_original_admin_username()
    
    if payload.is_admin is not None:
        if is_original_admin and not payload.is_admin:
            raise HTTPException(status_code=400, detail="Cannot revoke original admin privileges")
        # Prevent removing admin from yourself
        if normalized_username == admin.lower() and not payload.is_admin:
            raise HTTPException(status_code=400, detail="Cannot revoke your own admin status")
        user.is_admin = payload.is_admin

    if payload.is_disabled is not None:
        # Prevent disabling yourself unless this is the original admin account.
        if normalized_username == admin.lower() and payload.is_disabled and not is_original_admin:
            raise HTTPException(status_code=400, detail="Cannot disable your own account")
        user.is_disabled = payload.is_disabled
        if payload.is_disabled:
            db.query(models.AuthSession).filter(models.AuthSession.username == normalized_username).delete(synchronize_session=False)
    
    if payload.force_password_change is not None:
        if is_original_admin and payload.force_password_change:
            raise HTTPException(status_code=400, detail="Cannot force password change for the original admin account")
        user.force_password_change = payload.force_password_change
    
    db.commit()
    return user


@app.post("/api/users/{username}/password/reset", response_model=dict)
def reset_user_password(
    username: str,
    admin: str = Depends(_get_current_admin),
    db: Session = Depends(get_db),
):
    """Generate a temporary password for a user (admin only)."""
    normalized_username = _normalize_username(username)
    if normalized_username == _get_original_admin_username():
        raise HTTPException(status_code=400, detail="Cannot reset password for the original admin account")

    user = db.query(models.User).filter(models.User.username == normalized_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Generate a random temporary password (alphanumeric only for clarity)
    import string
    chars = string.ascii_letters + string.digits
    temp_password = ''.join(secrets.choice(chars) for _ in range(16))
    
    # Hash and set the temporary password
    user.password_hash = _hash_password(temp_password)
    user.force_password_change = True
    
    # Clear all existing sessions for this user
    db.query(models.AuthSession).filter(models.AuthSession.username == normalized_username).delete(synchronize_session=False)
    
    db.commit()
    
    return {
        "message": f"Temporary password set for {username}. Temporary password not returned for security reasons.",
        "note": "User must change password on next login. Deliver the temporary password to the user securely out-of-band.",
    }


@app.post("/api/users/{username}/password/force-change", status_code=204)
def force_password_change(
    username: str,
    admin: str = Depends(_get_current_admin),
    db: Session = Depends(get_db),
):
    """Force a user to change their password on next login (admin only)."""
    normalized_username = _normalize_username(username)
    if normalized_username == _get_original_admin_username():
        raise HTTPException(status_code=400, detail="Cannot force password change for the original admin account")

    user = db.query(models.User).filter(models.User.username == normalized_username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.force_password_change = True
    db.commit()


# ── Contacts / Friends ────────────────────────────────────────────────────────

@app.get("/api/contacts", response_model=list[schemas.ContactOut])
def list_contacts(
    current_owner: str = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # Only return mutual contacts (both users have added each other)
    c2 = aliased(models.Contact)
    return (
        db.query(models.Contact)
        .join(
            c2,
            (models.Contact.contact_username == c2.owner)
            & (c2.contact_username == models.Contact.owner),
        )
        .filter(models.Contact.owner == current_owner)
        .order_by(models.Contact.created_at.asc())
        .all()
    )


@app.post("/api/contact-requests", response_model=schemas.ContactRequestOut, status_code=201)
def create_contact_request(
    payload: schemas.ContactRequestCreate,
    current_owner: str = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    recipient = _normalize_username(payload.recipient_username)
    if recipient == current_owner:
        raise HTTPException(status_code=400, detail="Cannot request yourself as a contact")
    recipient_user = db.query(models.User).filter(models.User.username == recipient).first()
    if not recipient_user:
        raise HTTPException(status_code=404, detail="User not found")

    # If they are already mutual contacts, nothing to do
    existing_mutual = (
        db.query(models.Contact)
        .filter(models.Contact.owner == current_owner, models.Contact.contact_username == recipient)
        .first()
        and db.query(models.Contact)
        .filter(models.Contact.owner == recipient, models.Contact.contact_username == current_owner)
        .first()
    )
    if existing_mutual:
        raise HTTPException(status_code=409, detail="Already contacts")

    # If recipient already sent a request to current_owner, auto-accept and create mutual contacts
    reciprocal = (
        db.query(models.ContactRequest)
        .filter(models.ContactRequest.requester_username == recipient, models.ContactRequest.recipient_username == current_owner)
        .first()
    )
    if reciprocal:
        # create both Contact entries if not present
        one = db.query(models.Contact).filter(models.Contact.owner == current_owner, models.Contact.contact_username == recipient).first()
        two = db.query(models.Contact).filter(models.Contact.owner == recipient, models.Contact.contact_username == current_owner).first()
        # use the message fields as aliases when available: payload.message for current_owner->recipient,
        # reciprocal.message for recipient->current_owner
        alias_for_current = payload.message or ""
        alias_for_recipient = reciprocal.message or ""
        if not one:
            db.add(models.Contact(owner=current_owner, contact_username=recipient, alias=alias_for_current))
        if not two:
            db.add(models.Contact(owner=recipient, contact_username=current_owner, alias=alias_for_recipient))
        # remove reciprocal request
        db.delete(reciprocal)
        db.commit()
        # return a synthetic ContactRequestOut indicating acceptance
        return models.ContactRequest(requester_username=recipient, recipient_username=current_owner, message=reciprocal.message)

    # Ensure no existing pending request from current_owner to recipient
    already = (
        db.query(models.ContactRequest)
        .filter(models.ContactRequest.requester_username == current_owner, models.ContactRequest.recipient_username == recipient)
        .first()
    )
    if already:
        raise HTTPException(status_code=409, detail="Request already sent")

    req = models.ContactRequest(requester_username=current_owner, recipient_username=recipient, message=payload.message or "")
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


@app.get("/api/contact-requests", response_model=list[schemas.ContactRequestOut])
def list_contact_requests(
    incoming: Optional[bool] = Query(default=True),
    current_owner: str = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    # By default return incoming requests (requests where current user is the recipient)
    if incoming:
        return (
            db.query(models.ContactRequest)
            .filter(models.ContactRequest.recipient_username == current_owner)
            .order_by(models.ContactRequest.created_at.asc())
            .all()
        )
    else:
        return (
            db.query(models.ContactRequest)
            .filter(models.ContactRequest.requester_username == current_owner)
            .order_by(models.ContactRequest.created_at.asc())
            .all()
        )


@app.post("/api/contact-requests/{request_id}/accept", status_code=204)
def accept_contact_request(
    request_id: int,
    current_owner: str = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    req = db.query(models.ContactRequest).filter(models.ContactRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.recipient_username != current_owner:
        raise HTTPException(status_code=403, detail="Not authorized to accept this request")

    requester = req.requester_username
    recipient = req.recipient_username
    # create both Contact entries if not present
    one = db.query(models.Contact).filter(models.Contact.owner == requester, models.Contact.contact_username == recipient).first()
    two = db.query(models.Contact).filter(models.Contact.owner == recipient, models.Contact.contact_username == requester).first()
    if not one:
        # use the request message as the requester's preferred alias for the recipient
        db.add(models.Contact(owner=requester, contact_username=recipient, alias=req.message or ""))
    if not two:
        db.add(models.Contact(owner=recipient, contact_username=requester, alias=""))
    db.delete(req)
    db.commit()


@app.delete("/api/contact-requests/{request_id}", status_code=204)
def delete_contact_request(
    request_id: int,
    current_owner: str = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    req = db.query(models.ContactRequest).filter(models.ContactRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    # allow requester to cancel or recipient to decline
    if req.requester_username != current_owner and req.recipient_username != current_owner:
        raise HTTPException(status_code=403, detail="Not authorized")
    db.delete(req)
    db.commit()


@app.delete("/api/contacts/{contact_username}", status_code=204)
def delete_contact(
    contact_username: str,
    current_owner: str = Depends(get_current_owner),
    db: Session = Depends(get_db),
):
    normalized = _normalize_username(contact_username)
    contact = (
        db.query(models.Contact)
        .filter(models.Contact.owner == current_owner, models.Contact.contact_username == normalized)
        .first()
    )
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()


CSV_COLUMNS = [
    "url",
    "title",
    "description",
    "domain",
    "tags",
    "is_recipe",
    "is_music",
    "recipe_ingredients",
    "recipe_instructions",
    "favicon",
    "notes",
    "device",
    "saved_via",
    "resave_count",
    "created_at",
    "is_shared_received",
    "is_shared_sent",
    "shared_by",
    "shared_to",
]

NATIVE_IMPORT_COLUMNS = [
    "url",
    "title",
    "description",
    "domain",
    "tags",
    "is_recipe",
    "is_music",
    "recipe_ingredients",
    "recipe_instructions",
    "favicon",
    "notes",
    "device",
    "saved_via",
    "created_at",
    "is_shared_received",
    "is_shared_sent",
    "shared_by",
    "shared_to",
]

NATIVE_IMPORT_COLUMNS_WITH_RESAVE = [
    "url",
    "title",
    "description",
    "domain",
    "tags",
    "is_recipe",
    "is_music",
    "recipe_ingredients",
    "recipe_instructions",
    "favicon",
    "notes",
    "device",
    "saved_via",
    "resave_count",
    "created_at",
    "is_shared_received",
    "is_shared_sent",
    "shared_by",
    "shared_to",
]

POCKET_IMPORT_COLUMNS = [
    "title",
    "url",
    "time_added",
    "tags",
    "status",
]

THIRD_PARTY_IMPORT_LABELS = {
    "pocket": "Mozilla Pocket (GetPocket)",
}


def _parse_bool(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _get_third_party_import_label(source: str) -> str:
    normalized_source = str(source or "").strip().lower()
    if not normalized_source or normalized_source == "native":
        return ""
    if normalized_source in THIRD_PARTY_IMPORT_LABELS:
        return THIRD_PARTY_IMPORT_LABELS[normalized_source]
    return normalized_source.replace("_", " ").replace("-", " ").title()


def _parse_created_at(value: str) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _normalize_csv_fieldname(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_csv_row(row: Optional[dict[str, Any]]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in (row or {}).items():
        normalized[_normalize_csv_fieldname(key)] = str(value or "")
    return normalized


def _is_native_export_columns(fieldnames: list[str]) -> bool:
    normalized = {_normalize_csv_fieldname(name) for name in fieldnames if name is not None}
    return {"url", "created_at"}.issubset(normalized)


def _is_pocket_export_columns(fieldnames: list[str]) -> bool:
    normalized = {_normalize_csv_fieldname(name) for name in fieldnames if name is not None}
    expected = {"title", "url", "time_added", "tags", "status"}
    return expected.issubset(normalized)


def _iter_positional_csv_rows(
    csv_text: str,
    default_columns: list[str],
    header_variants: list[list[str]],
    columns_by_row_length: Optional[list[tuple[int, list[str]]]] = None,
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    normalized_headers = [
        [_normalize_csv_fieldname(column) for column in header]
        for header in header_variants
    ]

    first_data_row_seen = False
    for raw_row in csv.reader(io.StringIO(csv_text)):
        if not raw_row or not any(str(cell or "").strip() for cell in raw_row):
            continue

        normalized_row = [_normalize_csv_fieldname(cell) for cell in raw_row]
        if not first_data_row_seen:
            first_data_row_seen = True
            if any(normalized_row == header for header in normalized_headers):
                continue

        selected_columns = default_columns
        if columns_by_row_length:
            for min_len, candidate_columns in columns_by_row_length:
                if len(raw_row) >= min_len:
                    selected_columns = candidate_columns
                    break

        mapped: dict[str, str] = {}
        for index, column in enumerate(selected_columns):
            mapped[column] = str(raw_row[index] if index < len(raw_row) else "")
        rows.append(mapped)

    return rows


def _parse_pocket_time_added(value: str) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None

    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        try:
            timestamp = float(text)
            # Pocket exports are usually epoch seconds; treat very large values as milliseconds.
            if timestamp > 10_000_000_000:
                timestamp = timestamp / 1000.0
            return datetime.fromtimestamp(timestamp, tz=timezone.utc)
        except Exception:
            pass

    return _parse_created_at(text)


def _normalize_pocket_tags(value: str) -> str:
    tags: list[str] = []
    seen: set[str] = set()
    for raw_tag in str(value or "").split("|"):
        tag = raw_tag.strip()
        if not tag:
            continue
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    return ", ".join(tags)


def _parse_non_negative_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(str(value or "").strip())
    except Exception:
        return default
    return max(0, parsed)


def _count_non_empty_lines(value: str) -> int:
    return len([line for line in str(value or "").split("\n") if line.strip()])


def _has_confident_recipe_data(recipe_ingredients: str, recipe_instructions: str) -> bool:
    ingredient_lines = _count_non_empty_lines(recipe_ingredients)
    instruction_lines = _count_non_empty_lines(recipe_instructions)

    # Avoid false positives from random description fragments.
    if ingredient_lines >= 2 and instruction_lines >= 2:
        return True
    if ingredient_lines >= 4 and instruction_lines >= 1:
        return True
    if instruction_lines >= 4 and ingredient_lines >= 1:
        return True
    return False


def _page_to_csv_row(page: models.Page) -> dict[str, str]:
    return {
        "url": page.url or "",
        "title": page.title or "",
        "description": page.description or "",
        "domain": page.domain or "",
        "tags": page.tags or "",
        "is_recipe": "1" if page.is_recipe else "0",
        "is_music": "1" if page.is_music else "0",
        "recipe_ingredients": page.recipe_ingredients or "",
        "recipe_instructions": page.recipe_instructions or "",
        "favicon": page.favicon or "",
        "notes": page.notes or "",
        "device": page.device or "",
        "saved_via": page.saved_via or "",
        "resave_count": str(max(0, int(page.resave_count or 0))),
        "is_shared_received": "1" if page.is_shared_received else "0",
        "is_shared_sent": "1" if page.is_shared_sent else "0",
        "shared_by": page.shared_by or "",
        "shared_to": page.shared_to or "",
        "created_at": page.created_at.isoformat() if page.created_at else "",
    }


def extract_domain(url: str) -> str:
    try:
        parsed = urlparse(url)
        return parsed.netloc.removeprefix("www.")
    except Exception:
        return ""


def _clean_music_query(text: str) -> str:
    value = (text or "").strip()
    if not value:
        return ""

    value = re.sub(r"\s+-\s+song and lyrics by\s+", " ", value, flags=re.I)
    value = re.sub(r"\s*[\[(](official video|official audio|lyrics?)[\])]", "", value, flags=re.I)
    value = re.sub(r"\s+(?:no\.?|#)\s*\d+\b", "", value, flags=re.I)
    value = re.sub(
        r"\s+[|\-]\s+(youtube music|youtube|spotify|apple music|soundcloud|bandcamp|deezer|tidal)$",
        "",
        value,
        flags=re.I,
    )
    value = re.sub(r"\s+[-|:]\s*$", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _build_music_query(title: str, artist: str = "") -> str:
    clean_title = _clean_music_query(title)
    clean_artist = _clean_music_query(artist.replace(" - Topic", ""))

    if clean_artist:
        artist_lower = clean_artist.lower()
        title_lower = clean_title.lower()

        if title_lower.endswith(" " + artist_lower):
            clean_title = clean_title[: -(len(clean_artist) + 1)].rstrip(" -|:")
            title_lower = clean_title.lower()

        if title_lower == artist_lower or title_lower.startswith(artist_lower + " -") or title_lower.startswith(artist_lower + ":"):
            return clean_title

    if clean_title and clean_artist:
        return f"{clean_title} {clean_artist}".strip()
    return clean_title or clean_artist


def _is_generic_music_title(title: str) -> bool:
    value = _clean_music_query(title).lower()
    return value in {
        "",
        "youtube music",
        "youtube",
        "spotify",
        "soundcloud",
        "bandcamp",
        "deezer",
        "tidal",
        "apple music",
    }


def _extract_youtube_video_id(raw_url: str) -> str:
    try:
        parsed = urlparse(raw_url)
    except Exception:
        return ""

    host = parsed.netloc.lower()
    if host.endswith("youtu.be"):
        video_id = parsed.path.strip("/").split("/")[0]
        return video_id
    if host.endswith("youtube.com") or host.endswith("youtube-nocookie.com"):
        query = parse_qs(parsed.query)
        video_id = str((query.get("v") or [""])[0] or "").strip()
        if video_id:
            return video_id

        path_parts = [part for part in parsed.path.split("/") if part]
        if len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed", "live"}:
            return path_parts[1]
    return ""


def _build_genius_search_url(query: str) -> str:
    return f"https://genius.com/search?{urlencode({'q': query})}"


async def resolve_music_lookup_query(url: str, fallback_title: str = "") -> str:
    clean_title = _clean_music_query(fallback_title)
    video_id = _extract_youtube_video_id(url)

    if video_id:
        oembed_url = f"https://www.youtube.com/oembed?{urlencode({'url': f'https://www.youtube.com/watch?v={video_id}', 'format': 'json'})}"
        try:
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                response = await client.get(oembed_url, headers={"User-Agent": "Mozilla/5.0 ProjectPocket/1.0"})
                response.raise_for_status()
            payload = response.json()
            query = _build_music_query(
                str(payload.get("title") or ""),
                str(payload.get("author_name") or ""),
            )
            if query and not _is_generic_music_title(query):
                return query
        except Exception:
            pass

    if clean_title and not _is_generic_music_title(clean_title):
        return clean_title

    try:
        parsed = urlparse(url)
        host_hint = parsed.netloc.removeprefix("www.")
    except Exception:
        host_hint = ""
    return clean_title or host_hint or "music"


async def fetch_page_meta(url: str) -> dict:
    """Fetch title, description, favicon and structured recipe data from a URL."""
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 ProjectPocket/1.0"})
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        title = ""
        if soup.title:
            title = soup.title.string or ""
        og_title = soup.find("meta", property="og:title")
        if og_title and og_title.get("content"):
            title = og_title["content"]

        description = ""
        description_candidates: list[str] = []
        desc_tag = soup.find("meta", attrs={"name": "description"})
        if desc_tag and desc_tag.get("content"):
            description = str(desc_tag["content"])
            description_candidates.append(description)
        og_desc = soup.find("meta", property="og:description")
        if og_desc and og_desc.get("content"):
            description = str(og_desc["content"])
            description_candidates.append(description)
        tw_desc = soup.find("meta", attrs={"name": "twitter:description"})
        if tw_desc and tw_desc.get("content"):
            description = str(tw_desc["content"])
            description_candidates.append(description)

        parsed = urlparse(url)
        favicon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
        recipe_data = extract_recipe_data(
            soup,
            preferred_texts=description_candidates,
            source_url=url,
        )

        return {
            "title": title.strip(),
            "description": description.strip(),
            "favicon": favicon,
            **recipe_data,
        }
    except Exception:
        return {
            "title": "",
            "description": "",
            "favicon": "",
            "recipe_ingredients": "",
            "recipe_instructions": "",
        }


# ── Pages ────────────────────────────────────────────────────────────────────

@app.get("/api/pages/export.csv")
def export_pages_csv(
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    rows = db.query(models.Page).filter(
        models.Page.owner == current_owner,
        models.Page.profile == current_profile,
    ).order_by(models.Page.created_at.asc(), models.Page.id.asc()).all()

    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    for page in rows:
        writer.writerow(_page_to_csv_row(page))

    filename = f"project-pocket-saves-{datetime.now(timezone.utc).date().isoformat()}.csv"
    return StreamingResponse(
        iter([stream.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/pages/import.csv")
async def import_pages_csv(
    file: UploadFile = File(...),
    source: str = Query("native"),
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    raw_bytes = await file.read()
    try:
        csv_text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(csv_text))
    normalized_fieldnames = [_normalize_csv_fieldname(name) for name in (reader.fieldnames or [])]

    normalized_source = str(source or "native").strip().lower()
    third_party_import_label = _get_third_party_import_label(normalized_source)
    if normalized_source not in {"native", "pocket"}:
        raise HTTPException(status_code=400, detail="Unsupported import source")

    if normalized_source == "native":
        if _is_pocket_export_columns(reader.fieldnames or []):
            raise HTTPException(
                status_code=400,
                detail="This looks like a Pocket CSV. Use the import source dropdown and select Mozilla Pocket.",
            )

        if _is_native_export_columns(reader.fieldnames or []):
            source_rows = [_normalize_csv_row(row) for row in reader]
        else:
            source_rows = _iter_positional_csv_rows(
                csv_text=csv_text,
                default_columns=NATIVE_IMPORT_COLUMNS,
                header_variants=[NATIVE_IMPORT_COLUMNS, NATIVE_IMPORT_COLUMNS_WITH_RESAVE],
                columns_by_row_length=[
                    (len(NATIVE_IMPORT_COLUMNS_WITH_RESAVE), NATIVE_IMPORT_COLUMNS_WITH_RESAVE),
                    (len(NATIVE_IMPORT_COLUMNS), NATIVE_IMPORT_COLUMNS),
                ],
            )
    else:
        if _is_native_export_columns(reader.fieldnames or []):
            raise HTTPException(
                status_code=400,
                detail="This looks like a Project Pocket CSV. Use the main Import CSV button.",
            )

        if _is_pocket_export_columns(reader.fieldnames or []):
            source_rows = [_normalize_csv_row(row) for row in reader]
        else:
            source_rows = _iter_positional_csv_rows(
                csv_text=csv_text,
                default_columns=POCKET_IMPORT_COLUMNS,
                header_variants=[POCKET_IMPORT_COLUMNS],
                columns_by_row_length=[(len(POCKET_IMPORT_COLUMNS), POCKET_IMPORT_COLUMNS)],
            )

    existing_keys = {
        (url or "", created_at.isoformat() if created_at else "")
        for url, created_at in db.query(models.Page.url, models.Page.created_at).filter(
            models.Page.owner == current_owner,
            models.Page.profile == current_profile,
        ).all()
    }

    imported = 0
    skipped = 0
    for row in source_rows:
        normalized_row = _normalize_csv_row(row)
        url = normalized_row.get("url", "").strip()
        if not url:
            skipped += 1
            continue

        if normalized_source == "pocket":
            created_at = _parse_pocket_time_added(normalized_row.get("time_added", ""))
        else:
            created_at = _parse_created_at(normalized_row.get("created_at", ""))

        dedupe_key = (url, created_at.isoformat() if created_at else "")
        if created_at and dedupe_key in existing_keys:
            skipped += 1
            continue

        if normalized_source == "pocket":
            page = models.Page(
                owner=current_owner,
                profile=current_profile,
                url=url,
                title=normalized_row.get("title", "").strip() or url,
                description="",
                domain=extract_domain(url),
                tags=_normalize_pocket_tags(normalized_row.get("tags", "")),
                is_recipe=False,
                is_music=False,
                recipe_ingredients="",
                recipe_instructions="",
                favicon="",
                notes="",
                device=f"Imported from {third_party_import_label}" if third_party_import_label else "",
                saved_via="pocket-import",
                resave_count=0,
                is_shared_received=False,
                is_shared_sent=False,
                shared_by="",
                shared_to="",
            )
        else:
            page = models.Page(
                owner=current_owner,
                profile=current_profile,
                url=url,
                title=normalized_row.get("title", "").strip() or url,
                description=normalized_row.get("description", "").strip(),
                domain=normalized_row.get("domain", "").strip() or extract_domain(url),
                tags=normalized_row.get("tags", "").strip(),
                is_recipe=_parse_bool(normalized_row.get("is_recipe", "")),
                is_music=_parse_bool(normalized_row.get("is_music", "")),
                recipe_ingredients=normalized_row.get("recipe_ingredients", ""),
                recipe_instructions=normalized_row.get("recipe_instructions", ""),
                favicon=normalized_row.get("favicon", "").strip(),
                notes=normalized_row.get("notes", ""),
                device=normalized_row.get("device", "").strip(),
                saved_via=normalized_row.get("saved_via", "").strip(),
                resave_count=_parse_non_negative_int(normalized_row.get("resave_count", "0")),
                is_shared_received=_parse_bool(normalized_row.get("is_shared_received", "")),
                is_shared_sent=_parse_bool(normalized_row.get("is_shared_sent", "")),
                shared_by=str(normalized_row.get("shared_by", "") or "").strip(),
                shared_to=str(normalized_row.get("shared_to", "") or "").strip(),
            )

        if created_at is not None:
            page.created_at = created_at

        _apply_category_tags(page)
        db.add(page)
        imported += 1

        if created_at:
            existing_keys.add(dedupe_key)

    db.commit()
    return {"imported": imported, "skipped": skipped}


@app.delete("/api/pages")
def delete_all_pages(
    confirm: str = Query(...),
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    if confirm.strip().upper() != "DELETE ALL":
        raise HTTPException(status_code=400, detail="Invalid confirmation text")

    deleted = db.query(models.Page).filter(
        models.Page.owner == current_owner,
        models.Page.profile == current_profile,
    ).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}

@app.get("/api/pages", response_model=list[schemas.PageOut])
def list_pages(
    domain: Optional[str] = None,
    tag: Optional[str] = None,
    is_recipe: Optional[bool] = None,
    is_music: Optional[bool] = None,
    shared_only: Optional[bool] = None,
    is_shared_received: Optional[bool] = None,
    is_shared_sent: Optional[bool] = None,
    exclude_recipe: Optional[bool] = None,
    exclude_music: Optional[bool] = None,
    exclude_shared_received: Optional[bool] = None,
    exclude_shared_sent: Optional[bool] = None,
    share_status: Optional[str] = None,
    search: Optional[str] = None,
    sort: str = Query("newest"),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    include_tag: Optional[list[str]] = Query(default=None),
    exclude_tag: Optional[list[str]] = Query(default=None),
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    q = db.query(models.Page).filter(
        models.Page.owner == current_owner,
        models.Page.profile == current_profile,
    )
    if domain:
        q = q.filter(models.Page.domain == domain)
    if is_recipe is not None:
        q = q.filter(models.Page.is_recipe == is_recipe)
    if is_music is not None:
        q = q.filter(models.Page.is_music == is_music)
    if shared_only:
        q = q.filter(models.Page.is_shared_received.is_(True) | models.Page.is_shared_sent.is_(True))
    if is_shared_received is not None:
        q = q.filter(models.Page.is_shared_received == is_shared_received)
    if is_shared_sent is not None:
        q = q.filter(models.Page.is_shared_sent == is_shared_sent)
    if exclude_recipe:
        q = q.filter(models.Page.is_recipe.is_(False))
    if exclude_music:
        q = q.filter(models.Page.is_music.is_(False))
    if exclude_shared_received:
        q = q.filter(models.Page.is_shared_received.is_(False))
    if exclude_shared_sent:
        q = q.filter(models.Page.is_shared_sent.is_(False))
    if share_status:
        q = q.filter(models.Page.share_status == share_status)
    if tag:
        q = q.filter(models.Page.tags.contains(tag))
    for include in include_tag or []:
        token = str(include or "").strip()
        if token:
            q = q.filter(models.Page.tags.ilike(f"%{token}%"))
    for exclude in exclude_tag or []:
        token = str(exclude or "").strip()
        if token:
            q = q.filter(~models.Page.tags.ilike(f"%{token}%"))
    if search:
        term = f"%{search}%"
        q = q.filter(
            models.Page.title.ilike(term)
            | models.Page.url.ilike(term)
            | models.Page.description.ilike(term)
        )

    sort_key = str(sort or "newest").strip().lower()
    if sort_key == "oldest":
        q = q.order_by(models.Page.created_at.asc(), models.Page.id.asc())
    elif sort_key == "resaves-desc":
        q = q.order_by(models.Page.resave_count.desc(), models.Page.created_at.desc(), models.Page.id.desc())
    elif sort_key == "title-asc":
        q = q.order_by(func.lower(models.Page.title).asc(), models.Page.created_at.desc(), models.Page.id.desc())
    elif sort_key == "title-desc":
        q = q.order_by(func.lower(models.Page.title).desc(), models.Page.created_at.desc(), models.Page.id.desc())
    elif sort_key == "tag-asc":
        q = q.order_by(func.lower(models.Page.tags).asc(), func.lower(models.Page.title).asc(), models.Page.id.desc())
    elif sort_key == "tag-desc":
        q = q.order_by(func.lower(models.Page.tags).desc(), func.lower(models.Page.title).asc(), models.Page.id.desc())
    else:
        q = q.order_by(models.Page.created_at.desc(), models.Page.id.desc())

    return q.offset(offset).limit(limit).all()


@app.get("/api/music/genius-search")
async def get_genius_search(query_url: str = Query(..., alias="url"), title: str = ""):
    query = await resolve_music_lookup_query(query_url, title)
    return {"query": query, "url": _build_genius_search_url(query)}


@app.post("/api/pages", response_model=schemas.PageOut, status_code=201)
async def create_page(
    payload: schemas.PageCreate,
    response: Response,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    meta = await fetch_page_meta(payload.url)

    incoming_title = str(payload.title or "").strip()
    incoming_title_is_manual = bool(payload.title_is_manual)
    title = incoming_title or meta["title"] or payload.url
    description = payload.description or meta["description"]
    recipe_ingredients = meta["recipe_ingredients"]
    recipe_instructions = meta["recipe_instructions"]
    is_recipe = bool(payload.is_recipe) or _has_confident_recipe_data(recipe_ingredients, recipe_instructions)

    existing_page = db.query(models.Page).filter(
        models.Page.owner == current_owner,
        models.Page.profile == current_profile,
        models.Page.url == payload.url,
    ).order_by(models.Page.created_at.desc(), models.Page.id.desc()).first()

    if existing_page:
        response.status_code = 200
        existing_page.resave_count = max(0, int(existing_page.resave_count or 0)) + 1

        if incoming_title and incoming_title_is_manual:
            existing_page.title = incoming_title
        elif (not existing_page.title) or existing_page.title == existing_page.url:
            existing_page.title = title
        if not (existing_page.description or "").strip() and description:
            existing_page.description = description
        if not (existing_page.domain or "").strip():
            existing_page.domain = extract_domain(payload.url)

        existing_page.tags = _merge_tag_strings(existing_page.tags or "", payload.tags or "")
        existing_page.is_recipe = bool(existing_page.is_recipe or is_recipe)
        existing_page.is_music = bool(existing_page.is_music or payload.is_music)

        if recipe_ingredients and not (existing_page.recipe_ingredients or "").strip():
            existing_page.recipe_ingredients = recipe_ingredients
        if recipe_instructions and not (existing_page.recipe_instructions or "").strip():
            existing_page.recipe_instructions = recipe_instructions
        if meta.get("favicon") and not (existing_page.favicon or "").strip():
            existing_page.favicon = str(meta.get("favicon") or "")

        existing_page.notes = _merge_notes(existing_page.notes or "", payload.notes or "")

        if str(payload.device or "").strip():
            existing_page.device = str(payload.device or "").strip()
        if str(payload.saved_via or "").strip():
            existing_page.saved_via = str(payload.saved_via or "").strip()

        _apply_category_tags(existing_page)
        _apply_auto_tags(existing_page, db)
        db.commit()
        db.refresh(existing_page)
        return existing_page

    page = models.Page(
        owner=current_owner,
        profile=current_profile,
        url=payload.url,
        title=title,
        description=description,
        domain=extract_domain(payload.url),
        tags=payload.tags or "",
        is_recipe=is_recipe,
        is_music=payload.is_music or False,
        recipe_ingredients=recipe_ingredients,
        recipe_instructions=recipe_instructions,
        favicon=meta["favicon"],
        notes=payload.notes or "",
        device=payload.device or "",
        saved_via=payload.saved_via or "",
        resave_count=0,
        is_shared_received=False,
        is_shared_sent=False,
        shared_by="",
        shared_to="",
    )
    _apply_category_tags(page)
    _apply_auto_tags(page, db)
    db.add(page)
    db.commit()
    db.refresh(page)
    return page


@app.post("/api/pages/{page_id}/share", response_model=schemas.PageShareOut)
def share_page(
    page_id: int,
    payload: schemas.PageShareIn,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    page = db.get(models.Page, page_id)
    if not page or page.owner != current_owner or page.profile != current_profile:
        raise HTTPException(status_code=404, detail="Page not found")

    recipient_username = _normalize_username(payload.recipient_username)
    if recipient_username == current_owner:
        raise HTTPException(status_code=400, detail="You cannot share a save with yourself")

    recipient_user = db.query(models.User).filter(models.User.username == recipient_username).first()
    if not recipient_user:
        raise HTTPException(status_code=404, detail="Recipient not found")

    recipient_profile = _normalize_profile(payload.recipient_profile or current_profile)
    existing_recipient_page = db.query(models.Page).filter(
        models.Page.owner == recipient_username,
        models.Page.profile == recipient_profile,
        models.Page.url == page.url,
    ).order_by(models.Page.created_at.desc(), models.Page.id.desc()).first()

    created_recipient_page = False

    if existing_recipient_page:
        # Duplicate share target already has this URL; drop the re-share without touching recipient state.
        pass
    else:
        shared_page = models.Page(
            owner=recipient_username,
            profile=recipient_profile,
            url=page.url,
            title=page.title or page.url,
            description=page.description or "",
            domain=page.domain or extract_domain(page.url),
            tags=page.tags or "",
            is_recipe=bool(page.is_recipe),
            is_music=bool(page.is_music),
            recipe_ingredients=page.recipe_ingredients or "",
            recipe_instructions=page.recipe_instructions or "",
            favicon=page.favicon or "",
            notes=page.notes or "",
            device=page.device or "",
            saved_via=page.saved_via or "",
            resave_count=0,
            is_shared_received=True,
            is_shared_sent=False,
            shared_by=current_owner,
            shared_to="",
            share_status="pending",
        )
        _apply_category_tags(shared_page)
        _apply_auto_tags(shared_page, db)
        db.add(shared_page)
        created_recipient_page = True

    if created_recipient_page:
        page.is_shared_sent = True
        page.shared_to = recipient_username

    db.commit()

    return {
        "page_id": page.id,
        "recipient_username": recipient_username,
        "recipient_profile": recipient_profile,
        "created_recipient_page": created_recipient_page,
    }


@app.post("/api/pages/{page_id}/share-accept")
def accept_share(
    page_id: int,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    page = db.get(models.Page, page_id)
    if not page or page.owner != current_owner or page.profile != current_profile:
        raise HTTPException(status_code=404, detail="Page not found")
    
    if not page.is_shared_received:
        raise HTTPException(status_code=400, detail="This page was not shared with you")
    
    if page.share_status != "pending":
        raise HTTPException(status_code=400, detail="This share has already been decided")
    
    page.share_status = "accepted"
    db.commit()
    
    return {"status": "accepted"}


@app.post("/api/pages/{page_id}/share-decline")
def decline_share(
    page_id: int,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    page = db.get(models.Page, page_id)
    if not page or page.owner != current_owner or page.profile != current_profile:
        raise HTTPException(status_code=404, detail="Page not found")
    
    if not page.is_shared_received:
        raise HTTPException(status_code=400, detail="This page was not shared with you")
    
    if page.share_status != "pending":
        raise HTTPException(status_code=400, detail="This share has already been decided")
    
    page.share_status = "declined"
    db.commit()
    
    return {"status": "declined"}


@app.get("/api/pages/{page_id}", response_model=schemas.PageOut)
def get_page(
    page_id: int,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    page = db.get(models.Page, page_id)
    if not page or page.owner != current_owner or page.profile != current_profile:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


@app.patch("/api/pages/{page_id}", response_model=schemas.PageOut)
async def update_page(
    page_id: int,
    payload: schemas.PageUpdate,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    page = db.get(models.Page, page_id)
    if not page or page.owner != current_owner or page.profile != current_profile:
        raise HTTPException(status_code=404, detail="Page not found")

    updates = payload.model_dump(exclude_none=True)
    if "tags" in updates:
        page.tags = _merge_tag_strings("", updates.pop("tags") or "")
    if "notes" in updates:
        page.notes = _merge_notes(page.notes or "", updates.pop("notes") or "")

    for field, value in updates.items():
        setattr(page, field, value)
    if page.is_recipe and not (page.recipe_ingredients or page.recipe_instructions):
        meta = await fetch_page_meta(page.url)
        page.recipe_ingredients = meta["recipe_ingredients"]
        page.recipe_instructions = meta["recipe_instructions"]
    _apply_category_tags(page)
    db.commit()
    db.refresh(page)
    return page


@app.delete("/api/pages/{page_id}", status_code=204)
def delete_page(
    page_id: int,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    page = db.get(models.Page, page_id)
    if not page or page.owner != current_owner or page.profile != current_profile:
        raise HTTPException(status_code=404, detail="Page not found")
    db.delete(page)
    db.commit()


# ── Auto-tag rules ───────────────────────────────────────────────────────────

@app.get("/api/auto-tag-rules", response_model=list[schemas.AutoTagRuleOut])
def list_rules(
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    return db.query(models.AutoTagRule).filter(
        models.AutoTagRule.owner == current_owner,
        models.AutoTagRule.profile == current_profile,
    ).all()


@app.post("/api/auto-tag-rules", response_model=schemas.AutoTagRuleOut, status_code=201)
def create_rule(
    payload: schemas.AutoTagRuleCreate,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    allowed_types = (
        "domain",
        "domain_wildcard",
        "url_contains",
        "url_wildcard",
        "title_contains",
        "title_wildcard",
        "device_or_origin_contains",
    )
    if payload.match_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="match_type must be one of: domain, domain_wildcard, url_contains, url_wildcard, title_contains, title_wildcard, device_or_origin_contains",
        )
    rule = models.AutoTagRule(owner=current_owner, profile=current_profile, **payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@app.delete("/api/auto-tag-rules/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    rule = db.get(models.AutoTagRule, rule_id)
    if not rule or rule.owner != current_owner or rule.profile != current_profile:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()


# ── Domains ──────────────────────────────────────────────────────────────────

@app.get("/api/domains")
def list_domains(
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    rows = db.query(models.Page.domain).filter(
        models.Page.owner == current_owner,
        models.Page.profile == current_profile,
    ).distinct().all()
    return [r[0] for r in rows if r[0]]


# ── Tags ─────────────────────────────────────────────────────────────────────

@app.get("/api/tags")
def list_tags(
    current_owner: str = Depends(get_current_owner),
    current_profile: str = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    rows = db.query(models.Page.tags).filter(
        models.Page.owner == current_owner,
        models.Page.profile == current_profile,
    ).all()
    tags: set[str] = set()
    for (tag_str,) in rows:
        for t in (tag_str or "").split(","):
            t = t.strip()
            if t:
                tags.add(t)
    return sorted(tags)


@app.get("/api/profiles")
def list_profiles(current_owner: str = Depends(get_current_owner), db: Session = Depends(get_db)):
    rows = db.query(models.Page.profile).filter(models.Page.owner == current_owner).distinct().all()
    profiles = sorted({_normalize_profile(row[0]) for row in rows if row and row[0]})
    return profiles


@app.post("/api/ingredients/canonicalize", response_model=schemas.IngredientCanonicalizeOut)
async def canonicalize_ingredients(
    payload: schemas.IngredientCanonicalizeIn,
    current_owner: str = Depends(get_current_owner),
):
    _ = current_owner  # Endpoint is auth-protected; user identity is verified via dependency.

    deduped_inputs: list[str] = []
    seen: set[str] = set()
    for raw_item in (payload.items or []):
        item = str(raw_item or "").strip()
        if not item:
            continue
        if item in seen:
            continue
        seen.add(item)
        deduped_inputs.append(item[:240])
        if len(deduped_inputs) >= 250:
            break

    canonical_values = await asyncio.gather(*[_canonicalize_ingredient_text(item) for item in deduped_inputs])
    rows = [
        {"input": item, "canonical": canonical or _normalize_ingredient_text_for_match(item)}
        for item, canonical in zip(deduped_inputs, canonical_values)
    ]
    return {"items": rows}
