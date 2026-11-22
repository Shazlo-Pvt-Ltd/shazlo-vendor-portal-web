"""Text people type and others read must show something.

Hangul fillers and the blank braille cell are letters and symbols to Unicode, so `str.strip`
keeps them and the hidden-character check lets them through, yet they draw nothing. A name or an
address made only of them (or of a lone zero-width joiner) reads as empty.
"""

import pytest
from pydantic import TypeAdapter, ValidationError

from vendor_api.core.validation import MultilineText, VisibleText

visible = TypeAdapter(VisibleText)
multiline = TypeAdapter(MultilineText)

BLANK_LOOKING = [
    "ㅤ",  # Hangul filler
    "ᅟ",  # Hangul choseong filler
    "ᅠ",  # Hangul jungseong filler
    "ﾠ",  # halfwidth Hangul filler
    "⠀",  # braille pattern blank
    "‍",  # a zero-width joiner on its own
    "‌",  # a zero-width non-joiner on its own
    " ㅤ ⠀ ",
]


@pytest.mark.parametrize("raw", BLANK_LOOKING)
def test_text_that_only_looks_blank_is_refused(raw: str) -> None:
    with pytest.raises(ValidationError):
        visible.validate_python(raw)
    with pytest.raises(ValidationError):
        multiline.validate_python(raw)


@pytest.mark.parametrize(
    "raw",
    [
        "Asha Mehta",
        "क्‍ष",  # a joiner inside Indic text shapes it and stays allowed
        "한글",
        "Kalki ㅤ Studio",  # a filler among visible text is odd but not empty
        "",  # empty and all-space text are left to each field's "Enter ..." check
        "   ",
    ],
)
def test_visible_text_is_kept(raw: str) -> None:
    assert visible.validate_python(raw) == raw
    assert multiline.validate_python(raw) == raw
