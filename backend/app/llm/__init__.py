"""
LLM integration package (placeholder).

LLM calls are a *fallback* for extraction, never a requirement: the extension
and the cheap script-based extractors must keep working without any API key.

Providers (Gemini / Anthropic / OpenAI / Ollama) will implement the
`LLMProvider` protocol from `app.llm.base`, so they can be swapped via
configuration. No provider is implemented in the scaffold.
"""
