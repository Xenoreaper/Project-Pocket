"""
A compact snapshot of the REST API contract.

The backend owns the API. FastAPI describes it as an OpenAPI document, but that
document is large. This module reduces it to what the TypeScript clients depend
on: which endpoints exist and which fields every request and response has.

The snapshot is committed as `packages/shared/src/api-contract.json` and checked
from both sides:
- `backend/tests/test_contract.py` fails if the backend no longer matches it;
- `packages/shared/src/api-contract.test.ts` fails if the TypeScript types do not.
So an API change cannot be merged without both sides being updated.

Regenerate the file after an intended API change with `make contract-update`.
"""

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI

# backend/app/contract.py -> repository root -> the shared TypeScript package.
CONTRACT_FILE = (
    Path(__file__).resolve().parents[2] / "packages" / "shared" / "src" / "api-contract.json"
)

# FastAPI adds these two schemas for its own 422 error format; they are not ours.
_FRAMEWORK_SCHEMAS = {"HTTPValidationError", "ValidationError"}


def build_contract(app: FastAPI) -> dict[str, Any]:
    """
    Reduce an app's OpenAPI document to endpoints and field names.

    Args:
        app: the FastAPI application to describe.

    Returns:
        `{"paths": {path: [methods]}, "schemas": {name: {"properties", "required"}}}`,
        with every list sorted so the result is stable between runs.
    """
    openapi = app.openapi()

    paths = {path: sorted(methods) for path, methods in sorted(openapi["paths"].items())}
    schemas = {
        name: {
            "properties": sorted(schema.get("properties", {})),
            "required": sorted(schema.get("required", [])),
        }
        for name, schema in sorted(openapi["components"]["schemas"].items())
        if name not in _FRAMEWORK_SCHEMAS
    }
    return {"paths": paths, "schemas": schemas}


def render_contract(app: FastAPI) -> str:
    """Return the snapshot as the exact text stored in the contract file."""
    return json.dumps(build_contract(app), indent=2) + "\n"


if __name__ == "__main__":
    # `python -m app.contract` rewrites the committed snapshot. The import is
    # here so that importing this module elsewhere does not create an app.
    from app.main import create_app

    CONTRACT_FILE.write_text(render_contract(create_app()), encoding="utf-8")
    print(f"Wrote {CONTRACT_FILE}")
