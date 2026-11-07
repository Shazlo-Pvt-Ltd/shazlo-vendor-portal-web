import hashlib
import secrets


def hash_token(token: str) -> str:
    """The SHA-256 of a token, as 64 hex characters: all the database ever holds of it."""
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> tuple[str, str]:
    """A 256-bit URL-safe random token and its hash. Only the token goes to the user."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)
