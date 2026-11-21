"""Measurement values in size charts: centimetres above 0 and up to the limit, in tenths.

The API tests cover the HTTP side; these pin the rule itself, without a database.
"""

from typing import Any

import pytest

from vendor_api.db.models import SizeChartGroup
from vendor_api.services.size_charts import SizeChartIn, check_chart, normalise

TOPS = SizeChartGroup.TOPS


def problems(value: Any) -> dict[str, str]:
    return check_chart(TOPS, SizeChartIn(measurements={"M": {"chest": value}}))


@pytest.mark.parametrize("value", [96, 96.5, 0.1, 300, 299.9])
def test_tenths_of_a_centimetre_are_accepted(value: Any) -> None:
    assert problems(value) == {}


@pytest.mark.parametrize(
    "value",
    [
        1e-12,  # rounds to 0 tenths: no measurement is that small
        5e-324,  # the smallest float above 0
        0.04,
        0,
        -1,
        300.1,
        10**400,  # too large to become a float
        -(10**400),
    ],
)
def test_values_that_are_not_a_measurement_are_refused(value: Any) -> None:
    assert "measurements.M.chest" in problems(value)


def test_stored_values_are_whole_tenths() -> None:
    # Float noise within the tolerance is accepted and then stored as the tenth it stands for.
    stored = normalise(TOPS, {"M": {"chest": 96.0000000001, "length": 70, "sleeve": 61.5}})
    assert stored == {"M": {"chest": 96.0, "shoulder": None, "sleeve": 61.5, "length": 70}}
