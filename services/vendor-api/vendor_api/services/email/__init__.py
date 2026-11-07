"""Transactional email: templates, senders and the background service (issue #80)."""

from vendor_api.services.email.senders import (
    ConsoleEmailSender,
    EmailSender,
    SmtpConfig,
    SmtpEmailSender,
    build_sender,
)
from vendor_api.services.email.service import EmailService, OutgoingEmail
from vendor_api.services.email.templates import (
    EmailContextError,
    EmailTemplate,
    RenderedEmail,
    render,
)

__all__ = [
    "ConsoleEmailSender",
    "EmailContextError",
    "EmailSender",
    "EmailService",
    "EmailTemplate",
    "OutgoingEmail",
    "RenderedEmail",
    "SmtpConfig",
    "SmtpEmailSender",
    "build_sender",
    "render",
]
