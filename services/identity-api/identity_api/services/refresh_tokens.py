import hashlib
import logging
import math
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from redis.asyncio import Redis

from identity_api.core.settings import Settings

logger = logging.getLogger(__name__)

Clock = Callable[[], datetime]


class InvalidRefreshTokenError(Exception):
    """The refresh token is unknown, expired, revoked or was already used."""


class RefreshConflictError(Exception):
    """The token was used moments ago by a concurrent request (e.g. a second tab).

    Nothing is revoked: the request that won already set the new cookie, so a retry works.
    """


class StaleSessionError(Exception):
    """The admin's sessions were revoked after this login started, so it may not start one."""


@dataclass(frozen=True)
class RefreshSession:
    token: str
    family_id: str
    expires_at: datetime


@dataclass(frozen=True)
class Rotation:
    admin_id: uuid.UUID
    session: RefreshSession


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# Creates a family and its first token, unless the admin's sessions were revoked since the
# caller read the generation. Redis runs a script atomically, so a `revoke_all` either sees the
# new family in `ra:` or has already bumped the generation that this script checks.
# KEYS: rf:<family>, ra:<admin>, rg:<admin>, rt:<new hash>
# ARGV: admin_id, family expires_at, family ttl, expected generation, family_id, token ttl
_START_FAMILY = """
local generation = redis.call('GET', KEYS[3]) or '0'
if generation ~= ARGV[4] then
  return 'stale'
end
redis.call('HSET', KEYS[1], 'admin_id', ARGV[1], 'expires_at', ARGV[2], 'generation', ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[3])
redis.call('SADD', KEYS[2], ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[3], ARGV[3])
redis.call('HSET', KEYS[4], 'family_id', ARGV[5])
redis.call('EXPIRE', KEYS[4], ARGV[6])
return 'ok'
"""

# Checks the token and its family, marks the token used and writes the next one, atomically.
# A revoked family can no longer slip a new token in between the check and the write, and the
# new token never exists without its TTL.
# KEYS: rt:<old hash>, rf:<family>, rg:<admin>, rtu:<old hash>, rt:<new hash>
# ARGV: family_id, admin_id, now, used-marker ttl, new token ttl, reuse grace seconds
_ROTATE = """
if redis.call('HGET', KEYS[1], 'family_id') ~= ARGV[1] then
  return 'unknown'
end
local family = redis.call('HMGET', KEYS[2], 'admin_id', 'expires_at', 'generation')
if family[1] ~= ARGV[2] then
  return 'revoked'
end
if tonumber(family[2]) <= tonumber(ARGV[3]) then
  return 'expired'
end
if (family[3] or '0') ~= (redis.call('GET', KEYS[3]) or '0') then
  return 'stale'
end
local used_at = redis.call('GET', KEYS[4])
if used_at then
  if tonumber(ARGV[3]) - (tonumber(used_at) or 0) < tonumber(ARGV[6]) then
    return 'conflict'
  end
  return 'reused'
end
redis.call('SET', KEYS[4], ARGV[3], 'EX', ARGV[4])
redis.call('HSET', KEYS[5], 'family_id', ARGV[1])
redis.call('EXPIRE', KEYS[5], ARGV[5])
return 'ok'
"""


