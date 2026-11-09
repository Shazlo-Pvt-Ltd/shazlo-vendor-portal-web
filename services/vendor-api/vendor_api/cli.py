import argparse
import asyncio
import os
import secrets
import sys
from pathlib import Path

from shazlo_security.keys import KeyConfigError, new_kid, write_new_key
from shazlo_security.passwords import PasswordService

from vendor_api.core.security import password_config
from vendor_api.core.settings import get_settings
from vendor_api.db.models import VendorStatus
from vendor_api.db.session import create_engine, create_sessionmaker
from vendor_api.openapi import OPENAPI_PATH, build_openapi
from vendor_api.services.email import EmailTemplate, build_sender
from vendor_api.services.seed import (
    DEV_SEED_PASSWORD,
    SEED_OWNER_EMAIL,
    SEED_STAFF_EMAIL,
    seed_demo_vendor,
)
from vendor_api.services.team import TeamError, TeamService


class CommandError(Exception):
    """The command cannot run. The message is safe to print."""


def _generate_key(directory: Path, kid: str | None) -> None:
    kid = kid or new_kid()
    try:
        path = write_new_key(directory, kid)
    except FileExistsError as error:
        raise CommandError(f"{directory / (kid + '.pem')} already exists") from error
    except KeyConfigError as error:
        raise CommandError(str(error)) from error
    # Only the file name is printed, never the key.
    print(f"Wrote private key {path}")
    print(f"Set JWT_KEYS_DIR={directory} and JWT_SIGNING_KID={kid} to sign with it.")


async def _invite_owner(vendor: str, email: str | None, status: VendorStatus | None) -> str:
    settings = get_settings()
    engine = create_engine(settings.database_url)
    try:
        async with create_sessionmaker(engine)() as db:
            outgoing = await TeamService(settings).invite_owner_of(db, vendor, email, status)
    finally:
        await engine.dispose()
    # The invite is saved. If sending fails, running the command again sends a new one (and
    # the old link stops working).
    try:
        await build_sender(settings).send(outgoing.to, outgoing.template, outgoing.context)
    except Exception as error:
        raise CommandError(
            f"the invite for {outgoing.to} was saved but could not be sent "
            f"({type(error).__name__}); run the command again to send a new one"
        ) from error
    return outgoing.to


async def _seed_dev(password: str) -> bool:
    settings = get_settings()
    engine = create_engine(settings.database_url)
    try:
        async with create_sessionmaker(engine)() as db:
            return await seed_demo_vendor(db, PasswordService(password_config(settings)), password)
    finally:
        await engine.dispose()


def _export_openapi(check: bool, path: Path) -> None:
    text = build_openapi()
    if check:
        current = path.read_text(encoding="utf-8").replace("\r\n", "\n") if path.exists() else ""
        if current != text:
            raise CommandError(
                f"{path} is stale. Regenerate it: python -m vendor_api.cli export-openapi"
            )
        print(f"{path} is up to date.")
        return
    path.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {path}.")


def _send_test_email(to: str, template: EmailTemplate) -> None:
    settings = get_settings()
    if settings.env != "dev":
        raise CommandError("send-test-email only runs with ENV=dev")
    sender = build_sender(settings)
    # A made-up token: the link is dead, it only shows what the email looks like.
    context = {
        EmailTemplate.VERIFY_EMAIL: {"token": secrets.token_urlsafe(16), "expires_in_minutes": 60},
        EmailTemplate.STAFF_INVITE: {
            "token": secrets.token_urlsafe(16),
            "expires_in_minutes": 2880,
            "vendor_name": "Demo Brand",
        },
        EmailTemplate.PASSWORD_RESET: {
            "token": secrets.token_urlsafe(16),
            "expires_in_minutes": 30,
        },
        EmailTemplate.ACCOUNT_EXISTS: {},
    }[template]
    try:
        asyncio.run(sender.send(to, template, context))
    except Exception as error:
        raise CommandError(f"could not send: {type(error).__name__}") from error
    print(f"Sent the {template.value} email to {to} (backend: {settings.email_backend}).")
    if settings.email_backend == "smtp":
        print("In local development it is in the Mailpit inbox: http://localhost:8025")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vendor_api.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    keygen = commands.add_parser("generate-key", help="create an RS256 signing key for local dev")
    keygen.add_argument("--dir", type=Path, default=Path(".keys"), help="default: ./.keys")
    keygen.add_argument("--kid", help="key ID; default is the date plus a random suffix")
    mail = commands.add_parser(
        "send-test-email", help="send an example email through the configured backend (ENV=dev)"
    )
    mail.add_argument("--to", default="vendor@shazlo.test")
    mail.add_argument(
        "--template",
        type=EmailTemplate,
        choices=list(EmailTemplate),
        default=EmailTemplate.VERIFY_EMAIL,
    )
    invite = commands.add_parser(
        "invite-owner",
        help="create or re-invite a vendor's owner and email the invite (the Phase 8 migration)",
    )
    invite.add_argument("--vendor", required=True, help="the vendor's slug or id")
    invite.add_argument("--email", help="the owner's address; default is the vendor's")
    invite.add_argument(
        "--status",
        type=VendorStatus,
        choices=list(VendorStatus),
        help="set the vendor's status too (with an audit event); default: keep it",
    )
    seed = commands.add_parser(
        "seed-dev",
        help="create a demo vendor with a verified owner and a staff user (ENV=dev only)",
    )
    seed.add_argument(
        "--password",
        default=os.environ.get("SEED_VENDOR_PASSWORD"),
        help="the password of both users; default: SEED_VENDOR_PASSWORD, else a documented "
        "local-only default",
    )
    export = commands.add_parser(
        "export-openapi", help="write openapi.json (or, with --check, fail if it is stale)"
    )
    export.add_argument("--check", action="store_true", help="do not write; fail if stale")
    export.add_argument("--out", type=Path, default=OPENAPI_PATH)
    args = parser.parse_args(argv)
    try:
        if args.command == "export-openapi":
            _export_openapi(args.check, args.out)
        elif args.command == "seed-dev":
            settings = get_settings()
            if settings.env != "dev":
                raise CommandError("seed-dev only runs with ENV=dev")
            chosen = args.password or DEV_SEED_PASSWORD
            if len(chosen) < settings.password_min_length:
                raise CommandError(
                    f"the password must have at least {settings.password_min_length} characters"
                )
            if asyncio.run(_seed_dev(chosen)):
                print("Created the demo vendor (approved) with two users:")
                print(f"  owner  {SEED_OWNER_EMAIL}")
                print(f"  staff  {SEED_STAFF_EMAIL}")
                # Never echoed: it is SEED_VENDOR_PASSWORD, --password or the default in the README.
                print("  both use the seed password (local use only).")
            else:
                print("The demo vendor already exists; nothing changed.")
        elif args.command == "invite-owner":
            try:
                to = asyncio.run(_invite_owner(args.vendor, args.email, args.status))
            except TeamError as error:
                raise CommandError(str(error)) from error
            print(f"Invited the owner of {args.vendor} at {to}.")
        elif args.command == "send-test-email":
            _send_test_email(args.to, args.template)
        else:
            _generate_key(args.dir, args.kid)
    except CommandError as error:
        print(f"{args.command} failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
