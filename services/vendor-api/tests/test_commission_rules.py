"""The commission state machine (#265, spec section 6), without a database.

not_set --propose--> proposed --approve--> agreed
                     proposed --send back--> sent_back --propose--> proposed
any state --set (admin)--> agreed
agreed --propose--> proposed (the agreed rate stays in force until approved)
"""

import pytest

from vendor_api.services.commission import (
    CommissionRuleError,
    Terms,
    approve,
    propose,
    send_back,
    set_rate,
)

NOT_SET = Terms("not_set", None, None, None)
PROPOSED = Terms("proposed", None, 1000, None)
SENT_BACK = Terms("sent_back", None, 1000, "Our standard rate for kurtas is 12%.")
AGREED = Terms("agreed", 1200, None, None)
NOTE = "Our standard rate for kurtas is 12%."


@pytest.mark.parametrize("before", [NOT_SET, PROPOSED, SENT_BACK])
def test_a_brand_proposes_from_any_state(before: Terms) -> None:
    assert propose(before, 1500) == Terms("proposed", before.agreed_bps, 1500, None)


def test_proposing_again_keeps_the_agreed_rate_in_force() -> None:
    assert propose(AGREED, 1000) == Terms("proposed", 1200, 1000, None)


def test_proposing_the_agreed_rate_is_refused() -> None:
    with pytest.raises(CommissionRuleError) as error:
        propose(AGREED, 1200)
    assert error.value.code == "same_as_agreed"


@pytest.mark.parametrize("rate", [-1, 4001, 10**9])
def test_rates_are_0_to_40_percent(rate: int) -> None:
    with pytest.raises(CommissionRuleError) as error:
        propose(NOT_SET, rate)
    assert error.value.code == "rate_range"
    with pytest.raises(CommissionRuleError):
        set_rate(NOT_SET, rate, None)


@pytest.mark.parametrize("rate", [0, 1, 1250, 4000])
def test_the_edges_are_allowed(rate: int) -> None:
    assert propose(NOT_SET, rate).proposed_bps == rate


def test_approve_takes_the_proposal() -> None:
    assert approve(PROPOSED, 1000) == Terms("agreed", 1000, None, None)
    assert approve(propose(AGREED, 1000), 1000) == Terms("agreed", 1000, None, None)


def test_approve_refuses_a_proposal_that_changed_since_the_reviewer_saw_it() -> None:
    with pytest.raises(CommissionRuleError) as error:
        approve(PROPOSED, 900)
    assert error.value.code == "commission_changed"
    assert error.value.status == 409


@pytest.mark.parametrize("before", [NOT_SET, SENT_BACK, AGREED])
def test_only_a_waiting_proposal_can_be_approved_or_sent_back(before: Terms) -> None:
    with pytest.raises(CommissionRuleError) as error:
        approve(before, 1000)
    assert error.value.code == "no_proposal"
    assert error.value.status == 409
    with pytest.raises(CommissionRuleError):
        send_back(before, NOTE)


def test_send_back_keeps_the_proposal_and_adds_the_note() -> None:
    assert send_back(PROPOSED, f"  {NOTE}  ") == Terms("sent_back", None, 1000, NOTE)


@pytest.mark.parametrize("note", ["", "   ", "too short", "x" * 601])
def test_send_back_needs_a_note_of_10_to_600_characters(note: str) -> None:
    with pytest.raises(CommissionRuleError) as error:
        send_back(PROPOSED, note)
    assert error.value.code == "note_length"


@pytest.mark.parametrize("before", [NOT_SET, PROPOSED, SENT_BACK, AGREED])
def test_an_admin_sets_a_rate_from_any_state(before: Terms) -> None:
    assert set_rate(before, 1100, None) == Terms("agreed", 1100, None, None)
    assert set_rate(before, 1100, f" {NOTE} ") == Terms("agreed", 1100, None, NOTE)


def test_a_set_note_is_optional_but_bounded() -> None:
    assert set_rate(NOT_SET, 1100, "   ").note is None
    with pytest.raises(CommissionRuleError):
        set_rate(NOT_SET, 1100, "x" * 601)


def test_rule_errors_say_what_to_fix() -> None:
    with pytest.raises(CommissionRuleError) as error:
        propose(NOT_SET, 5000)
    assert "40%" in error.value.message
