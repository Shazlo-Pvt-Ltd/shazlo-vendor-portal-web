# Architecture Decision Records

One file per decision, named `NNNN-short-title.md`. Copy [0000-template.md](0000-template.md).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-iframe-postmessage-protocol.md) | Iframe postMessage protocol between Shazlo-One and module UIs | proposed |
| [0003](0003-central-app-publishing-contract.md) | Central-app publishing contract | proposed |
| [0009](0009-auth-model.md) | Auth model: RS256 JWTs, JWKS and roles | accepted |
| [0010](0010-shared-security-package.md) | Share the security plumbing between identity-api and vendor-api; copy the glue | proposed |

Numbers 0001 and 0003 are used twice (the Phase 0 ADRs and the earlier architecture ADRs). That clash is known and left for a separate cleanup. Until then, cite an ADR by its file name (for example [0009-auth-model.md](0009-auth-model.md)), not by its number alone.
