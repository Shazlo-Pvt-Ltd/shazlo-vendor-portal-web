# Architecture Decision Records

One file per decision, named `NNNN-short-title.md`. Copy [0000-template.md](0000-template.md).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-iframe-postmessage-protocol.md) | Iframe postMessage protocol between Shazlo-One and module UIs | proposed |
| [0003](0003-central-app-publishing-contract.md) | Central-app publishing contract | proposed |
| [0009](0009-auth-model.md) | Auth model: RS256 JWTs, JWKS and roles | accepted |
| [0010](0010-shared-security-package.md) | Share the security plumbing between identity-api and vendor-api; copy the glue | proposed |
| [0011](0011-vendor-portal-and-vendors-module-as-microservices.md) | The Vendor Portal and Shazlo One's Vendors module as two microservices over one vendor database | proposed |

Status of the two `proposed` decisions that are already built: ADR 0003 waits for the central-app team to confirm its answers (issue #179; vendor-api and `central-stub` implement it), and ADR 0010 is implemented in `packages/py-security` but has not been marked accepted. ADR 0001 (iframe protocol) belongs to Phases 6 and 7, which have not started.

The earlier architecture ADRs (written 2026-10-19 and 2026-10-20, in the format of the design documents; see the [design docs index](../README.md)):

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith with service and selector layers | accepted, amended by 0007 |
| [0002](0002-api-style.md) | API style: GraphQL for the app, REST for the rest | proposed |
| [0003](0003-pgvector-over-pinecone.md) | pgvector in Postgres instead of Pinecone | accepted |
| [0004](0004-authentication.md) | Own JWT authentication with guest accounts | accepted as the target; partly superseded by 0009 |
| [0005](0005-images-and-cdn.md) | Images and CDN | accepted for the MVP |
| [0006](0006-manual-order-flow-before-online-payments.md) | Order requests with manual settlement before online payments | accepted for the MVP, amended |
| [0007](0007-core-and-vendor-admin-services.md) | Two services: Core (Django) and Vendor-admin (FastAPI) | accepted (direction), amended by 0008 |
| [0008](0008-commerce-in-core.md) | Commerce lives in Core; the vendor-admin service is the seller back-office | accepted |

Numbers 0001 and 0003 are used twice (the Phase 0 ADRs and the earlier architecture ADRs). That clash is known and left for a separate cleanup. Until then, cite an ADR by its file name (for example [0009-auth-model.md](0009-auth-model.md)), not by its number alone.
