from typing import Annotated, cast

from fastapi import Depends, Request

from vendor_api.services.email import EmailService


def get_emails(request: Request) -> EmailService:
    return cast(EmailService, request.app.state.emails)


# An endpoint sends email with `emails.send_in_background(background_tasks, to, template, context)`.
Emails = Annotated[EmailService, Depends(get_emails)]
