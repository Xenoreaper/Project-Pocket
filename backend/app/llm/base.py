"""
Provider interface for LLM fallbacks.

The protocol below is structural typing: any class with a matching `name`
attribute and `complete()` method satisfies it. That keeps the backend free of
a hard dependency on one vendor SDK and makes tests trivial (a fake provider is
just a small class).

No real provider is implemented yet; see docs/PROGRESS.md.
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class LLMProvider(Protocol):
    """
    Minimal contract every LLM provider must fulfil.

    Keep this interface as small as possible: extraction only needs "give me
    text for a prompt". Streaming, tools and embeddings can be added later
    together with the features that actually need them.
    """

    #: Short provider identifier for logs, e.g. "gemini" or "ollama".
    name: str

    def complete(self, prompt: str) -> str:
        """
        Send a prompt to the model and return its plain-text answer.

        Implementations must raise an exception on failure instead of
        returning a string such as "error", so callers can fall back cleanly.

        Args:
            prompt: fully rendered instruction + input for the model.

        Returns:
            The model's response text.
        """
        ...
