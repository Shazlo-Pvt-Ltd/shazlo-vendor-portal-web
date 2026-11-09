import re

import pytest

from vendor_api.services.one_time_tokens import hash_token, new_token
from vendor_api.services.slugs import MAX_BASE_LENGTH, next_slug, slugify


@pytest.mark.parametrize(
    ("name", "slug"),
    [
        ("Atelier Rouge", "atelier-rouge"),
        ("  Atelier   Rouge  ", "atelier-rouge"),
        ("Café Étoile", "cafe-etoile"),
        ("Dolce & Gabbana!!", "dolce-gabbana"),
        ("100% Cotton Co.", "100-cotton-co"),
        ("---", "vendor"),
        ("", "vendor"),
        ("कपड़े", "vendor"),  # nothing Latin to keep
        ("Maison_Lune", "maison-lune"),
        ("ÀÉÎÕÜ", "aeiou"),
    ],
)
def test_slugify(name: str, slug: str) -> None:
    assert slugify(name) == slug


def test_a_slug_always_matches_the_database_format() -> None:
    for name in ["x" * 500, "a-" * 100, "!!!a!!!", "Ünï Cödé", "a  b"]:
        slug = slugify(name)
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug)
        assert len(slug) <= MAX_BASE_LENGTH


def test_a_long_name_is_cut_without_a_trailing_hyphen() -> None:
    slug = slugify("a" * 59 + " b")
    assert not slug.endswith("-")
    assert len(slug) <= MAX_BASE_LENGTH


def test_a_free_slug_is_used_as_it_is() -> None:
    assert next_slug("brand", {"other"}) == "brand"


def test_a_taken_slug_gets_the_first_free_number() -> None:
    assert next_slug("brand", {"brand"}) == "brand-2"
    assert next_slug("brand", {"brand", "brand-2"}) == "brand-3"
    assert next_slug("brand", {"brand", "brand-3"}) == "brand-2"


def test_a_suffixed_slug_still_fits_the_column() -> None:
    base = slugify("x" * 200)
    assert len(next_slug(base, {base, *(f"{base}-{n}" for n in range(2, 1000))})) <= 80


def test_tokens_are_256_bit_and_only_the_hash_is_derived() -> None:
    token, token_hash = new_token()
    assert len(token) >= 43  # 32 random bytes, base64url
    assert re.fullmatch(r"[0-9a-f]{64}", token_hash)
    assert token_hash == hash_token(token)
    assert token not in token_hash


def test_tokens_are_unique() -> None:
    assert len({new_token()[0] for _ in range(200)}) == 200


def test_the_hash_is_a_plain_sha256() -> None:
    assert hash_token("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
