"""Tests for syncing pages: upsert rules, privacy between users, limits and paging."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlmodel import Session, select

from app.api import items as items_module
from app.api.items import MAX_ITEM_BYTES
from app.models import SavedItem, User, utc_now

Headers = dict[str, str]


def page(**overrides: Any) -> dict[str, Any]:
    """Build a valid upload in the JSON shape the extension sends."""
    body: dict[str, Any] = {
        "url": "https://example.com/soup",
        "title": "Soup",
        "category": "recipes",
        "categoryLabel": "Recipes",
        "tags": ["quick"],
        "note": "Try this",
        "snapshot": {
            "jsonLd": [{"@type": "Recipe"}],
            "text": "Boil water.",
            "capturedAt": "2026-11-01T10:00:00.000Z",
            "truncated": False,
        },
        "savedAt": "2026-11-01T10:00:00.000Z",
        "updatedAt": "2026-11-01T10:00:00.000Z",
    }
    body.update(overrides)
    return body


@pytest.fixture
def anna(register_and_login: Callable[[str], Headers]) -> Headers:
    """Return the auth header of a first test user."""
    return register_and_login("anna")


@pytest.fixture
def ben(register_and_login: Callable[[str], Headers]) -> Headers:
    """Return the auth header of a second test user."""
    return register_and_login("ben")


def test_endpoints_require_login(client: TestClient) -> None:
    """Neither reading nor writing works without a token."""
    assert client.get("/api/items").status_code == 401
    assert client.post("/api/items", json=page()).status_code == 401


def test_upload_creates_an_item_in_camel_case(client: TestClient, anna: Headers) -> None:
    """A new page returns 201 and JSON field names matching the TypeScript types."""
    response = client.post("/api/items", json=page(siteName="Example"), headers=anna)

    body = response.json()
    assert response.status_code == 201
    assert body["siteName"] == "Example"
    assert body["categoryLabel"] == "Recipes"
    assert body["updatedAt"] == "2026-11-01T10:00:00Z"
    assert "snapshot" not in body


def test_snapshot_is_stored_unchanged(client: TestClient, anna: Headers, engine: Engine) -> None:
    """M3 needs the snapshot in exactly the extension's format."""
    client.post("/api/items", json=page(), headers=anna)

    with Session(engine) as session:
        item = session.exec(select(SavedItem)).one()

    assert item.snapshot == page()["snapshot"]


def test_repeated_upload_does_not_duplicate(client: TestClient, anna: Headers) -> None:
    """A retry after a lost response returns the same item with status 200."""
    first = client.post("/api/items", json=page(), headers=anna)
    second = client.post("/api/items", json=page(), headers=anna)

    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert client.get("/api/items", headers=anna).json()["total"] == 1


def test_newer_upload_overwrites(client: TestClient, anna: Headers) -> None:
    """The most recent edit wins, and optional fields can be cleared again."""
    client.post("/api/items", json=page(description="Old"), headers=anna)

    response = client.post(
        "/api/items",
        json=page(title="Better soup", updatedAt="2026-11-02T10:00:00Z"),
        headers=anna,
    )

    assert response.json()["title"] == "Better soup"
    assert response.json()["description"] is None


def test_older_upload_is_ignored(client: TestClient, anna: Headers) -> None:
    """A browser with an outdated copy cannot overwrite newer data."""
    client.post(
        "/api/items",
        json=page(title="Newest", updatedAt="2026-11-05T10:00:00Z"),
        headers=anna,
    )

    response = client.post(
        "/api/items",
        json=page(title="Stale", updatedAt="2026-11-03T10:00:00Z"),
        headers=anna,
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Newest"


def test_timestamps_compare_across_time_zones(client: TestClient, anna: Headers) -> None:
    """11:00+02:00 is earlier than 10:00Z, despite the larger clock value."""
    client.post("/api/items", json=page(title="First"), headers=anna)

    response = client.post(
        "/api/items",
        json=page(title="Earlier", updatedAt="2026-11-01T11:00:00+02:00"),
        headers=anna,
    )

    assert response.json()["title"] == "First"


def test_update_keeps_the_earliest_saved_date(client: TestClient, anna: Headers) -> None:
    """A second browser's later first save does not change when it was first saved."""
    client.post("/api/items", json=page(), headers=anna)

    response = client.post(
        "/api/items",
        json=page(savedAt="2026-11-04T10:00:00Z", updatedAt="2026-11-04T10:00:00Z"),
        headers=anna,
    )

    assert response.json()["savedAt"] == "2026-11-01T10:00:00Z"


def test_users_cannot_see_each_others_items(
    client: TestClient, anna: Headers, ben: Headers
) -> None:
    """Each user's list contains only their own pages."""
    client.post("/api/items", json=page(title="Anna's"), headers=anna)

    assert client.get("/api/items", headers=ben).json() == {"items": [], "total": 0}
    assert client.get("/api/items", headers=anna).json()["total"] == 1


def test_same_url_is_separate_per_user(client: TestClient, anna: Headers, ben: Headers) -> None:
    """Ben's upload creates his own item and cannot change Anna's."""
    first = client.post("/api/items", json=page(title="Anna's"), headers=anna)

    second = client.post(
        "/api/items",
        json=page(title="Ben's", updatedAt="2026-11-02T10:00:00Z"),
        headers=ben,
    )

    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]
    assert client.get("/api/items", headers=anna).json()["items"][0]["title"] == "Anna's"


