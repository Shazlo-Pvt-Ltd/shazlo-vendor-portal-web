"""A brand's size charts, one per group of product types (#265, spec section 7).

Measurements are centimetres above 0 and at most 300 with at most one decimal place, by size and
then by measurement; each group has its own measurements. A saved size comes back with every
measurement of its group (null when blank), sizes left wholly blank are dropped, and sizes are in
size order. A chart with no measurements and no photo is the same as none: saving one deletes the
row. The photo is one of the vendor's own ready `size_chart` images.
"""

import math
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.core.errors import FieldProblems
from vendor_api.db.models import (
    ActorType,
    Asset,
    AssetKind,
    AssetStatus,
    ChangeSubject,
    SizeChart,
    SizeChartGroup,
    VendorChangeEvent,
)

MEASUREMENTS: dict[SizeChartGroup, tuple[str, ...]] = {
    SizeChartGroup.BOTTOMS: ("waist", "hip", "inseam", "length"),
    SizeChartGroup.TOPS: ("chest", "shoulder", "sleeve", "length"),
    SizeChartGroup.DRESSES: ("bust", "waist", "hip", "length"),
    SizeChartGroup.JACKETS: ("chest", "shoulder", "sleeve", "length"),
}
LETTER_SIZES = ("XS", "S", "M", "L", "XL", "XXL", "3XL")
ONE_SIZE = "One size"
WAIST_SIZES = tuple(str(n) for n in range(26, 41))
ALL_SIZES = (*LETTER_SIZES, ONE_SIZE, *WAIST_SIZES)
MEASUREMENT_MAX_CM = 300
# Every size there is, once: more keys than this is not a chart.
MAX_SIZES = len(ALL_SIZES)


def sizes_for(group: SizeChartGroup) -> tuple[str, ...]:
    """Bottoms take letter, one-size and waist sizes; the other groups letter and one-size."""
    return ALL_SIZES if group == SizeChartGroup.BOTTOMS else (*LETTER_SIZES, ONE_SIZE)


class SizeChartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # {"M": {"chest": 96, "length": null}}: checked by `check_chart`, so each problem names its
    # size and measurement.
    measurements: dict[str, Any]
    photo_asset_id: uuid.UUID | None = None


