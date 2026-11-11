"""
Shared base class for API request and response bodies.

Python uses snake_case and the TypeScript clients use camelCase. The alias
generator converts between them, so `saved_at` appears as `savedAt` in JSON and
matches `SavedPage` in `packages/shared`.
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """Base class that makes every API field camelCase in JSON."""

    # `populate_by_name` also allows snake_case when Python code builds a model.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
