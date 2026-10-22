"""
Extraction package (placeholder).

The backend will support one *plugin* per project type (recipes, DIY projects,
lyrics, …). Each plugin follows the same contract:

1. Try cheap, deterministic extraction first (schema.org JSON-LD, meta tags,
   `recipe-scrapers`, HTML parsing).
2. Only if that fails, ask an LLM provider (see `app.llm`) for structured data.
3. Validate the result against a Pydantic model before saving it.

The plugin interface and the recipe plugin will be added in the extraction
milestone; this module stays empty on purpose so the scaffold contains no dead
code. See docs/PROGRESS.md.
"""