class RefreshTokenStore:
    """Refresh-token families in Redis (ADR 0009). Only SHA-256 hashes of tokens are stored.

    Keys:
      `rf:<family>`   hash {admin_id, expires_at, generation}; the family and its hard limit
                      (30 days)
      `ra:<admin>`    set of the admin's family IDs, so a password change can end them all
      `rg:<admin>`    the admin's session generation; `revoke_all` increments it, and a family
                      whose generation is older is dead even if `ra:` missed it
      `rt:<hash>`     the family a token belongs to; lives as long as the token
      `rtu:<hash>`    when the token was used (Unix seconds); written once, by the rotation
    """

    def __init__(
        self, redis: Redis, settings: Settings, clock: Clock = lambda: datetime.now(UTC)
    ) -> None:
        self._redis = redis
        self._token_ttl = timedelta(days=settings.refresh_token_ttl_days)
        self._family_ttl = timedelta(days=settings.refresh_family_max_days)
        self._reuse_grace_seconds = settings.refresh_reuse_grace_seconds
        self._clock = clock
        self._start_script = redis.register_script(_START_FAMILY)
        self._rotate_script = redis.register_script(_ROTATE)

    async def generation(self, admin_id: uuid.UUID) -> int:
        """The admin's current session generation. Read it before trusting a password check."""
        value = await self._redis.get(f"rg:{admin_id}")
        return int(value) if value is not None else 0

    async def start_family(self, admin_id: uuid.UUID, generation: int) -> RefreshSession:
        """Starts a new family at login (or after a password change).

        `generation` is what `generation()` returned before the credentials were checked. If
        `revoke_all` ran since, the login raced a password change (or a deactivation) and
        `StaleSessionError` is raised instead.
        """
        now = self._clock()
        family_id = secrets.token_urlsafe(16)
        family_expires = now + self._family_ttl
        token, expires_at, token_ttl = self._new_token(now, family_expires)
        result = await self._start_script(
            keys=[
                f"rf:{family_id}",
                f"ra:{admin_id}",
                f"rg:{admin_id}",
                f"rt:{hash_token(token)}",
            ],
            args=[
                str(admin_id),
                repr(family_expires.timestamp()),
                _seconds(self._family_ttl),
                str(generation),
                family_id,
                token_ttl,
            ],
        )
        if _text(result) != "ok":
            raise StaleSessionError("sessions were revoked after the login started")
        return RefreshSession(token, family_id, expires_at)

    async def rotate(self, token: str) -> Rotation:
        """Exchanges a refresh token for the next one in its family.

        A token that was already used revokes the whole family (it was probably stolen) and
        raises like any other invalid token, unless it was used less than
        `refresh_reuse_grace_seconds` ago: then it raises `RefreshConflictError` and revokes
        nothing.
        """
        token_hash = hash_token(token)
        raw_family_id = await self._redis.hget(f"rt:{token_hash}", "family_id")
        if raw_family_id is None:
            raise InvalidRefreshTokenError("unknown or expired token")
        family_id = _text(raw_family_id)
        family = await self._redis.hmget(f"rf:{family_id}", ["admin_id", "expires_at"])
        if family[0] is None or family[1] is None:
            raise InvalidRefreshTokenError("family revoked or expired")
        admin_id = _text(family[0])
        family_expires = datetime.fromtimestamp(float(_text(family[1])), UTC)

        now = self._clock()
        new_token, expires_at, token_ttl = self._new_token(now, family_expires)
        result = _text(
            await self._rotate_script(
                keys=[
                    f"rt:{token_hash}",
                    f"rf:{family_id}",
                    f"rg:{admin_id}",
                    f"rtu:{token_hash}",
                    f"rt:{hash_token(new_token)}",
                ],
                args=[
                    family_id,
                    admin_id,
                    repr(now.timestamp()),
                    _seconds(self._token_ttl),
                    token_ttl,
                    self._reuse_grace_seconds,
                ],
            )
        )
        if result == "ok":
            return Rotation(uuid.UUID(admin_id), RefreshSession(new_token, family_id, expires_at))
        if result == "conflict":
            logger.info(
                "refresh token reuse within the grace window", extra={"family_id": family_id}
            )
            raise RefreshConflictError("token was used moments ago")
        if result == "reused":
            logger.warning("refresh token reuse detected", extra={"family_id": family_id})
        if result in ("expired", "stale", "reused"):
            await self.revoke_family(family_id)
        raise InvalidRefreshTokenError(f"refresh rejected: {result}")

    async def revoke_family(self, family_id: str) -> None:
        admin_id = await self._redis.hget(f"rf:{family_id}", "admin_id")
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.delete(f"rf:{family_id}")
            if admin_id is not None:
                pipe.srem(f"ra:{_text(admin_id)}", family_id)
            await pipe.execute()

    async def revoke_by_token(self, token: str) -> None:
        """Logout: ends the family the token belongs to. An unknown token is ignored."""
        family_id = await self._redis.hget(f"rt:{hash_token(token)}", "family_id")
        if family_id is not None:
            await self.revoke_family(_text(family_id))

    async def revoke_all(self, admin_id: uuid.UUID) -> int:
        """Ends every family of the admin and returns the new session generation.

        The generation is bumped first: a login that read the old one can no longer start a
        family, and one that already did is in `ra:` by now. Only the revoked IDs are removed
        from `ra:`, so a family started meanwhile (with the new generation) stays indexed.
        """
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.incr(f"rg:{admin_id}")
            pipe.expire(f"rg:{admin_id}", _seconds(self._family_ttl))
            generation, _ = await pipe.execute()
        family_ids = [
            _text(family_id) for family_id in await self._redis.smembers(f"ra:{admin_id}")
        ]
        if family_ids:
            async with self._redis.pipeline(transaction=True) as pipe:
                pipe.delete(*(f"rf:{family_id}" for family_id in family_ids))
                pipe.srem(f"ra:{admin_id}", *family_ids)
                await pipe.execute()
        return int(generation)

    def _new_token(self, now: datetime, family_expires: datetime) -> tuple[str, datetime, int]:
        """A new token, its expiry and TTL in seconds. It never outlives its family."""
        expires_at = min(now + self._token_ttl, family_expires)
        token = secrets.token_urlsafe(32)  # 256 bits
        ttl = max(1, math.ceil((expires_at - now).total_seconds()))
        return token, expires_at, ttl


def _seconds(delta: timedelta) -> int:
    return int(delta.total_seconds())


def _text(value: str | bytes) -> str:
    return value.decode() if isinstance(value, bytes) else value
