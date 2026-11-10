import html
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import quote


class EmailTemplate(StrEnum):
    VERIFY_EMAIL = "verify_email"
    STAFF_INVITE = "staff_invite"
    PASSWORD_RESET = "password_reset"  # noqa: S105  (a template name, not a password)
    ACCOUNT_EXISTS = "account_exists"
    # Told to the vendor when an admin changes its account status (Phase 3).
    VENDOR_APPROVED = "vendor_approved"
    VENDOR_REJECTED = "vendor_rejected"
    VENDOR_SUSPENDED = "vendor_suspended"


class EmailContextError(ValueError):
    """The context does not match the template. The message names keys, never values."""


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str
    # The link the email is about. For token templates it carries the one-time token, so it is
    # a secret: only the dev console backend may print it.
    link: str


# Where the vendor portal handles each link. The token goes in the URL *fragment*: the browser
# never sends it to a server, so it stays out of access logs and `Referer` headers.
_PATHS = {
    EmailTemplate.VERIFY_EMAIL: "/verify-email",
    EmailTemplate.STAFF_INVITE: "/accept-invite",
    EmailTemplate.PASSWORD_RESET: "/reset-password",
    EmailTemplate.ACCOUNT_EXISTS: "/login",
    EmailTemplate.VENDOR_APPROVED: "/login",
    EmailTemplate.VENDOR_REJECTED: "/login",
    EmailTemplate.VENDOR_SUSPENDED: "/login",
}

# The context each template takes: exactly these keys.
_KEYS: dict[EmailTemplate, frozenset[str]] = {
    EmailTemplate.VERIFY_EMAIL: frozenset({"token", "expires_in_minutes"}),
    EmailTemplate.STAFF_INVITE: frozenset({"token", "expires_in_minutes", "vendor_name"}),
    EmailTemplate.PASSWORD_RESET: frozenset({"token", "expires_in_minutes"}),
    EmailTemplate.ACCOUNT_EXISTS: frozenset(),
    EmailTemplate.VENDOR_APPROVED: frozenset({"vendor_name"}),
    EmailTemplate.VENDOR_REJECTED: frozenset({"vendor_name", "reason"}),
    EmailTemplate.VENDOR_SUSPENDED: frozenset({"vendor_name", "reason"}),
}

MAX_NAME_LENGTH = 100
MAX_REASON_LENGTH = 2000


def _duration(minutes: int) -> str:
    if minutes < 1:
        raise EmailContextError("expires_in_minutes must be at least 1")
    if minutes >= 60 and minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour" + ("" if hours == 1 else "s")
    return f"{minutes} minute" + ("" if minutes == 1 else "s")


def _one_line(value: object) -> str:
    """A name for a subject line: one line, trimmed, so a name cannot add mail headers."""
    return " ".join(str(value).split())[:MAX_NAME_LENGTH]


def _reason(value: object) -> str:
    """An admin's reason, as the paragraph of an email: trimmed and bounded. It is plain text in
    the text part and escaped in the HTML part, and never goes into a subject or a header."""
    return str(value).strip()[:MAX_REASON_LENGTH]


def _link(base_url: str, template: EmailTemplate, context: Mapping[str, object]) -> str:
    url = base_url + _PATHS[template]
    token = context.get("token")
    if token is None:
        return url
    return f"{url}#token={quote(str(token), safe='')}"


def _page(heading: str, paragraphs: list[str], link: str, action: str) -> str:
    body = "".join(f"<p>{html.escape(text)}</p>" for text in paragraphs)
    return (
        "<!doctype html><html><body>"
        f"<h2>{html.escape(heading)}</h2>{body}"
        f'<p><a href="{html.escape(link, quote=True)}">{html.escape(action)}</a></p>'
        "<p>If the button does not work, copy this address into your browser:<br>"
        f"{html.escape(link)}</p>"
        "</body></html>"
    )


def render(
    template: EmailTemplate, context: Mapping[str, object], *, base_url: str
) -> RenderedEmail:
    """Renders an email. `base_url` is the vendor portal's address, without a trailing slash."""
    template = EmailTemplate(template)
    expected = _KEYS[template]
    missing = expected - context.keys()
    unknown = context.keys() - expected
    if missing or unknown:
        raise EmailContextError(
            f"{template.value}: missing {sorted(missing)}, unexpected {sorted(unknown)}"
        )
    link = _link(base_url, template, context)

    if template is EmailTemplate.VERIFY_EMAIL:
        expires = _duration(int(str(context["expires_in_minutes"])))
        subject = "Verify your email address for Shazlo"
        paragraphs = [
            "Confirm this email address to finish creating your Shazlo vendor account.",
            f"The link works once and expires in {expires}.",
            "If you did not sign up, you can ignore this email.",
        ]
        action = "Verify email address"
    elif template is EmailTemplate.STAFF_INVITE:
        expires = _duration(int(str(context["expires_in_minutes"])))
        vendor = _one_line(context["vendor_name"])
        subject = f"You are invited to join {vendor} on Shazlo"
        paragraphs = [
            f"You have been invited to join {vendor} on Shazlo.",
            "Accept the invitation and set your password. "
            f"The link works once and expires in {expires}.",
            "If you were not expecting this, you can ignore this email.",
        ]
        action = "Accept invitation"
    elif template is EmailTemplate.PASSWORD_RESET:
        expires = _duration(int(str(context["expires_in_minutes"])))
        subject = "Reset your Shazlo password"
        paragraphs = [
            "Someone asked to reset the password of this Shazlo vendor account.",
            f"Choose a new password. The link works once and expires in {expires}.",
            "If it was not you, ignore this email: your password stays as it is.",
        ]
        action = "Choose a new password"
    elif template is EmailTemplate.VENDOR_APPROVED:
        vendor = _one_line(context["vendor_name"])
        subject = "Your Shazlo vendor account is approved"
        paragraphs = [
            f"{vendor} has been approved on Shazlo.",
            "You can sign in to the vendor portal and keep working on your brand page "
            "and products.",
        ]
        action = "Sign in"
    elif template is EmailTemplate.VENDOR_REJECTED:
        vendor = _one_line(context["vendor_name"])
        subject = "Your Shazlo vendor application was not approved"
        paragraphs = [
            f"We could not approve {vendor} on Shazlo.",
            f"Reason: {_reason(context['reason'])}",
            "If you think this is a mistake, please contact Shazlo support.",
        ]
        action = "Open the vendor portal"
    elif template is EmailTemplate.VENDOR_SUSPENDED:
        vendor = _one_line(context["vendor_name"])
        subject = "Your Shazlo vendor account is suspended"
        paragraphs = [
            f"{vendor} has been suspended on Shazlo. You cannot sign in or publish "
            "until it is reinstated.",
            f"Reason: {_reason(context['reason'])}",
            "If you think this is a mistake, please contact Shazlo support.",
        ]
        action = "Open the vendor portal"
    else:
        subject = "You already have a Shazlo account"
        paragraphs = [
            "Someone tried to create a Shazlo vendor account with this email address, "
            "but one already exists.",
            "If it was you, sign in instead. If you forgot your password, use "
            '"Forgot password" on the sign-in page.',
            "If it was not you, you can ignore this email.",
        ]
        action = "Sign in"

    text = "\n\n".join([*paragraphs, f"{action}: {link}"]) + "\n"
    return RenderedEmail(subject, text, _page(subject, paragraphs, link, action), link)
