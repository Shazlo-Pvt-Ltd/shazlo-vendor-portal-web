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


# Letters and symbols that draw nothing: the Hangul fillers and the blank braille cell. Unicode
# does not class them as spaces or format characters, so neither `str.strip` nor the check above
# removes them.
_BLANK_LOOKING = frozenset({"ᅟ", "ᅠ", "ㅤ", "ﾠ", "⠀"}) | _ALLOWED_FORMAT


def looks_blank(value: str) -> bool:
    """Something is there, but a reader sees nothing: only spaces, fillers and lone joiners.
    Empty and all-space text are not caught here; each field's own check asks for it."""
    return (
        not value.isspace()
        and bool(value)
        and all(char.isspace() or char in _BLANK_LOOKING for char in value)
    )


def _refuse_unreadable(value: str, *, multiline: bool) -> str:
    if has_hidden_characters(value, multiline=multiline):
        raise PydanticCustomError(
            "hidden_characters", "Remove hidden or control characters from this text."
        )
    if looks_blank(value):
        raise PydanticCustomError("blank_text", "This looks empty. Type the text itself.")
    return value


def _visible(value: str) -> str:
    return _refuse_unreadable(value, multiline=False)


def _visible_multiline(value: str) -> str:
    return _refuse_unreadable(value, multiline=True)


# Single-line text people type and others read (names, cities, addresses): no NUL, controls,
# bidirectional overrides, zero-width spaces or lone surrogates.
VisibleText = Annotated[str, AfterValidator(_visible)]
# The same, but line breaks and tabs are allowed (notes).
MultilineText = Annotated[str, AfterValidator(_visible_multiline)]
