"""
Synced page endpoints under /api/items.

The extension uploads one page per request. That keeps retries simple: if a sync
stops halfway, the pages already uploaded stay done. Every query filters by the
logged-in user, which is what keeps pockets private.
"""

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import AwareDatetime, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.schemas import ApiModel
from app.auth import CurrentUser, SessionDep
from app.models import SavedItem, as_utc, to_stored_utc, utc_now

router = APIRouter(prefix="/items", tags=["items"])

# The extension limits one page to 200,000 bytes. The margin leaves room for the
# fields only the API has, such as the category label.
MAX_ITEM_BYTES = 256_000

# The same rule as `isCategoryId` in packages/shared.
_CATEGORY_PATTERN = r"^(recipes|diy|lyrics|other|custom:[A-Za-z0-9_-]+)$"
_MAX_URL_CHARS = 8_192


class SnapshotPayload(ApiModel):
    """Mirrors `PageSnapshot` in packages/shared."""

    # Arbitrary third-party JSON, which M3 validates during extraction.
    json_ld: list[Any]
    text: str
    captured_at: str
    truncated: bool


class ItemPayload(ApiModel):
    """Body of POST /api/items. The limits match `lib/storage.ts` in the extension."""

    url: str = Field(min_length=1, max_length=_MAX_URL_CHARS)
    title: str = Field(min_length=1, max_length=500)
    favicon: str | None = Field(default=None, max_length=_MAX_URL_CHARS)
    description: str | None = Field(default=None, max_length=500)
    site_name: str | None = Field(default=None, max_length=200)
    canonical_url: str | None = Field(default=None, max_length=_MAX_URL_CHARS)
    lang: str | None = Field(default=None, max_length=35)
    category: str = Field(pattern=_CATEGORY_PATTERN)
    # 100 rather than 40: if a definition is missing, the label falls back to the
    # longer `custom:<uuid>` ID.
    category_label: str = Field(min_length=1, max_length=100)
    tags: list[Annotated[str, Field(max_length=40)]] = Field(default_factory=list, max_length=20)
    note: str = Field(default="", max_length=5_000)
    snapshot: SnapshotPayload
    # `AwareDatetime` rejects timestamps without a time zone, which would be
    # ambiguous when comparing versions.
    saved_at: AwareDatetime
    updated_at: AwareDatetime


class ItemResponse(ApiModel):
    """An item as clients see it. The large snapshot is left out."""

    id: str
    url: str
    title: str
    favicon: str | None
    description: str | None
    site_name: str | None
    canonical_url: str | None
    lang: str | None
    category: str
    category_label: str
    tags: list[str]
    note: str
    saved_at: AwareDatetime
    updated_at: AwareDatetime
    synced_at: AwareDatetime


class ItemListResponse(ApiModel):
    """One page of items, plus the total for paging controls."""

    items: list[ItemResponse]
    total: int


def _to_response(item: SavedItem) -> ItemResponse:
    """Convert a database row to its API shape, restoring UTC on timestamps."""
    return ItemResponse(
        id=item.id,
        url=item.url,
        title=item.title,
        favicon=item.favicon,
        description=item.description,
        site_name=item.site_name,
        canonical_url=item.canonical_url,
        lang=item.lang,
        category=item.category,
        category_label=item.category_label,
        tags=item.tags,
        note=item.note,
        saved_at=as_utc(item.saved_at),
        updated_at=as_utc(item.updated_at),
        synced_at=as_utc(item.synced_at),
    )


def _find_item(session: Session, user_id: str, url: str) -> SavedItem | None:
    """Find a user's item by URL. Items of other users are never returned."""
    return session.exec(
        select(SavedItem).where(SavedItem.user_id == user_id, SavedItem.url == url)
    ).first()


def _copy_payload(item: SavedItem, payload: ItemPayload) -> None:
    """Copy the fields the client owns onto a database row."""
    item.title = payload.title
    item.favicon = payload.favicon
    item.description = payload.description
    item.site_name = payload.site_name
    item.canonical_url = payload.canonical_url
    item.lang = payload.lang
    item.category = payload.category
    item.category_label = payload.category_label
    item.tags = payload.tags
    item.note = payload.note
    # `by_alias` keeps the stored JSON in the same camelCase as `PageSnapshot`.
    item.snapshot = payload.snapshot.model_dump(by_alias=True)
    item.updated_at = to_stored_utc(payload.updated_at)
    item.synced_at = utc_now()


def _update_if_newer(session: Session, item: SavedItem, payload: ItemPayload) -> None:
    """
    Apply an upload unless the server already has the same or a newer version.

    With two browsers, the most recent edit wins. An equal timestamp is a repeated
    upload after a lost response, which changes nothing.
    """
    if to_stored_utc(payload.updated_at) <= item.updated_at:
        return
    _copy_payload(item, payload)
    # Another browser may have saved this page earlier, so keep the first date.
    item.saved_at = min(item.saved_at, to_stored_utc(payload.saved_at))
    session.add(item)
    session.commit()
    session.refresh(item)


@router.post("", response_model=ItemResponse, summary="Upload one page")
def upsert_item(
    payload: ItemPayload,
    response: Response,
    user: CurrentUser,
    session: SessionDep,
) -> ItemResponse:
    """
    Create the user's item for this URL, or update the existing one.

    Uploading the same page again is safe, so clients can retry after any failure.

    Returns:
        The stored item, with status 201 if it is new and 200 otherwise.

    Raises:
        HTTPException: 413 if the page is larger than `MAX_ITEM_BYTES`.
    """
    if len(payload.model_dump_json(by_alias=True).encode()) > MAX_ITEM_BYTES:
        # A literal, because the name of this status constant differs between
        # Starlette versions.
        raise HTTPException(413, "This page is too large to sync.")

    item = _find_item(session, user.id, payload.url)
    if item is not None:
        _update_if_newer(session, item, payload)
        return _to_response(item)

    item = SavedItem(
        user_id=user.id,
        url=payload.url,
        title=payload.title,
        category=payload.category,
        category_label=payload.category_label,
        snapshot={},
        saved_at=to_stored_utc(payload.saved_at),
        updated_at=to_stored_utc(payload.updated_at),
    )
    _copy_payload(item, payload)
    session.add(item)
    try:
        session.commit()
    except IntegrityError:
        # Two browsers uploaded the same new page at once and the other one won
        # the insert, so treat this upload as an update of that row.
        session.rollback()
        existing = _find_item(session, user.id, payload.url)
        if existing is None:
            raise
        _update_if_newer(session, existing, payload)
        return _to_response(existing)

    session.refresh(item)
    response.status_code = status.HTTP_201_CREATED
    return _to_response(item)


@router.get("", response_model=ItemListResponse, summary="List the user's pages")
def list_items(
    user: CurrentUser,
    session: SessionDep,
    # `Query` declares the limits; FastAPI answers 422 outside of them.
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ItemListResponse:
    """
    Return one page of the user's items, newest first.

    The ID is a second sort key, so items saved at the same moment keep a stable
    order and cannot appear twice across pages.
    """
    items = session.exec(
        select(SavedItem)
        .where(SavedItem.user_id == user.id)
        .order_by(SavedItem.saved_at.desc(), SavedItem.id)
        .offset(offset)
        .limit(limit)
    ).all()
    total = session.exec(
        select(func.count()).select_from(SavedItem).where(SavedItem.user_id == user.id)
    ).one()
    return ItemListResponse(items=[_to_response(item) for item in items], total=total)
