from collections.abc import Callable

import pytest

from vendor_api.db.session import POSTGRES_SCHEMES, async_url, libpq_url, sync_url

REST = "u:p@localhost:5432/vendor"


@pytest.mark.parametrize("scheme", POSTGRES_SCHEMES)
def test_each_consumer_gets_its_own_driver(scheme: str) -> None:
    url = scheme + REST
    assert async_url(url) == "postgresql+asyncpg://" + REST
    assert sync_url(url) == "postgresql+psycopg://" + REST
    assert libpq_url(url) == "postgresql://" + REST


@pytest.mark.parametrize("convert", [async_url, sync_url, libpq_url])
def test_non_postgres_urls_are_rejected(convert: Callable[[str], str]) -> None:
    with pytest.raises(ValueError, match="postgresql"):
        convert("mysql://" + REST)
