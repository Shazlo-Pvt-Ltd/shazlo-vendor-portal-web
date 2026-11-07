import argparse
import sys
from pathlib import Path

from shazlo_security.keys import KeyConfigError, new_kid, write_new_key


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vendor_api.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    keygen = commands.add_parser("generate-key", help="create an RS256 signing key for local dev")
    keygen.add_argument("--dir", type=Path, default=Path(".keys"), help="default: ./.keys")
    keygen.add_argument("--kid", help="key ID; default is the date plus a random suffix")
    args = parser.parse_args(argv)
    try:
        _generate_key(args.dir, args.kid)
    except CommandError as error:
        print(f"{args.command} failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
