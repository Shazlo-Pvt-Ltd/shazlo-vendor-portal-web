// The view models the admin screens use: what the screens show, whatever the wire shape is.
// Adapters in `adapters/` map vendor-api's responses (and `openapi/proposed.yaml`'s) to these.
// Written once from the first hand-written spec of the screens; edit them here, not in a spec.

export type ItemKind = "product" | "brand_page" | "application";

export type VendorStatus = "applied" | "under_review" | "approved" | "rejected" | "suspended";

export type OutboxStatus = "waiting" | "retrying" | "failed" | "delivered";

export type Sells = "women" | "men" | "both";

export type CommissionState = "not_set" | "proposed" | "sent_back" | "agreed";

/** @description Per brand; there is no default rate. agreed_bps is the rate in force; proposed_bps is the brand's proposal while it waits, and after it was sent back. */
export type Commission = {
    state: CommissionState;
    agreed_bps: number | null;
    proposed_bps: number | null;
    /** @description Shazlo's note to the brand: required when sent back, optional when Shazlo set the rate */
    note: string | null;
    /** Format: date-time */
    updated_at: string | null;
};

export type PickupAddress = {
    line: string;
    area: string;
    city: string;
    pin: string;
};

export type Delivery = {
    /** @enum {string} */
    by: "shazlo";
    pickup_address: PickupAddress;
} | {
    /** @enum {string} */
    by: "own";
    all_india: boolean;
    /** @description Cities or PIN codes, when not all of India */
    places: string[];
    /** @enum {string} */
    days: "1_2" | "2_3" | "3_5" | "5_7";
};

export type Returns = {
    /**
     * @description 0 means no returns
     * @enum {integer}
     */
    window_days: 0 | 7 | 14 | 30;
    /** @enum {string|null} */
    condition: "unworn_with_tags" | "any_reason" | "damaged_or_wrong" | null;
    /**
     * @description Working days after pickup
     * @enum {integer|null}
     */
    refund_days: 2 | 5 | 7 | null;
};

/** @description Masked. The admin API never returns a full account number or UPI ID. */
export type Payout = {
    /** @enum {string} */
    method: "bank";
    account_holder: string;
    account_last4: string;
    ifsc: string;
    /** @description Looked up from the IFSC */
    bank_name: string;
} | {
    /** @enum {string} */
    method: "upi";
    /** @description For example ki••••@okhdfc */
    upi_masked: string;
};

/** @description What the brand gave at sign-up (docs/ui-plan/vendor-requirements-and-phone-ux.md section 5). Contact name, mobile, email and ship-from city are on the vendor. */
export type Application = {
    instagram_or_website: string | null;
    delivery: Delivery;
    returns: Returns;
    pay_on_delivery: {
        cash: boolean;
        upi: boolean;
    };
    payout: Payout;
    legal_name: string | null;
    gst_number: string | null;
    /** @description The rate the brand proposed at sign-up; the current state is the vendor's commission */
    proposed_commission_bps: number | null;
    /** @description Agreed to the seller terms */
    agreed_terms: boolean;
    /** @description Agreed that their price on Shazlo will never be higher than anywhere else */
    agreed_price_rule: boolean;
    /** Format: date-time */
    applied_at: string;
};

export type VendorRef = {
    id: string;
    name: string;
};

export type Summary = {
    queue: {
        all: number;
        product: number;
        brand_page: number;
        application: number;
        over_24h: number;
    };
    decided_today: number;
    median_minutes: number | null;
    resubmissions: number;
    /** @description Vendors whose proposed commission waits for Shazlo */
    commission_proposals: number;
    publishing: {
        waiting: number;
        retrying: number;
        failed: number;
        delivered_24h: number;
    };
    recent: {
        id: string;
        /** @description Product id, or the vendor id for brand pages and applications */
        subject_id: string;
        kind: ItemKind;
        title: string;
        vendor: VendorRef;
        /** @enum {string} */
        decision: "approved" | "rejected";
        /** Format: date-time */
        at: string;
        reviewer: string;
    }[];
};

export type QueueItem = {
    id: string;
    kind: ItemKind;
    subject_id: string;
    title: string;
    detail: string;
    vendor: VendorRef;
    /** Format: date-time */
    submitted_at: string;
    /** @enum {string} */
    change: "new" | "edit" | "application";
    /** @description 0 for a first submission */
    resubmission: number;
    thumbnail_url: string | null;
};

export type QueuePage = {
    items: QueueItem[];
    counts: {
        all: number;
        product: number;
        brand_page: number;
        application: number;
    };
    vendors: VendorRef[];
};

export type Colour = {
    name: string;
    /** @description null for Multicolour */
    hex: string | null;
};

export type ProductPhoto = {
    id: string;
    url: string;
    /**
     * @description Four named slots are required; up to four extras
     * @enum {string}
     */
    slot: "front" | "back" | "detail" | "worn" | "extra";
};

/** @description Real people wearing it, so shoppers see the true fit. Five are required. */
export type TryOnPhoto = {
    id: string;
    url: string;
};

/** @description The brand's chart for a product type, saved once and used for all its products of that type: measurements in cm (each optional), or a photo of the brand's own chart. */
export type SizeChart = {
    /** @enum {string} */
    kind: "table";
    product_type: string;
    /** @description Column names, e.g. Chest, Waist, Length */
    measurements: string[];
    rows: {
        size: string;
        cm: (number | null)[];
    }[];
} | {
    /** @enum {string} */
    kind: "photo";
    product_type: string;
    url: string;
};

