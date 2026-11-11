import re
from html.parser import HTMLParser

import pytest

from vendor_api.services.email import EmailContextError, EmailTemplate, render

BASE = "https://vendors.shazlo.test"
TOKEN = "tok_AbC-123_xyz"  # noqa: S105

CONTEXTS: dict[EmailTemplate, dict[str, object]] = {
    EmailTemplate.VERIFY_EMAIL: {"token": TOKEN, "expires_in_minutes": 60},
    EmailTemplate.STAFF_INVITE: {
        "token": TOKEN,
        "expires_in_minutes": 2880,
        "vendor_name": "Atelier Rouge",
    },
    EmailTemplate.PASSWORD_RESET: {"token": TOKEN, "expires_in_minutes": 30},
    EmailTemplate.ACCOUNT_EXISTS: {},
    EmailTemplate.VENDOR_APPROVED: {"vendor_name": "Atelier Rao"},
    EmailTemplate.VENDOR_REJECTED: {"vendor_name": "Atelier Rao", "reason": "Photos are blurry"},
    EmailTemplate.VENDOR_SUSPENDED: {"vendor_name": "Atelier Rao", "reason": "Chargebacks"},
}
PATHS = {
    EmailTemplate.VERIFY_EMAIL: "/verify-email",
    EmailTemplate.STAFF_INVITE: "/accept-invite",
    EmailTemplate.PASSWORD_RESET: "/reset-password",
    EmailTemplate.ACCOUNT_EXISTS: "/login",
    EmailTemplate.VENDOR_APPROVED: "/login",
    EmailTemplate.VENDOR_REJECTED: "/login",
    EmailTemplate.VENDOR_SUSPENDED: "/login",
}


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self.hrefs += [value for name, value in attrs if name == "href" and value]


@pytest.mark.parametrize("template", list(EmailTemplate))
def test_every_template_renders_text_and_html_with_the_same_link(template: EmailTemplate) -> None:
    mail = render(template, CONTEXTS[template], base_url=BASE)
    assert mail.subject
    assert mail.link in mail.text
    parser = Links()
    parser.feed(mail.html)
    assert parser.hrefs == [mail.link]
    assert mail.link in mail.html


@pytest.mark.parametrize("template", list(EmailTemplate))
def test_links_are_built_from_the_portal_base_url(template: EmailTemplate) -> None:
    mail = render(template, CONTEXTS[template], base_url=BASE)
    assert mail.link.startswith(BASE + PATHS[template])
    other = render(template, CONTEXTS[template], base_url="http://localhost:5174")
    assert other.link.startswith("http://localhost:5174" + PATHS[template])
    assert BASE not in other.text


@pytest.mark.parametrize("template", [t for t in EmailTemplate if "token" in CONTEXTS[t]])
def test_the_token_is_in_the_fragment_not_the_query(template: EmailTemplate) -> None:
    link = render(template, CONTEXTS[template], base_url=BASE).link
    path, _, fragment = link.partition("#")
    assert fragment == f"token={TOKEN}"
    assert TOKEN not in path
    assert "?" not in link


def test_the_account_exists_email_has_no_token() -> None:
    mail = render(EmailTemplate.ACCOUNT_EXISTS, {}, base_url=BASE)
    assert mail.link == BASE + "/login"
    assert "#" not in mail.link


def test_a_token_is_percent_encoded_in_the_link() -> None:
    context = {**CONTEXTS[EmailTemplate.VERIFY_EMAIL], "token": "a b&c#d/e"}
    link = render(EmailTemplate.VERIFY_EMAIL, context, base_url=BASE).link
    assert link.endswith("#token=a%20b%26c%23d%2Fe")


@pytest.mark.parametrize(
    ("minutes", "phrase"),
    [(1, "1 minute"), (30, "30 minutes"), (60, "1 hour"), (90, "90 minutes"), (2880, "48 hours")],
)
def test_the_expiry_is_stated(minutes: int, phrase: str) -> None:
    context = {"token": TOKEN, "expires_in_minutes": minutes}
    mail = render(EmailTemplate.PASSWORD_RESET, context, base_url=BASE)
    assert f"expires in {phrase}" in mail.text
    assert f"expires in {phrase}" in mail.html


def test_the_expiry_must_be_positive() -> None:
    with pytest.raises(EmailContextError, match="at least 1"):
        render(EmailTemplate.VERIFY_EMAIL, {"token": TOKEN, "expires_in_minutes": 0}, base_url=BASE)


def test_the_token_never_appears_in_the_subject() -> None:
    for template, context in CONTEXTS.items():
        assert TOKEN not in render(template, context, base_url=BASE).subject


def test_html_escapes_the_vendor_name() -> None:
    context = {**CONTEXTS[EmailTemplate.STAFF_INVITE], "vendor_name": '<script>alert("x")</script>'}
    mail = render(EmailTemplate.STAFF_INVITE, context, base_url=BASE)
    assert "<script>" not in mail.html
    assert "&lt;script&gt;" in mail.html


