"""a database role per app, with only the table rights it needs (ADR 0011)

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-27

The seller app, the admin app and the worker share one database, but each logs in as its own user
with only the rights its code needs. A bug or a break-in in one app then cannot do what only the
other may: the seller app cannot write a review decision, the admin app cannot read or change a
seller's password or tokens, and neither app can truncate a table or change the schema.

- Three group roles, `vendor_seller`, `vendor_admin` and `vendor_worker`, created here if missing
  (NOLOGIN: nobody signs in as them). Roles belong to the whole Postgres server, so a second
  database on it (vendor_test) shares them; each database has its own grants.
- The login users (`vendor_seller_app`, ...) and their passwords are not made here: run
  `python -m vendor_api.cli db-logins` as the owner after migrating. Migrations and the CLI keep
  running as the owner of the tables.
- Grants are per table and per right, from the table below (and, where an app needs one column
  of a table, per column). A new table needs its own line here
  in its migration, or no app can use it (tests/test_db_roles.py checks the whole matrix).
- Append-only tables (the event logs) get no UPDATE or DELETE for anyone, on top of their
  triggers. Nobody gets TRUNCATE, REFERENCES or TRIGGER.

Frozen copy: later migrations change grants in their own files.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SELLER, ADMIN, WORKER = "vendor_seller", "vendor_admin", "vendor_worker"
ROLES = (SELLER, ADMIN, WORKER)
R, C, U, D = "SELECT", "INSERT", "UPDATE", "DELETE"

# What each app's code does to each table, and nothing more.
GRANTS: dict[str, dict[str, tuple[str, ...]]] = {
    # Signup creates a vendor; the brand profile and store details update its contact fields.
    # Review decisions and suspensions change its status. The worker publishes from it.
    "vendors": {SELLER: (R, C, U), ADMIN: (R, U), WORKER: (R,)},
    # The worker counts a vendor's status changes: that count is the version of its status event.
    "vendor_status_events": {SELLER: (R, C), ADMIN: (R, C), WORKER: (R,)},
    # Passwords, verification and staff live only on the seller side. Admins see who the users
    # are (vendor detail); suspending ends sessions in Redis, not here.
    "vendor_users": {SELLER: (R, C, U), ADMIN: (R,)},
    "auth_tokens": {SELLER: (R, C, U)},
    "assets": {SELLER: (R, C, U), ADMIN: (R,), WORKER: (R,)},
    "brand_profiles": {SELLER: (R, C, U), ADMIN: (R, U), WORKER: (R,)},
    # A seller may delete a draft product; approving moves the live and pending revisions.
    "products": {SELLER: (R, C, U, D), ADMIN: (R, U), WORKER: (R,)},
    "product_revisions": {SELLER: (R, C, U, D), ADMIN: (R, U), WORKER: (R,)},
    "product_variants": {SELLER: (R, C, U, D), ADMIN: (R,), WORKER: (R,)},
    "product_revision_variants": {SELLER: (R, C, U, D), ADMIN: (R,), WORKER: (R,)},
    "product_images": {SELLER: (R, C, U, D), ADMIN: (R,), WORKER: (R,)},
    # Submitting opens a review and editing withdraws it; only the admin app decides.
    "reviews": {SELLER: (R, C, U), ADMIN: (R, U), WORKER: (R,)},
    "review_events": {SELLER: (R, C), ADMIN: (R, C)},
    # Archiving a live product writes an event from the seller app, an approval from the admin
    # app. Only the worker sends, and cleans up what was sent; the admin app may retry a dead one.
    "outbox_events": {SELLER: (R, C), ADMIN: (R, C, U), WORKER: (R, C, U, D)},
    "outbox_event_log": {ADMIN: (R, C), WORKER: (R, C)},
    # Payout numbers are sealed by the seller app; the admin app reads the masked columns.
    "store_details": {SELLER: (R, C, U), ADMIN: (R,)},
    "commissions": {SELLER: (R, C, U), ADMIN: (R, C, U)},
    "size_charts": {SELLER: (R, C, U, D), ADMIN: (R,), WORKER: (R,)},
    "vendor_change_events": {SELLER: (R, C), ADMIN: (R, C)},
}

# Rights on single columns, where an app needs one column of a table and not the rest.
COLUMN_GRANTS: dict[str, dict[str, tuple[str, tuple[str, ...]]]] = {
    # Reconciliation raises a product's version to its events' version (which stamps updated_at);
    # nothing else of it.
    "products": {WORKER: (U, ("version", "updated_at"))},
}


def upgrade() -> None:
    for role in ROLES:
        op.execute(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{role}') THEN
                    CREATE ROLE {role} NOLOGIN;
                END IF;
            END
            $$
            """
        )
        op.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
    for table, rights in GRANTS.items():
        for role, allowed in rights.items():
            op.execute(f"GRANT {', '.join(allowed)} ON {table} TO {role}")
    for table, columns in COLUMN_GRANTS.items():
        for role, (right, names) in columns.items():
            op.execute(f"GRANT {right} ({', '.join(names)}) ON {table} TO {role}")


def downgrade() -> None:
    # Only this database's grants: the roles may hold grants in another database on the server.
    for table in GRANTS:
        op.execute(f"REVOKE ALL ON {table} FROM {', '.join(ROLES)}")
    for role in ROLES:
        op.execute(f"REVOKE USAGE ON SCHEMA public FROM {role}")
