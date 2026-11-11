"""
Shared pytest fixtures.

pytest finds this file by its name and offers its fixtures to every test. Each
test gets its own temporary SQLite database, so tests cannot affect each other or
touch a real database.
"""

from collections.abc import Callable, Generator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlmodel import Session, SQLModel, create_engine

from app.config import Settings, get_settings
from app.db import enable_sqlite_foreign_keys, get_session
from app.main import create_app


@pytest.fixture
def engine(tmp_path: Path) -> Generator[Engine, None, None]:
    """Create an empty database in a folder that pytest deletes afterwards."""
    test_engine = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}",
        connect_args={"check_same_thread": False},
    )
    enable_sqlite_foreign_keys(test_engine)
    SQLModel.metadata.create_all(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def app(engine: Engine) -> FastAPI:
    """
    Create the real app, connected to the test database.

    `dependency_overrides` swaps what `Depends(...)` provides for this app only.
    """

    def override_session() -> Generator[Session, None, None]:
        with Session(engine) as session:
            yield session

    application = create_app()
    application.dependency_overrides[get_session] = override_session
    return application


@pytest.fixture
def use_settings(app: FastAPI) -> Callable[..., None]:
    """Return a helper that gives the app specific settings during one test."""

    def apply(**values: Any) -> None:
        settings = Settings(**values)
        app.dependency_overrides[get_settings] = lambda: settings

    return apply


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    """Return an HTTP client that calls the app in-process, without a network."""
    return TestClient(app)


@pytest.fixture
def register_and_login(client: TestClient) -> Callable[[str], dict[str, str]]:
    """Return a helper that creates a user and returns their auth header."""

    def create(username: str) -> dict[str, str]:
        credentials = {"username": username, "password": "correct-horse-battery"}
        assert client.post("/api/auth/register", json=credentials).status_code == 201
        response = client.post("/api/auth/login", json=credentials)
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json()['token']}"}

    return create
