import unicodedata
from typing import Annotated

from pydantic import AfterValidator
from pydantic_core import PydanticCustomError


def _without_nul(value: str) -> str:
    if "\x00" in value:
        raise ValueError("text must not contain NUL characters")
    return value


DatabaseText = Annotated[str, AfterValidator(_without_nul)]

# Unicode categories refused in text people type: controls (NUL, bell, escape...), format
# characters (bidirectional overrides that make "LLP‮evil" read differently, zero-width
# spaces, byte order marks) and lone surrogates, which Postgres cannot store and which break
# JSON encoding. Line and paragraph separators are refused too.
_REFUSED_CATEGORIES = frozenset({"Cc", "Cf", "Cs", "Zl", "Zp"})
# Zero-width (non-)joiners shape Indic scripts and emoji, so names written in them keep them.
_ALLOWED_FORMAT = frozenset({"‌", "‍"})
_LINE_BREAKS = frozenset({"\n", "\r", "\t"})


def has_hidden_characters(value: str, *, multiline: bool = False) -> bool:
    for char in value:
        if char in _ALLOWED_FORMAT or (multiline and char in _LINE_BREAKS):
            continue
        if unicodedata.category(char) in _REFUSED_CATEGORIES:
            return True
    return False


def _visible(value: str) -> str:
    if has_hidden_characters(value):
        raise PydanticCustomError(
            "hidden_characters", "Remove hidden or control characters from this text."
        )
    return value


def _visible_multiline(value: str) -> str:
    if has_hidden_characters(value, multiline=True):
        raise PydanticCustomError(
            "hidden_characters", "Remove hidden or control characters from this text."
        )
    return value


# Single-line text people type and others read (names, cities, addresses): no NUL, controls,
# bidirectional overrides, zero-width spaces or lone surrogates.
VisibleText = Annotated[str, AfterValidator(_visible)]
# The same, but line breaks and tabs are allowed (notes).
MultilineText = Annotated[str, AfterValidator(_visible_multiline)]
