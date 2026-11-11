"""Configuration of the stub central app, read from the environment."""

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from shazlo_security.signing import SigningKey

# docs/adr/0003-contract, found from the repository checkout. The Docker image sets CONTRACT_DIR.
DEFAULT_CONTRACT_DIR = Path(__file__).resolve().parents[3] / "docs" / "adr" / "0003-contract"
MAX_BODY_BYTES = 256 * 1024  # the contract's limit: a bigger body is 413


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # `key-id:secret` pairs separated by commas; two may be active during a rotation. The default
    # is a development secret only: this service is never deployed.
    stub_signing_keys: str = "k1:central-stub-dev-secret-change-me-0123456789"
    contract_dir: Path = DEFAULT_CONTRACT_DIR
    # What the stub does with /internal/v1/*: ok, error_500, rate_limited, unauthorized, timeout.
    stub_mode: str = "ok"
    # Seconds a `timeout` answer waits before it gives up (longer than any client timeout).
    stub_timeout_seconds: float = Field(default=120.0, ge=0)
    # `Retry-After` of a `rate_limited` answer.
    stub_retry_after_seconds: int = Field(default=30, ge=0)

    @field_validator("stub_mode")
    @classmethod
    def _check_mode(cls, value: str) -> str:
        if value not in MODES:
            raise ValueError(f"STUB_MODE must be one of {', '.join(sorted(MODES))}")
        return value

    def keys(self) -> list[SigningKey]:
        keys: list[SigningKey] = []
        for pair in self.stub_signing_keys.split(","):
            key_id, separator, secret = pair.strip().partition(":")
            if not separator:
                raise ValueError("STUB_SIGNING_KEYS is `key-id:secret`, comma separated")
            keys.append(SigningKey(key_id, secret.encode()))
        return keys


MODES = frozenset({"ok", "error_500", "rate_limited", "unauthorized", "timeout"})
