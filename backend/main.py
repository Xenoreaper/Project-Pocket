from fastapi import FastAPI, Depends, HTTPException, Query, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from urllib.parse import urlencode, urlparse
from datetime import datetime, timezone
import os
import csv
import io
import re
import json
import httpx
from bs4 import BeautifulSoup
from typing import Any, Optional

from database import Base, engine, get_db
import models
import schemas

Base.metadata.create_all(bind=engine)

# ── Lightweight migrations (add columns that may be missing in existing DBs) ─
def _run_migrations():
    with engine.connect() as conn:
        from sqlalchemy import text, inspect
        inspector = inspect(engine)
        existing = {col["name"] for col in inspector.get_columns("pages")}
        additions = {
            "device": "VARCHAR DEFAULT ''",
            "saved_via": "VARCHAR DEFAULT ''",
            "is_music": "BOOLEAN DEFAULT 0",
            "recipe_ingredients": "TEXT DEFAULT ''",
            "recipe_instructions": "TEXT DEFAULT ''",
        }
        for col, definition in additions.items():
            if col not in existing:
                conn.execute(text(f"ALTER TABLE pages ADD COLUMN {col} {definition}"))
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


def _apply_auto_tags(page: models.Page, db: Session) -> None:
    """Merge tags from matching AutoTagRules into the page's tag list."""
    rules = db.query(models.AutoTagRule).all()
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

        if match:
            for t in rule.tags.split(","):
                t = t.strip()
                if t and t.lower() not in existing:
                    new_tags.append(t)
                    existing.add(t.lower())

    page.tags = ", ".join(new_tags)


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


def _normalize_recipe_entries(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []

    if isinstance(value, list):
        items: list[str] = []
        for entry in value:
            items.extend(_normalize_recipe_entries(entry))
        return items

    if isinstance(value, dict):
        if "text" in value:
            return _normalize_recipe_entries(value.get("text"))
        if "name" in value:
            return _normalize_recipe_entries(value.get("name"))
        if "itemListElement" in value:
            return _normalize_recipe_entries(value.get("itemListElement"))

    return []


def extract_recipe_data(soup: BeautifulSoup) -> dict[str, str]:
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

            if ingredients or instructions:
                return {
                    "recipe_ingredients": "\n".join(ingredients),
                    "recipe_instructions": "\n".join(instructions),
                }

    return {"recipe_ingredients": "", "recipe_instructions": ""}


app = FastAPI(title="Project Pocket API", version="1.0.0")


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
    "created_at",
]


