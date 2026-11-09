import re
import unicodedata
from collections.abc import Collection

# Leaves room for a numeric suffix inside the column's 80 characters.
MAX_BASE_LENGTH = 60
FALLBACK = "vendor"


def slugify(name: str) -> str:
    """A URL-safe slug from a brand name: ASCII letters and digits joined by single hyphens.

    Accents are folded (`Café` becomes `cafe`); a name with no Latin letters or digits at all
    (for example only Devanagari) falls back to `vendor`, and the numeric suffix then keeps
    slugs unique.
    """
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")
    slug = slug[:MAX_BASE_LENGTH].strip("-")
    return slug or FALLBACK


def next_slug(base: str, taken: Collection[str]) -> str:
    """`base` if it is free, otherwise `base-2`, `base-3`, ... the first one that is."""
    if base not in taken:
        return base
    number = 2
    while f"{base}-{number}" in taken:
        number += 1
    return f"{base}-{number}"
