"""Runtime configuration, read from environment variables (or a .env file)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Engine. A path to a native Stockfish binary, or a full command line such as
    # "node /opt/stockfish/stockfish.js" for the WASM build.
    stockfish_path: str = "stockfish"
    engine_depth: int = 18
    # The 30-day background analysis only feeds the progress charts, so it uses a quicker depth
    # (about 5x faster than 18). Opening one of those games re-reviews it at engine_depth.
    backfill_depth: int = 14
    engine_threads: int = 2
    engine_hash_mb: int = 128

    # Graph database. Leave neo4j_uri empty to use the in-memory graph store.
    neo4j_uri: str = ""
    neo4j_user: str = "neo4j"
    neo4j_password: str = "chesscoach"

    # LLM used by the coaching agents: "anthropic", "ollama" or "none".
    llm_provider: str = "none"
    anthropic_model: str = "claude-opus-5-5"
    anthropic_effort: str = "medium"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1"

    # chess.com asks API clients to identify themselves.
    chesscom_user_agent: str = "outpost/0.1 (self-hosted chess training)"

    cors_origins: str = "*"


@lru_cache
def get_settings() -> Settings:
    return Settings()