def test_simultaneous_first_upload_becomes_an_update(
    client: TestClient,
    anna: Headers,
    engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If another request inserts the URL first, the unique constraint decides."""
    real_find = items_module._find_item
    calls = {"count": 0}

    def find_as_if_other_request_is_faster(session: Session, user_id: str, url: str):
        """Report "not found", then insert the row like a competing request."""
        calls["count"] += 1
        if calls["count"] > 1:
            return real_find(session, user_id, url)
        with Session(engine) as other:
            user = other.exec(select(User)).one()
            other.add(
                SavedItem(
                    user_id=user.id,
                    url=url,
                    title="From the other browser",
                    category="recipes",
                    category_label="Recipes",
                    snapshot={},
                    saved_at=utc_now(),
                    updated_at=utc_now(),
                )
            )
            other.commit()
        return None

    monkeypatch.setattr(items_module, "_find_item", find_as_if_other_request_is_faster)

    response = client.post("/api/items", json=page(), headers=anna)

    assert response.status_code == 200
    with Session(engine) as session:
        assert len(session.exec(select(SavedItem)).all()) == 1


def test_oversized_upload_is_rejected(client: TestClient, anna: Headers) -> None:
    """A page above the limit is refused and nothing is stored."""
    snapshot = {**page()["snapshot"], "text": "x" * MAX_ITEM_BYTES}

    response = client.post("/api/items", json=page(snapshot=snapshot), headers=anna)

    assert response.status_code == 413
    assert client.get("/api/items", headers=anna).json()["total"] == 0


def test_size_limit_counts_bytes_not_characters(client: TestClient, anna: Headers) -> None:
    """Multi-byte text takes more space than its character count suggests."""
    snapshot = {**page()["snapshot"], "text": "ä" * (MAX_ITEM_BYTES // 2 + 1)}

    assert client.post("/api/items", json=page(snapshot=snapshot), headers=anna).status_code == 413


def test_custom_category_is_accepted(client: TestClient, anna: Headers) -> None:
    """Custom categories arrive with the label the web app will display."""
    body = page(category="custom:1234-abcd", categoryLabel="Weekend")

    response = client.post("/api/items", json=body, headers=anna)

    assert response.status_code == 201
    assert response.json()["categoryLabel"] == "Weekend"


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"category": "unknown"}, id="unknown-category"),
        pytest.param({"category": "custom:has space"}, id="bad-custom-category"),
        pytest.param({"title": ""}, id="empty-title"),
        pytest.param({"tags": ["x" * 41]}, id="tag-too-long"),
        pytest.param({"tags": [str(n) for n in range(21)]}, id="too-many-tags"),
        pytest.param({"note": "x" * 5001}, id="note-too-long"),
        pytest.param({"updatedAt": "2026-11-01T10:00:00"}, id="no-time-zone"),
        pytest.param({"snapshot": {"text": "missing fields"}}, id="bad-snapshot"),
    ],
)
def test_invalid_uploads_are_rejected(
    client: TestClient, anna: Headers, overrides: dict[str, Any]
) -> None:
    """Uploads breaking the shared data rules answer 422."""
    assert client.post("/api/items", json=page(**overrides), headers=anna).status_code == 422


def test_list_is_paged_and_newest_first(client: TestClient, anna: Headers) -> None:
    """Paging walks through all items in a stable order."""
    for day in range(1, 4):
        timestamp = f"2026-11-0{day}T10:00:00Z"
        client.post(
            "/api/items",
            json=page(url=f"https://example.com/{day}", savedAt=timestamp, updatedAt=timestamp),
            headers=anna,
        )

    first = client.get("/api/items", params={"limit": 2}, headers=anna).json()
    second = client.get("/api/items", params={"limit": 2, "offset": 2}, headers=anna).json()

    assert first["total"] == 3
    assert [item["url"][-1] for item in first["items"]] == ["3", "2"]
    assert [item["url"][-1] for item in second["items"]] == ["1"]


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 201}, {"offset": -1}])
def test_list_rejects_bad_paging(client: TestClient, anna: Headers, params: dict[str, int]) -> None:
    """Limits protect the server from accidentally huge responses."""
    assert client.get("/api/items", params=params, headers=anna).status_code == 422
