"""integrity hardening: frozen history for submitted content and decided reviews

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-09

Closes gaps a review found with SQL probes in 0002-0005 (which stay untouched: 0002 is shared
by two PR stacks and must stay byte-identical):

- `vendor_status_events` could be TRUNCATEd.
- A submitted brand profile, product revision (and its variants and images) or a decided
  review could be rewritten, so "the version reviewed" could change after the review.
- A product could be `pending_review` with nothing pending.
- The review foreign keys had no full index, so deleting a profile or revision scanned reviews.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 0002 blocks UPDATE and DELETE but not TRUNCATE. The function is the one review_events
    # uses (0005), so the message is the same "<table> is append-only".
    op.execute(
        """
        CREATE TRIGGER vendor_status_events_no_truncate
        BEFORE TRUNCATE ON vendor_status_events
        FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete_truncate()
        """
    )

    # A brand profile version is editable only while it is a draft. Once submitted, its content
    # is what the review (and, once published, the central app) saw, so it never changes. What
    # still may change is where the version stands, along the documented path only:
    #   pending_review -> published | rejected      (an admin decides)
    #   published      -> superseded                (a newer version is published)
    # plus `published_at`, set once when the version is published, and `updated_at`. Every other
    # column is compared, so a column added later is frozen too unless it is listed here.
    # Going back to `draft` is refused: it would reopen reviewed content. A withdrawn or
    # rejected version stays as history; the vendor edits a new draft row instead.
    # `vendor_id` never changes, not even on a draft.
    op.execute(
        """
        CREATE FUNCTION protect_brand_profile_history() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            mutable CONSTANT text[] := ARRAY['state', 'published_at', 'updated_at'];
        BEGIN
            IF NEW.vendor_id IS DISTINCT FROM OLD.vendor_id THEN
                RAISE EXCEPTION 'a brand profile cannot move to another vendor'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF OLD.state = 'draft' THEN
                RETURN NEW;
            END IF;
            IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
                RAISE EXCEPTION 'a submitted brand profile cannot be edited (state %)', OLD.state
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
                (OLD.state = 'pending_review' AND NEW.state IN ('published', 'rejected'))
                OR (OLD.state = 'published' AND NEW.state = 'superseded')
            ) THEN
                RAISE EXCEPTION 'a brand profile cannot go from % to %', OLD.state, NEW.state
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF OLD.published_at IS NOT NULL
               AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
                RAISE EXCEPTION 'a brand profile''s published_at cannot change once set'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER brand_profiles_protect_history
        BEFORE UPDATE ON brand_profiles
        FOR EACH ROW EXECUTE FUNCTION protect_brand_profile_history()
        """
    )

    # A product revision is frozen once `submitted_at` is set: the review and the live product
    # point at it. The submitting UPDATE itself (submitted_at NULL -> a time) is allowed, and
    # so is anything on a draft. "Being edited again" means a new revision, never clearing
    # `submitted_at`. A draft revision may be deleted (its variants and images cascade); a
    # submitted one may not. An INSERT needs no rule here: a revision inserted already
    # submitted is refused by 0004's trigger, since its variants and images cannot exist yet.
    # `product_id` and `vendor_id` never change, not even on a draft.
    op.execute(
        """
        CREATE FUNCTION protect_submitted_product_revision() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF OLD.submitted_at IS NOT NULL THEN
                    RAISE EXCEPTION 'a submitted product revision cannot be deleted'
                        USING ERRCODE = 'integrity_constraint_violation';
                END IF;
                RETURN OLD;
            END IF;
            IF NEW.product_id IS DISTINCT FROM OLD.product_id
               OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id THEN
                RAISE EXCEPTION 'a product revision cannot move to another product or vendor'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF OLD.submitted_at IS NOT NULL
               AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at')
            THEN
                RAISE EXCEPTION 'a submitted product revision cannot be changed'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER product_revisions_protect_submitted
        BEFORE UPDATE OR DELETE ON product_revisions
        FOR EACH ROW EXECUTE FUNCTION protect_submitted_product_revision()
        """
    )

    # The same freeze for what a revision says about its variants and images: no insert,
    # update or delete once the revision is submitted. An UPDATE checks both the old and the
    # new revision, so a row cannot be moved out of (or into) a submitted one.
    # FOR SHARE locks the revision row against a concurrent submit: either the submit waits
    # for this change (and 0004's trigger then sees it) or this change waits for the submit
    # (and then sees `submitted_at`). A revision that is not found is being deleted in this
    # statement, which the trigger above allows only for a draft, so the cascade goes ahead.
    op.execute(
        """
        CREATE FUNCTION protect_submitted_revision_content() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            revision_ids uuid[];
        BEGIN
            IF TG_OP = 'INSERT' THEN
                revision_ids := ARRAY[NEW.revision_id];
            ELSIF TG_OP = 'DELETE' THEN
                revision_ids := ARRAY[OLD.revision_id];
            ELSE
                revision_ids := ARRAY[OLD.revision_id, NEW.revision_id];
            END IF;
            PERFORM 1 FROM product_revisions
            WHERE id = ANY(revision_ids) AND submitted_at IS NOT NULL
            FOR SHARE;
            IF FOUND THEN
                RAISE EXCEPTION '% of a submitted product revision cannot be changed',
                    TG_TABLE_NAME
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    for table in ("product_revision_variants", "product_images"):
        op.execute(
            f"""
            CREATE TRIGGER {table}_protect_submitted
            BEFORE INSERT OR UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION protect_submitted_revision_content()
            """
        )

    # A product in review has a revision in review.
    op.create_check_constraint(
        op.f("ck_products_pending_review_has_pending"),
        "products",
        "status <> 'pending_review' OR pending_revision_id IS NOT NULL",
    )

    # A review is the record of a decision. While pending, only the decision columns change
    # (pending -> approved | rejected | withdrawn); once decided, nothing does, so a decided
    # review is never reopened: the version is reviewed again with a new row (the partial
    # unique indexes still allow one pending review per version). What was reviewed, by whom
    # it was submitted and when never change. Reviews are never deleted, row by row or by
    # TRUNCATE.
    op.execute(
        """
        CREATE FUNCTION protect_review_record() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
                RAISE EXCEPTION 'reviews cannot be deleted'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF (NEW.id, NEW.vendor_id, NEW.subject, NEW.brand_profile_id,
                NEW.product_revision_id, NEW.submitted_by, NEW.submitted_at, NEW.created_at)
               IS DISTINCT FROM
               (OLD.id, OLD.vendor_id, OLD.subject, OLD.brand_profile_id,
                OLD.product_revision_id, OLD.submitted_by, OLD.submitted_at, OLD.created_at)
            THEN
                RAISE EXCEPTION 'a review''s subject and submission cannot change'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            IF OLD.status <> 'pending'
               AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at')
            THEN
                RAISE EXCEPTION 'a decided review cannot be changed (status %)', OLD.status
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER reviews_protect_record
        BEFORE UPDATE OR DELETE ON reviews
        FOR EACH ROW EXECUTE FUNCTION protect_review_record()
        """
    )
    op.execute(
        """
        CREATE TRIGGER reviews_no_truncate
        BEFORE TRUNCATE ON reviews
        FOR EACH STATEMENT EXECUTE FUNCTION protect_review_record()
        """
    )

    # Full indexes for the review foreign keys. The partial unique indexes cover only pending
    # reviews, so without these, deleting a profile or revision (the RESTRICT check) and
    # "every review of this version" scanned the table.
    op.create_index(op.f("ix_reviews_brand_profile_id"), "reviews", ["brand_profile_id"])
    op.create_index(op.f("ix_reviews_product_revision_id"), "reviews", ["product_revision_id"])


def downgrade() -> None:
    op.drop_index("ix_reviews_product_revision_id", table_name="reviews")
    op.drop_index("ix_reviews_brand_profile_id", table_name="reviews")
    op.execute("DROP TRIGGER reviews_no_truncate ON reviews")
    op.execute("DROP TRIGGER reviews_protect_record ON reviews")
    op.execute("DROP FUNCTION protect_review_record()")
    # op.f: a plain name would get the naming convention's "ck_products_" prefix again.
    op.drop_constraint(op.f("ck_products_pending_review_has_pending"), "products", type_="check")
    for table in ("product_images", "product_revision_variants"):
        op.execute(f"DROP TRIGGER {table}_protect_submitted ON {table}")
    op.execute("DROP FUNCTION protect_submitted_revision_content()")
    op.execute("DROP TRIGGER product_revisions_protect_submitted ON product_revisions")
    op.execute("DROP FUNCTION protect_submitted_product_revision()")
    op.execute("DROP TRIGGER brand_profiles_protect_history ON brand_profiles")
    op.execute("DROP FUNCTION protect_brand_profile_history()")
    op.execute("DROP TRIGGER vendor_status_events_no_truncate ON vendor_status_events")
