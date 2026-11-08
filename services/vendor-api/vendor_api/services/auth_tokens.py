"""One-time tokens in `auth_tokens`: invites and password resets (verification tokens are in
`signup.py`). Only the SHA-256 of a token is stored; a token works once, until it expires."""

import uuid
from collections.abc import Collection
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.models import AuthToken, TokenPurpose
from vendor_api.services.one_time_tokens import hash_token, new_token


def issue_token(
    db: AsyncSession,
    user_id: uuid.UUID,
    purpose: TokenPurpose,
    now: datetime,
    ttl: timedelta,
) -> str:
    """Adds a token for the user to the session (the caller commits) and returns it."""
    token, token_hash = new_token()
    db.add(
        AuthToken(
            vendor_user_id=user_id, purpose=purpose, token_hash=token_hash, expires_at=now + ttl
        )
    )
    return token


async def end_unused(
    db: AsyncSession, user_id: uuid.UUID, purposes: Collection[TokenPurpose], now: datetime
) -> None:
    """Spends every unused token of the user for these purposes: a newer token invalidates the
    older ones. The rows are kept as spent, not deleted."""
    await db.execute(
        update(AuthToken)
        .where(
            AuthToken.vendor_user_id == user_id,
            AuthToken.purpose.in_([str(purpose) for purpose in purposes]),
            AuthToken.used_at.is_(None),
        )
        .values(used_at=now)
    )


async def find_usable(
    db: AsyncSession, token: str, purposes: Collection[TokenPurpose], now: datetime
) -> AuthToken | None:
    """The token's row if it exists, has one of the purposes, is unused and has not expired."""
    return await db.scalar(
        select(AuthToken)
        .where(
            AuthToken.token_hash == hash_token(token),
            AuthToken.purpose.in_([str(purpose) for purpose in purposes]),
            AuthToken.used_at.is_(None),
            AuthToken.expires_at > now,
        )
        .execution_options(populate_existing=True)
    )


async def spend(db: AsyncSession, token_id: uuid.UUID, now: datetime) -> bool:
    """Marks the token used, and says whether this call was the one that did. The single UPDATE
    is what stops two requests with the same token from both succeeding."""
    spent = await db.scalar(
        update(AuthToken)
        .where(AuthToken.id == token_id, AuthToken.used_at.is_(None))
        .values(used_at=now)
        .returning(AuthToken.id)
    )
    return spent is not None
