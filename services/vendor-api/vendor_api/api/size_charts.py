"""The signed-in brand's size charts, one per group of product types (#265). Vendor tokens only;
the whole team reads and saves them."""

import uuid
from datetime import datetime
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.api.auth import no_store
from vendor_api.api.deps import CurrentVendorUser, current_vendor_user
from vendor_api.core.errors import ApiError
from vendor_api.db.models import SizeChartGroup
from vendor_api.db.session import get_session
from vendor_api.services.size_charts import SizeChartIn, SizeChartService, SizeChartView

router = APIRouter(prefix="/vendor/size-charts", tags=["size-charts"])

Db = Annotated[AsyncSession, Depends(get_session)]
Current = Annotated[CurrentVendorUser, Depends(current_vendor_user)]

NO_SUCH_GROUP = ApiError(
    404,
    "not_found",
    "There is no size chart for that group: use bottoms, tops, dresses or jackets.",
)


def get_size_charts(request: Request) -> SizeChartService:
    return cast(SizeChartService, request.app.state.size_charts)


Charts = Annotated[SizeChartService, Depends(get_size_charts)]


class SizeChartOut(BaseModel):
    group: str
    # Centimetres by size, then measurement: {"M": {"chest": 96, "shoulder": null, ...}}.
    # Bottoms: waist, hip, inseam, length; tops and jackets: chest, shoulder, sleeve, length;
    # dresses: bust, waist, hip, length. Sarees, dupattas and stoles have no chart.
    measurements: dict[str, dict[str, Any]]
    photo_asset_id: uuid.UUID | None
    photo_url: str | None
    # Null when nothing is saved for the group.
    updated_at: datetime | None


def _group(group: str) -> SizeChartGroup:
    try:
        return SizeChartGroup(group)
    except ValueError:
        raise NO_SUCH_GROUP from None


def size_chart_out(view: SizeChartView) -> SizeChartOut:
    return SizeChartOut(
        group=view.group,
        measurements=view.measurements,
        photo_asset_id=view.photo_asset_id,
        photo_url=view.photo_url,
        updated_at=view.updated_at,
    )


@router.get("/{group}")
async def get_size_chart(
    group: str, response: Response, db: Db, charts: Charts, current: Current
) -> SizeChartOut:
    """The brand's chart for a group (`bottoms`, `tops`, `dresses`, `jackets`); empty when none
    is saved. `404` for any other group."""
    no_store(response)
    return size_chart_out(await charts.get(db, current.vendor.id, _group(group)))


@router.put("/{group}")
async def save_size_chart(
    group: str, body: SizeChartIn, response: Response, db: Db, charts: Charts, current: Current
) -> SizeChartOut:
    """Replaces the brand's chart for a group. Sizes and measurements must be the group's; values
    are centimetres above 0 and up to 300 with one decimal at most. `photo_asset_id` is one of
    the brand's own ready `size_chart` images (sign the upload with kind `size_chart`). An empty
    chart without a photo deletes it."""
    no_store(response)
    chart_group = _group(group)
    view = await charts.save(db, current.vendor.id, current.user.id, chart_group, body)
    return size_chart_out(view)