def test_a_vendor_name_cannot_add_mail_headers() -> None:
    context = {
        **CONTEXTS[EmailTemplate.STAFF_INVITE],
        "vendor_name": "Evil\r\nBcc: attacker@example.com",
    }
    mail = render(EmailTemplate.STAFF_INVITE, context, base_url=BASE)
    assert "\n" not in mail.subject
    assert "\r" not in mail.subject


def test_a_very_long_vendor_name_is_cut_in_the_subject() -> None:
    context = {**CONTEXTS[EmailTemplate.STAFF_INVITE], "vendor_name": "x" * 500}
    assert len(render(EmailTemplate.STAFF_INVITE, context, base_url=BASE).subject) < 200


def test_html_escapes_the_link() -> None:
    mail = render(
        EmailTemplate.VERIFY_EMAIL, CONTEXTS[EmailTemplate.VERIFY_EMAIL], base_url=BASE + "/a&b"
    )
    assert "&amp;" in mail.html
    assert re.search(r"[^&]&b", mail.html) is None


@pytest.mark.parametrize(
    "context",
    [
        {"token": TOKEN},
        {"expires_in_minutes": 60},
        {"token": TOKEN, "expires_in_minutes": 60, "extra": "x"},
        {},
    ],
)
def test_a_context_that_does_not_match_is_refused_without_echoing_values(
    context: dict[str, object],
) -> None:
    with pytest.raises(EmailContextError) as error:
        render(EmailTemplate.VERIFY_EMAIL, context, base_url=BASE)
    assert TOKEN not in str(error.value)


def test_an_unknown_template_is_refused() -> None:
    with pytest.raises(ValueError, match="nope"):
        render("nope", {}, base_url=BASE)  # type: ignore[arg-type]


# --- Vendor status emails ----------------------------------------------------------------

STATUS_TEMPLATES = [
    EmailTemplate.VENDOR_APPROVED,
    EmailTemplate.VENDOR_REJECTED,
    EmailTemplate.VENDOR_SUSPENDED,
]


@pytest.mark.parametrize(
    "template", [EmailTemplate.VENDOR_REJECTED, EmailTemplate.VENDOR_SUSPENDED]
)
def test_a_rejection_and_a_suspension_say_why(template: EmailTemplate) -> None:
    mail = render(template, CONTEXTS[template], base_url=BASE)
    reason = str(CONTEXTS[template]["reason"])
    assert reason in mail.text and reason in mail.html
    assert reason not in mail.subject  # never in a subject line


def test_an_approval_has_no_reason() -> None:
    mail = render(
        EmailTemplate.VENDOR_APPROVED, CONTEXTS[EmailTemplate.VENDOR_APPROVED], base_url=BASE
    )
    assert "Atelier Rao" in mail.text and "approved" in mail.subject
    with pytest.raises(EmailContextError):
        render(EmailTemplate.VENDOR_APPROVED, {"vendor_name": "A", "reason": "x"}, base_url=BASE)


@pytest.mark.parametrize("template", STATUS_TEMPLATES)
def test_status_emails_need_exactly_their_keys(template: EmailTemplate) -> None:
    context = dict(CONTEXTS[template])
    for key in context:
        partial = {k: v for k, v in context.items() if k != key}
        with pytest.raises(EmailContextError):
            render(template, partial, base_url=BASE)
    with pytest.raises(EmailContextError):
        render(template, {**context, "extra": "x"}, base_url=BASE)


@pytest.mark.parametrize("template", STATUS_TEMPLATES)
def test_status_emails_link_to_the_portal_without_a_token(template: EmailTemplate) -> None:
    mail = render(template, CONTEXTS[template], base_url=BASE)
    assert mail.link == f"{BASE}/login" and "token" not in mail.link


def test_an_admins_reason_cannot_inject_html_or_headers() -> None:
    reason = '<script>alert(1)</script> & "quotes"\r\nBcc: attacker@example.test'
    mail = render(
        EmailTemplate.VENDOR_REJECTED,
        {"vendor_name": "Atelier\r\nBcc: x@example.test", "reason": reason},
        base_url=BASE,
    )
    assert "<script>" not in mail.html and "&lt;script&gt;" in mail.html
    assert "\n" not in mail.subject and "\r" not in mail.subject
    assert "Bcc:" not in mail.subject
    assert "Atelier Bcc: x@example.test" in mail.text  # the name is one line, wherever it goes


def test_a_very_long_reason_is_cut() -> None:
    mail = render(
        EmailTemplate.VENDOR_SUSPENDED,
        {"vendor_name": "A", "reason": "x" * 50_000},
        base_url=BASE,
    )
    assert len(mail.text) < 5_000 and "x" * 2_000 in mail.text and "x" * 2_001 not in mail.text
