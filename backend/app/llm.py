"""Text generation for the coaching agents.

Providers:
  * "anthropic" - Claude via the official Anthropic SDK (needs ANTHROPIC_API_KEY).
  * "ollama"    - any local model served by Ollama: free and fully offline.
  * "none"      - no LLM; agents fall back to template-written coaching.
"""

from __future__ import annotations

import logging

import httpx

from .config import get_settings

log = logging.getLogger(__name__)

COACH_PERSONA = (
    "You are a warm, sharp chess coach reviewing a student's own games. "
    "You are given engine analysis (Stockfish) and statistics from the student's game history. "
    "Trust the engine's evaluations and best moves; never invent moves or lines that are not in the data. "
    "Explain ideas in plain language (plans, threats, piece activity, king safety) rather than reciting "
    "numbers, refer to moves in SAN, and keep the student motivated. Use short paragraphs and bullet points."
)


class LLMUnavailable(RuntimeError):
    pass


def provider() -> str:
    return get_settings().llm_provider.lower()


def generate(prompt: str, system: str = COACH_PERSONA, max_tokens: int = 4000) -> str:
    """Return the model's text, or raise LLMUnavailable so callers can use a template instead."""
    name = provider()
    try:
        if name == "anthropic":
            return _anthropic(prompt, system, max_tokens)
        if name == "ollama":
            return _ollama(prompt, system)
    except LLMUnavailable:
        raise
    except Exception as exc:  # network errors, bad keys, model not pulled...
        log.warning("LLM provider %s failed: %s", name, exc)
        raise LLMUnavailable(str(exc)) from exc
    raise LLMUnavailable("No LLM provider configured")


_anthropic_client = None


def _anthropic(prompt: str, system: str, max_tokens: int) -> str:
    import anthropic

    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    settings = get_settings()
    response = _anthropic_client.beta.messages.create(
        model=settings.anthropic_model,
        max_tokens=max_tokens,
        system=system,
        output_config={"effort": settings.anthropic_effort},
        # On a safety decline, let the API re-run the request on its recommended fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason == "refusal":
        raise LLMUnavailable("The model declined this request")
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise LLMUnavailable("Empty response")
    return text


def _ollama(prompt: str, system: str) -> str:
    settings = get_settings()
    resp = httpx.post(
        f"{settings.ollama_url.rstrip('/')}/api/chat",
        json={
            "model": settings.ollama_model,
            "stream": False,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        },
        timeout=180,
    )
    resp.raise_for_status()
    text = resp.json().get("message", {}).get("content", "").strip()
    if not text:
        raise LLMUnavailable("Empty response")
    return text