def _parse_bool(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


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
        return parsed.path.strip("/")
    if host.endswith("youtube.com"):
        query = dict(part.split("=", 1) for part in parsed.query.split("&") if "=" in part)
        return query.get("v", "")
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
        desc_tag = soup.find("meta", attrs={"name": "description"})
        if desc_tag and desc_tag.get("content"):
            description = desc_tag["content"]
        og_desc = soup.find("meta", property="og:description")
        if og_desc and og_desc.get("content"):
            description = og_desc["content"]

        parsed = urlparse(url)
        favicon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
        recipe_data = extract_recipe_data(soup)

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
def export_pages_csv(db: Session = Depends(get_db)):
    rows = db.query(models.Page).order_by(models.Page.created_at.asc(), models.Page.id.asc()).all()

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
async def import_pages_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    raw_bytes = await file.read()
    try:
        csv_text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded")

    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames or "url" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include a url column")

    existing_keys = {
        (url or "", created_at.isoformat() if created_at else "")
        for url, created_at in db.query(models.Page.url, models.Page.created_at).all()
    }

    imported = 0
    skipped = 0
    for row in reader:
        url = str((row or {}).get("url") or "").strip()
        if not url:
            skipped += 1
            continue

        created_at = _parse_created_at((row or {}).get("created_at") or "")
        dedupe_key = (url, created_at.isoformat() if created_at else "")
        if created_at and dedupe_key in existing_keys:
            skipped += 1
            continue

        page = models.Page(
            url=url,
            title=str((row or {}).get("title") or "").strip() or url,
            description=str((row or {}).get("description") or "").strip(),
            domain=str((row or {}).get("domain") or "").strip() or extract_domain(url),
            tags=str((row or {}).get("tags") or "").strip(),
            is_recipe=_parse_bool((row or {}).get("is_recipe") or ""),
            is_music=_parse_bool((row or {}).get("is_music") or ""),
            recipe_ingredients=str((row or {}).get("recipe_ingredients") or ""),
            recipe_instructions=str((row or {}).get("recipe_instructions") or ""),
            favicon=str((row or {}).get("favicon") or "").strip(),
            notes=str((row or {}).get("notes") or ""),
            device=str((row or {}).get("device") or "").strip(),
            saved_via=str((row or {}).get("saved_via") or "").strip(),
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
def delete_all_pages(confirm: str = Query(...), db: Session = Depends(get_db)):
    if confirm.strip().upper() != "DELETE ALL":
        raise HTTPException(status_code=400, detail="Invalid confirmation text")

    deleted = db.query(models.Page).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}

@app.get("/api/pages", response_model=list[schemas.PageOut])
def list_pages(
    domain: Optional[str] = None,
    tag: Optional[str] = None,
    is_recipe: Optional[bool] = None,
    is_music: Optional[bool] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.Page)
    if domain:
        q = q.filter(models.Page.domain == domain)
    if is_recipe is not None:
        q = q.filter(models.Page.is_recipe == is_recipe)
    if is_music is not None:
        q = q.filter(models.Page.is_music == is_music)
    if tag:
        q = q.filter(models.Page.tags.contains(tag))
    if search:
        term = f"%{search}%"
        q = q.filter(
            models.Page.title.ilike(term)
            | models.Page.url.ilike(term)
            | models.Page.description.ilike(term)
        )
    return q.order_by(models.Page.created_at.desc()).all()


@app.get("/api/music/genius-search")
async def get_genius_search(query_url: str = Query(..., alias="url"), title: str = ""):
    query = await resolve_music_lookup_query(query_url, title)
    return {"query": query, "url": _build_genius_search_url(query)}


@app.post("/api/pages", response_model=schemas.PageOut, status_code=201)
async def create_page(payload: schemas.PageCreate, db: Session = Depends(get_db)):
    meta = await fetch_page_meta(payload.url)

    title = payload.title or meta["title"] or payload.url
    description = payload.description or meta["description"]
    recipe_ingredients = meta["recipe_ingredients"]
    recipe_instructions = meta["recipe_instructions"]
    is_recipe = payload.is_recipe or bool(recipe_ingredients or recipe_instructions)

    page = models.Page(
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
    )
    _apply_category_tags(page)
    _apply_auto_tags(page, db)
    db.add(page)
    db.commit()
    db.refresh(page)
    return page


@app.get("/api/pages/{page_id}", response_model=schemas.PageOut)
def get_page(page_id: int, db: Session = Depends(get_db)):
    page = db.get(models.Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


@app.patch("/api/pages/{page_id}", response_model=schemas.PageOut)
async def update_page(page_id: int, payload: schemas.PageUpdate, db: Session = Depends(get_db)):
    page = db.get(models.Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    for field, value in payload.model_dump(exclude_none=True).items():
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
def delete_page(page_id: int, db: Session = Depends(get_db)):
    page = db.get(models.Page, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    db.delete(page)
    db.commit()


# ── Auto-tag rules ───────────────────────────────────────────────────────────

@app.get("/api/auto-tag-rules", response_model=list[schemas.AutoTagRuleOut])
def list_rules(db: Session = Depends(get_db)):
    return db.query(models.AutoTagRule).all()


@app.post("/api/auto-tag-rules", response_model=schemas.AutoTagRuleOut, status_code=201)
def create_rule(payload: schemas.AutoTagRuleCreate, db: Session = Depends(get_db)):
    allowed_types = (
        "domain",
        "domain_wildcard",
        "url_contains",
        "url_wildcard",
        "title_contains",
        "title_wildcard",
    )
    if payload.match_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="match_type must be one of: domain, domain_wildcard, url_contains, url_wildcard, title_contains, title_wildcard",
        )
    rule = models.AutoTagRule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@app.delete("/api/auto-tag-rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(models.AutoTagRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    db.delete(rule)
    db.commit()


# ── Domains ──────────────────────────────────────────────────────────────────

@app.get("/api/domains")
def list_domains(db: Session = Depends(get_db)):
    rows = db.query(models.Page.domain).distinct().all()
    return [r[0] for r in rows if r[0]]


# ── Tags ─────────────────────────────────────────────────────────────────────

@app.get("/api/tags")
def list_tags(db: Session = Depends(get_db)):
    rows = db.query(models.Page.tags).all()
    tags: set[str] = set()
    for (tag_str,) in rows:
        for t in (tag_str or "").split(","):
            t = t.strip()
            if t:
                tags.add(t)
    return sorted(tags)
