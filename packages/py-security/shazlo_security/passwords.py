import asyncio
import secrets
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


class PasswordPolicyError(ValueError):
    """The password breaks the policy. The message never contains the password."""


# Argon2 accepts long inputs, but hashing megabytes per request is a cheap way to burn CPU.
MAX_PASSWORD_LENGTH = 128


def check_password(password: str, *, email: str, min_length: int) -> None:
    """Raises PasswordPolicyError if the password is not acceptable.

    Shared by account creation, change-password and the seed commands.
    """
    if len(password) < min_length:
        raise PasswordPolicyError(f"Password must be at least {min_length} characters long")
    if len(password) > MAX_PASSWORD_LENGTH:
        raise PasswordPolicyError(f"Password must be at most {MAX_PASSWORD_LENGTH} characters long")
    if password.strip().lower() == email.strip().lower():
        raise PasswordPolicyError("Password must not be the same as the email address")


@dataclass(frozen=True)
class PasswordConfig:
    """Argon2id cost (OWASP baseline: 19 MiB, 2 passes, 1 lane). Raising any of these makes
    existing hashes rehash on the next successful login."""

    time_cost: int = 2
    memory_cost_kib: int = 19_456
    parallelism: int = 1


@dataclass(frozen=True)
class PasswordCheck:
    ok: bool
    # Set when the password was right but the stored hash uses outdated parameters. The caller
    # saves it in the same transaction as the login.
    new_hash: str | None = None


class PasswordService:
    """Argon2id hashing. The CPU-heavy calls run in a thread so they do not block the loop."""

    def __init__(self, config: PasswordConfig) -> None:
        self._hasher = PasswordHasher(
            time_cost=config.time_cost,
            memory_cost=config.memory_cost_kib,
            parallelism=config.parallelism,
        )
        # Verified against when the account is unknown, so that path costs the same as a real one.
        self._dummy_hash = self._hasher.hash(secrets.token_urlsafe(32))

    async def hash(self, password: str) -> str:
        return await asyncio.to_thread(self._hasher.hash, password)

    async def verify_login(self, stored_hash: str | None, password: str) -> PasswordCheck:
        """Checks a login attempt; `stored_hash` is None when no account has that email.

        An unknown email still pays for a full verification, and the result is the same
        `ok=False` as for a wrong password.
        """
        target = stored_hash or self._dummy_hash
        matches = await asyncio.to_thread(self._verify, target, password)
        if stored_hash is None or not matches:
            return PasswordCheck(ok=False)
        new_hash = None
        if self._hasher.check_needs_rehash(stored_hash):
            new_hash = await self.hash(password)
        return PasswordCheck(ok=True, new_hash=new_hash)

    def _verify(self, password_hash: str, password: str) -> bool:
        try:
            return self._hasher.verify(password_hash, password)
        except (VerificationError, InvalidHashError):
            # Wrong password or a hash we cannot parse: both are a failed login.
            return False
