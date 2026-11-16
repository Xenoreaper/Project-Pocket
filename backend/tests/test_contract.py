"""
Contract test, backend side.

The committed snapshot `packages/shared/src/api-contract.json` must describe the
running backend. The TypeScript package tests the same file against its types
(`api-contract.test.ts`), so the two sides cannot drift apart unnoticed.
"""

import json

from fastapi import FastAPI

from app.contract import CONTRACT_FILE, build_contract, render_contract


def test_committed_contract_matches_the_backend(app: FastAPI) -> None:
    """An API change must be followed by `make contract-update` and a client update."""
    committed = CONTRACT_FILE.read_text(encoding="utf-8")

    assert committed == render_contract(app), (
        "The API changed. Run `make contract-update`, then update the TypeScript "
        "types in packages/shared/src/api.ts until `make test` passes."
    )


def test_contract_lists_endpoints_and_fields(app: FastAPI) -> None:
    """The snapshot contains what the clients rely on, in JSON field names."""
    contract = build_contract(app)

    assert contract["paths"]["/api/items"] == ["get", "post"]
    assert "savedAt" in contract["schemas"]["ItemResponse"]["properties"]
    assert "url" in contract["schemas"]["ItemPayload"]["required"]


def test_contract_leaves_out_framework_schemas(app: FastAPI) -> None:
    """FastAPI's own validation-error schemas are not part of our contract."""
    assert "HTTPValidationError" not in build_contract(app)["schemas"]


def test_contract_file_is_valid_json() -> None:
    """The TypeScript test imports the file as JSON."""
    assert set(json.loads(CONTRACT_FILE.read_text(encoding="utf-8"))) == {"paths", "schemas"}