def _valid_cm(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return False
    if not math.isfinite(value) or not 0 < value <= MEASUREMENT_MAX_CM:
        return False
    return abs(value * 10 - round(value * 10)) < 1e-9


def check_chart(group: SizeChartGroup, body: SizeChartIn) -> dict[str, str]:
    out: dict[str, str] = {}
    if len(body.measurements) > MAX_SIZES:
        return {"measurements": f"A chart has at most {MAX_SIZES} sizes."}
    allowed_sizes = sizes_for(group)
    allowed = MEASUREMENTS[group]
    for size, row in body.measurements.items():
        # A key is only repeated back (in the problem's place) when it is one of ours: an
        # unknown one could be huge or not even encodable.
        if size not in ALL_SIZES:
            out["measurements"] = f"Use the sizes {', '.join(allowed_sizes)}."
            continue
        where = f"measurements.{size}"
        if size not in allowed_sizes:
            out[where] = "This size is not used for this kind of product."
            continue
        if not isinstance(row, dict):
            out[where] = "Give the measurements of this size."
            continue
        if any(name not in allowed for name in row):
            out[where] = f"Use {', '.join(allowed)} for this chart."
            continue
        for name, value in row.items():
            if value is not None and not _valid_cm(value):
                out[f"{where}.{name}"] = (
                    f"Enter centimetres above 0 and up to {MEASUREMENT_MAX_CM}, "
                    "with at most one decimal place."
                )
    return out


def normalise(group: SizeChartGroup, measurements: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Every measurement of the group for each size (null when blank); blank sizes dropped; in
    size order. Run after `check_chart` passed."""
    out: dict[str, dict[str, Any]] = {}
    known = [size for size in measurements if size in ALL_SIZES]
    for size in sorted(known, key=ALL_SIZES.index):
        row = measurements[size]
        full = {name: row.get(name) for name in MEASUREMENTS[group]}
        if any(value is not None for value in full.values()):
            out[size] = full
    return out


@dataclass(frozen=True)
class SizeChartView:
    group: str
    measurements: dict[str, dict[str, Any]]
    photo_asset_id: uuid.UUID | None
    photo_url: str | None
    updated_at: datetime | None


def _empty(group: SizeChartGroup) -> SizeChartView:
    return SizeChartView(group, {}, None, None, None)


class SizeChartService:
    async def get(
        self, db: AsyncSession, vendor_id: uuid.UUID, group: SizeChartGroup
    ) -> SizeChartView:
        row = await db.scalar(
            select(SizeChart)
            .where(SizeChart.vendor_id == vendor_id, SizeChart.size_group == group)
            .execution_options(populate_existing=True)
        )
        if row is None:
            return _empty(group)
        url = None
        if row.photo_asset_id is not None:
            url = await db.scalar(
                select(Asset.url).where(
                    Asset.vendor_id == vendor_id, Asset.id == row.photo_asset_id
                )
            )
        # JSONB does not keep key order, so put sizes and measurements back in theirs.
        return SizeChartView(
            group, normalise(group, row.measurements), row.photo_asset_id, url, row.updated_at
        )

    async def _check_photo(
        self, db: AsyncSession, vendor_id: uuid.UUID, asset_id: uuid.UUID
    ) -> None:
        found = await db.scalar(
            select(Asset.id).where(
                Asset.id == asset_id,
                Asset.vendor_id == vendor_id,
                Asset.kind == AssetKind.SIZE_CHART,
                Asset.status == AssetStatus.READY,
            )
        )
        if found is None:
            # The same answer whether the image is another vendor's or not ready: nothing about
            # other vendors' files is revealed.
            raise FieldProblems(
                {"photo_asset_id": "Choose one of your uploaded size chart photos."}
            )

    async def save(
        self,
        db: AsyncSession,
        vendor_id: uuid.UUID,
        user_id: uuid.UUID,
        group: SizeChartGroup,
        body: SizeChartIn,
    ) -> SizeChartView:
        problems = check_chart(group, body)
        if problems:
            raise FieldProblems(problems)
        if body.photo_asset_id is not None:
            await self._check_photo(db, vendor_id, body.photo_asset_id)
        measurements = normalise(group, body.measurements)
        if not measurements and body.photo_asset_id is None:
            removed = await db.execute(
                delete(SizeChart)
                .where(SizeChart.vendor_id == vendor_id, SizeChart.size_group == group)
                .returning(SizeChart.vendor_id)
            )
            if removed.first() is not None:
                self._audit(db, vendor_id, user_id, "cleared", group)
            await db.commit()
            return _empty(group)
        values = {
            "measurements": measurements,
            "photo_asset_id": body.photo_asset_id,
            "updated_by": user_id,
        }
        await db.execute(
            insert(SizeChart)
            .values(vendor_id=vendor_id, size_group=group, **values)
            .on_conflict_do_update(
                index_elements=[SizeChart.vendor_id, SizeChart.size_group],
                set_={**values, "updated_at": func.now()},
            )
        )
        self._audit(db, vendor_id, user_id, "saved", group)
        await db.commit()
        return await self.get(db, vendor_id, group)

    @staticmethod
    def _audit(
        db: AsyncSession, vendor_id: uuid.UUID, user_id: uuid.UUID, action: str, group: str
    ) -> None:
        db.add(
            VendorChangeEvent(
                vendor_id=vendor_id,
                subject=ChangeSubject.SIZE_CHART,
                action=action,
                actor_type=ActorType.VENDOR,
                actor_id=user_id,
                detail={"group": str(group)},
            )
        )
