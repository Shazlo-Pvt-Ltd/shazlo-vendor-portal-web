"""The database role each app logs in as (ADR 0011, migration 0012).

The seller app, the admin app and the worker share one database but log in as three users, each a
member of one group role that holds only the table rights that app needs. The owner of the tables
(who runs the migrations and the CLI) is none of them.

`db-logins` (cli.py) creates the three users; `power_problems` says what a login can do that an
app's login must not, so a deployment that forgot all this is caught (`/ready` in prod, and the
worker refuses to start).
"""

import re
from dataclasses import dataclass
from typing import Any, Literal, Protocol

App = Literal["seller", "admin", "worker"]
APPS: tuple[App, ...] = ("seller", "admin", "worker")

# The group roles of migration 0012. Nobody logs in as them.
GROUP_ROLES: dict[App, str] = {
    "seller": "vendor_seller",
    "admin": "vendor_admin",
    "worker": "vendor_worker",
}

MIN_PASSWORD_LENGTH = 16
LOGIN_NAME = re.compile(r"^[a-z][a-z0-9_]{2,62}$")


@dataclass(frozen=True)
class Login:
    """One app's login: its user name and where its password comes from."""

    app: App
    user_env: str
    default_user: str
    password_env: str

    @property
    def group(self) -> str:
        return GROUP_ROLES[self.app]


LOGINS: dict[App, Login] = {
    app: Login(
        app=app,
        user_env=f"VENDOR_{app.upper()}_DB_USER",
        default_user=f"vendor_{app}_app",
        password_env=f"VENDOR_{app.upper()}_DB_PASSWORD",
    )
    for app in APPS
}

# What the current login can do beyond reading and writing rows. One row, for the current user.
# Owning a table counts through membership too (a login that is a member of the owner can do
# what the owner can).
POWER_SQL = """
SELECT r.rolsuper AS superuser,
       r.rolcreaterole AS create_role,
       r.rolcreatedb AS create_db,
       r.rolbypassrls AS bypass_rls,
       has_schema_privilege('public', 'CREATE') AS create_in_schema,
       EXISTS (
           SELECT FROM pg_tables t
           WHERE t.schemaname = 'public' AND pg_has_role(current_user, t.tableowner, 'USAGE')
       ) AS owns_tables
FROM pg_roles r
WHERE r.rolname = current_user
"""

_PROBLEMS = {
    "superuser": "is a superuser",
    "create_role": "may create roles",
    "create_db": "may create databases",
    "bypass_rls": "bypasses row security",
    "create_in_schema": "may create tables in schema public",
    "owns_tables": "owns the tables (or is a member of their owner)",
}


class Row(Protocol):
    """A POWER_SQL row: an asyncpg Record or a SQLAlchemy RowMapping."""

    def __getitem__(self, key: str, /) -> Any: ...


def power_problems(row: Row) -> list[str]:
    """What a POWER_SQL row says the login may do and an app's login must not. Empty is right."""
    return [problem for column, problem in _PROBLEMS.items() if row[column]]
