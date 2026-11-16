"""
Tests for small infrastructure pieces: the SQLite folder helper and the LLM
provider interface.

Both were untested according to the coverage report (`make backend-coverage`).
"""

from pathlib import Path

import pytest

from app.db import _ensure_sqlite_parent_directory
from app.llm.base import LLMProvider


def test_sqlite_parent_directory_is_created(tmp_path: Path) -> None:
    """SQLite creates the file but not missing folders, so the helper does it."""
    database = tmp_path / "nested" / "deeper" / "pocket.db"

    _ensure_sqlite_parent_directory(f"sqlite:///{database}")

    assert database.parent.is_dir()


@pytest.mark.parametrize(
    "url",
    [
        pytest.param("sqlite:///:memory:", id="in-memory"),
        pytest.param("sqlite:///", id="empty-path"),
        pytest.param("postgresql://user@db/pocket", id="not-sqlite"),
    ],
)
def test_urls_without_a_local_file_create_nothing(
    url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Only SQLite files need a folder; other URLs are left alone."""
    # Run in an empty folder, so any folder created by mistake would show up.
    monkeypatch.chdir(tmp_path)

    _ensure_sqlite_parent_directory(url)

    assert list(tmp_path.iterdir()) == []


class FakeProvider:
    """The smallest class that fulfils the provider contract."""

    name = "fake"

    def complete(self, prompt: str) -> str:
        """Echo the prompt, like a model that repeats its input."""
        return f"echo: {prompt}"


class NotAProvider:
    """Has a name but no `complete` method."""

    name = "broken"


def test_any_class_with_name_and_complete_is_a_provider() -> None:
    """Structural typing: no inheritance needed, which keeps vendor SDKs swappable."""
    provider = FakeProvider()

    assert isinstance(provider, LLMProvider)
    assert provider.complete("hi") == "echo: hi"


def test_class_without_complete_is_not_a_provider() -> None:
    """`runtime_checkable` lets code reject an incomplete provider early."""
    assert not isinstance(NotAProvider(), LLMProvider)
