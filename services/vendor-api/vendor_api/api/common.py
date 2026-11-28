"""What the seller routers and the admin routers both use (ADR 0011).

vendor-api runs as two apps: the seller app (`/v1/auth`, `/v1/vendor/*`, `/v1/public/*`) and
the admin app (`/v1/admin/*`). Neither group of routers imports the other. What both need lives
here, and the response models both return live in `views.py`.
"""

from typing import Annotated, cast

from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from vendor_api.db.session import get_session
from vendor_api.services.email import EmailService

Db = Annotated[AsyncSession, Depends(get_session)]


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def get_emails(request: Request) -> EmailService:
    return cast(EmailService, request.app.state.emails)


# An endpoint sends email with `emails.send_in_background(background_tasks, to, template, context)`.
Emails = Annotated[EmailService, Depends(get_emails)]