export type ProductVersion = {
    title: string;
    description: string;
    /** @enum {string} */
    gender: "women" | "men" | "unisex";
    /** @description As the brand picked it, e.g. Kurtas, Shirts, Sarees */
    product_type: string;
    main_colour: Colour;
    other_colours: Colour[];
    /** @description e.g. 100% linen */
    material: string;
    /** @description Selling price */
    price_paise: number;
    /** @description Optional. The app shows the lower of the two. */
    mrp_paise: number | null;
    variants: {
        size: string;
        /** @description Automatic product code */
        sku: string;
        stock: number;
    }[];
    photos: ProductPhoto[];
    try_on_photos: TryOnPhoto[];
    size_chart: SizeChart | null;
};

export type ProductReview = {
    id: string;
    sku: string;
    /** @enum {string} */
    status: "pending_review" | "approved" | "rejected";
    vendor: VendorRef;
    /** Format: date-time */
    submitted_at: string;
    resubmission: number;
    submitted: ProductVersion;
    compare_to: ProductVersion | null;
    /** @enum {string|null} */
    compare_label: "sent_back" | "live" | null;
    history: History;
    prev_id: string | null;
    next_id: string | null;
};

export type History = {
    /** Format: date-time */
    at: string;
    /** @enum {string} */
    event: "submitted" | "approved" | "rejected" | "published" | "applied" | "info_requested" | "suspended" | "reactivated" | "invited" | "commission_proposed" | "commission_approved" | "commission_sent_back" | "commission_set";
    by: string;
    note?: string;
}[];

export type BrandProfile = {
    tagline: string;
    story: string;
    based_in: string;
    cover_url: string | null;
    logo_url: string | null;
    return_policy: string;
    dispatch_time: string;
    instagram: string;
    website: string;
};

export type BrandReview = {
    vendor: VendorRef;
    /** Format: date-time */
    submitted_at: string;
    live: BrandProfile | null;
    draft: BrandProfile;
    changed_fields: string[];
    history: History;
    prev_id: string | null;
    next_id: string | null;
};

export type RejectBody = {
    /** @enum {string} */
    reason_code: "photos" | "try_on_photos" | "price" | "category" | "prohibited" | "description" | "brand_images" | "contact_details" | "other";
    reason: string;
};

export type Decision = {
    id: string;
    /** @enum {string} */
    decision: "approved" | "rejected";
    /** Format: date-time */
    at: string;
    /** @description The next item waiting in the queue */
    next_id: string | null;
};

export type VendorSummary = {
    id: string;
    brand_name: string;
    /** @description The contact person from sign-up */
    owner_name: string;
    email: string;
    /** @description Mobile number */
    phone: string;
    /** @description City or area the brand ships from */
    city: string;
    sells: Sells;
    status: VendorStatus;
    live_products: number;
    /** Format: date-time */
    since: string;
    /** @description The agreed rate (the same as commission.agreed_bps) */
    commission_bps: number | null;
    commission: Commission;
};

export type VendorPage = {
    items: VendorSummary[];
    counts: {
        all: number;
        applied: number;
        under_review: number;
        approved: number;
        rejected: number;
        suspended: number;
        /** @description Vendors whose commission is proposed */
        rate_to_review: number;
    };
    cities: string[];
};

export type VendorDetail = VendorSummary & {
    application: Application;
    checks: {
        label: string;
        ok: boolean;
        note: string;
    }[];
    products: {
        id: string;
        title: string;
        status: string;
        price_paise: number;
        thumbnail_url: string | null;
        /**
         * Format: date-time
         * @description When this version was submitted; sent back with a decision as the version the reviewer saw
         */
        submitted_at: string;
        /** @description Required photos this version lacks, by the product review page's rule: each of front, back, detail and worn, and try-on photos short of 5 */
        photos_missing: number;
    }[];
    brand_live: boolean;
    history: History;
};

export type OutboxEvent = {
    id: string;
    /** @enum {string} */
    event: "product.published" | "product.updated" | "product.unpublished" | "brand_profile.published" | "vendor.status_changed" | "vendor.commission_changed";
    subject: string;
    vendor: VendorRef;
    status: OutboxStatus;
    tries: number;
    /** Format: date-time */
    created_at: string;
    /** Format: date-time */
    last_attempt_at: string | null;
    /** Format: date-time */
    next_attempt_at: string | null;
    last_error: string | null;
    payload: {
        [key: string]: unknown;
    };
};

export type OutboxPage = {
    items: OutboxEvent[];
    counts: {
        all: number;
        waiting: number;
        retrying: number;
        failed: number;
        delivered: number;
    };
};

/** @description Several of one vendor's waiting products to approve at once (1 to 50, each once), each with the version the reviewer saw. */
export type ApproveProductsBody = {
    products: {
        id: string;
        /** Format: date-time */
        submitted_at: string;
    }[];
};

/** @description Which products were approved, and which were not and why. */
export type ApproveProductsResult = {
    approved: {
        id: string;
        /** Format: date-time */
        at: string;
    }[];
    failed: {
        id: string;
        /** @description not_found: not one of this vendor's products; not_pending: already decided; changed: submitted again since the reviewer looked */
        code: "not_found" | "not_pending" | "changed";
        message: string;
    }[];
};
