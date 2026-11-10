from typing import Annotated

from pydantic import AfterValidator


def _without_nul(value: str) -> str:
    if "\x00" in value:
        raise ValueError("text must not contain NUL characters")
    return value


DatabaseText = Annotated[str, AfterValidator(_without_nul)]
