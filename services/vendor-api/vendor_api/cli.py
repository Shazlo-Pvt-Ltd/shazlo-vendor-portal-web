import argparse
import asyncio
import secrets
import sys
from pathlib import Path

from shazlo_security.keys import KeyConfigError, new_kid, write_new_key

from vendor_api.core.settings import get_settings
from vendor_api.services.email import EmailTemplate, build_sender


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
    args = parser.parse_args(argv)
    try:
        if args.command == "send-test-email":
            _send_test_email(args.to, args.template)
        else:
            _generate_key(args.dir, args.kid)
    except CommandError as error:
        print(f"{args.command} failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
