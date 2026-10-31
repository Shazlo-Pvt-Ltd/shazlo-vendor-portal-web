# Repository test strategy and evidence

## Source inventory

Assessment started on 29 October 2026 in `shazlo/Shazlo_vendor_portal`.
Default branch: `main`, `7b234303cb4444464695d6ae9422ed09cd959eeb`.
Starting branch: `phase-0/29-ui-theme-tokens-2`,
`f5e385d3778f085f2086d0fb1f4e270552e60690`, with a clean working tree.
The test branch builds on that UI work; review its changes against that branch
while PR #44 remains open. No code from the other open implementation PRs was
copied into this branch.

`main` had one JavaScript scaffold test and two Python import tests. The starting
UI branch had 44 JavaScript tests (43 branch-only additions) plus those same two
Python tests. Its 44 JavaScript tests, lint and workspace types passed locally
before implementation. Existing files have been kept; new coverage is additive.

No applicable `AGENTS.md` was found in the checkout or its ancestor directories.
Environment templates, entry points, source imports and side effects, every
workflow, manifests, lockfiles, existing assertions, the roadmap, publishing
schemas and examples were inspected. Planned architecture is distinguished from
executable code below.

## Repository map

| Subsystem | Entry points | Important flow/invariant | Dependencies | Existing evidence | Uncertainty / limits |
|---|---|---|---|---|---|
| Shared UI | `packages/ui/src/index.ts`, `demo/main.tsx` | Theme merge, readable colors, safe CSS font URLs, semantic typography | MUI 9, React, Emotion | 40 starting unit/DOM tests; rendered CSS and demo assertions | jsdom does not prove layout, actual font availability or browser accessibility |
| New web applications | `apps/vendor-portal/src/version.ts`; README-only admin apps | Package imports | Shared UI | Four starting vendor-portal tests | No implemented login, vendor journey or iframe application on this revision |
| Legacy public site | `app/src/main.jsx`, `App.jsx`, `Home_v2.jsx`, `v2_components/` | Router, landing content, external links and Google Form embed | React 19.1, MUI 7, Vite, animations | No existing tests | Static presentations and old home variants have no independent domain rules; build covers import resolution, not layout |
| Waitlist and brand intake | `components/SceneWaitlistForm.jsx`, `components/partner.jsx`, `backend/routes/waitlist.js`, `routes/brand.js` | Required inputs, persisted identity, duplicate handling, pending brand status | Fetch, Express, MongoDB | None at baseline | False success on unsuccessful HTTP responses reproduced and fixed; backend still has limited validation |
| Pre-registration | `components/PreRegisterButton.jsx`, `services/api.js`, `routes/preRegister.js`, `models/PreRegister.js` | Validation, session interceptor, opt-ins and retry state | Axios, express-validator, rate limiter, Mongoose | None | Router is **not mounted**; model has neither `confirm()` nor `getStats()` used by the router; end-to-end registration/confirmation is unavailable |
| Catalog and moderation | `Seller.jsx`, `AdminPortal.jsx`, `components/Products.jsx`, `CatalogUpload.jsx`, `Add_Product_admin.jsx`, `ImagesUpload.jsx`; `backend/routes/upload.js`, `routes/admin.js` | Seller filtering, batch validation, pending/approved/rejected state, provider errors | Redux, XLSX, local HTTP API, MongoDB, Cloudinary | None | No authentication/ownership authorization; single-product/image UI uploads simulate persistence; bulk UI omits required seller ID |
| Recommendation feed | `ShadowUserLoader.jsx`, `swipePage.jsx`, `FeedQueue.js`, `api/*.js`, `utils/shadowUser.js` | Card ordering, late/empty batches, filter serialization, identity and vector persistence | External consumer API, localStorage | None | External API is outside this repo; overlapping filter loads and vector updates have no stale-response guard |
| Redux persistence | `state/index.js`, `main.jsx` | Logout clears session state; catalog/post updates do not mutate old state | Redux Toolkit, redux-persist | None | Persisted storage migration and external account providers are not implemented/testable here; Vercel token is not cleared by logout |
| Legacy CRM/onboarding | `CRMPanel.jsx`, `BrandOnboarding.jsx` | Notification payload and vendor signup | Hardcoded LAN API | None | Provider implementations absent; tests must not send notifications or use real accounts |
| New Python services | `identity_api/__init__.py`, `vendor_api/__init__.py` | Packages import | Python >=3.12 | One import test per service | No FastAPI routes, auth, SQL models, workers or migrations exist on this revision |
| Publishing contract | `docs/adr/0003-contract/{schemas,examples}`, `openapi.yaml` | Full-state events, integer money, HTTPS images, required fields, no contact/stock leak | JSON Schema 2020-12; future receiver | No executable checks | No producer/receiver/outbox implementation; cross-field equality/order is described, not enforced by schemas |
| Local infrastructure | `docker-compose.yml`, `docker/postgres/init/01-create-databases.sh` | Separate service/test DBs, required password, health check | Postgres 16, Docker | No executable integration coverage | Docker daemon unavailable locally; new service DB code does not yet exist |
| Tooling | Root and legacy manifests, ESLint/TS/Vite, three workflows | Correct source, lockfile installs, meaningful CI failure | Node, Python, GitHub Actions | apps/services workflows; footer workflow is unrelated | Reports are evidence for their source SHA/environment, not proof of branch enforcement |

Excluded from behavioral analysis: dependency trees, binary assets/APK/GLB/video,
fonts, generated PDF/SVG diagrams, diagram generation utilities, lockfile internals,
build output and mock/static catalog data. Presentation files were reviewed through
the route/import graph and side-effect scan; pixel/layout and exhaustive static
copy assertions are intentionally omitted. There are no unresolved runtime service
directories hidden behind the new-service README descriptions.

## Decisions

All selected checks run on every pull request (any base branch), and pushes to
`main`. The Python service checks remain separate from JavaScript checks.

| Behavior/risk | Code evidence | Existing coverage and limits | Decision | Assertion | Layer | Trigger | Cost/prerequisites |
|---|---|---|---|---|---|---|---|
| Theme/font/demo behavior | Public exports and actual MUI components | Existing units and DOM rendering already cover it | KEEP | Retain original assertions | Unit/DOM | PR/main | Root install |
| Wrong luminance math or malformed colors | `contrast.ts` piecewise arithmetic | Only black/white/equal references | EXTEND | Independent RGB reference values around transfer boundary, symmetry, invalid input | Unit | PR/main | Milliseconds |
| Lost recommendation batches | `FeedQueue.addBatch/swipe` | None | ADD | Five-card window, one-shot animation, queued transition, exhausted refill, empty results | Unit/regression | PR/main | Milliseconds |
| Wrong API identity/filters or lost preferences | `api/*.js` | None | ADD | Exact payloads, zero/open prices, missing/corrupt identity, failed HTTP/JSON/network leaves stored state intact | Unit; fetch mocked | PR/main | No external API |
| Session interceptor and encoded email | `services/api.js` | None | ADD | Real Axios pipeline attaches bearer, 401 removes it, other errors retain it, URL-encoded email and response unwrapping | Client test; transport adapter substituted | PR/main | No live API |
| Logout/catalog/post corruption | `state/index.js` | None | ADD | Clear supported session credentials, immutable old state, replace/append and matching post behavior | Reducer | PR/main | No storage provider |
| Filter dialog state | Three filter components | None | ADD | Case-insensitive search, selection/deselection, clear/apply/reopen, numeric/open/zero price bounds | Real component/DOM | PR/main | jsdom; real MUI 7 |
| Pre-register input/submission state | `PreRegisterButton.jsx` | None; server route absent | ADD | Reject bad inputs, submit exact preferences, pending button disabled, error preserves input, retry succeeds | Real component/DOM; API mocked | PR/main | Does not prove server registration |
| Live intake false confirmation | `SceneWaitlistForm.jsx`, `partner.jsx` | None; success ignored HTTP status | ADD | Exact form payloads; pending/completed buttons prevent repeats; unsuccessful HTTP and network error show an alert, preserve fields and allow retry | Real component/DOM/regression; transport mocked | PR/main | No live submissions |
| Waitlist/brand writes and duplicates | Production router/controller/model stack | None | ADD | Required input creates no writes; normalized fields persist; duplicate does not overwrite; unique index resolves concurrent writes | Real HTTP + MongoDB | PR/main | Disposable MongoDB 7.0.24 binary downloaded once |
| Catalog batch and review integrity | Production upload/admin routes | None | ADD | Required fields, validation prevents partial batch, seller filter, persisted approval/rejection, missing IDs, new uploads cannot self-approve | Real HTTP + MongoDB/regression | PR/main | Same isolated DB; not an authorization test |
| Multipart/provider failure | Multer and Cloudinary upload stream | None | ADD | Real multipart bytes parsed, URL order retained, missing input avoids provider, provider failure returns error | HTTP/Multer; only Cloudinary mocked | PR/main | No credentials/network |
| Model validation | Product and pre-registration schemas | None | ADD | Required fields, name boundaries, enums, normalization, zero stock | Real Mongoose validation | PR/main | No server needed |
| Contract drift/privacy | Five schemas and examples, documented HMAC vector | None | ADD | Every example validates; malformed envelope rejected; no private/stock fields; money, image and return boundaries; documented signature reproduces | Schema/executable documentation | PR/main | Ajv 2020 + formats, Node crypto; no receiver claim |
| Broken shipped imports | Legacy Vite entry point and transitive imports | No build in CI | ADD | Production build completes using the legacy lockfile | Build | PR/main | Legacy dependencies installed separately |
| New service behavior | Both packages contain only `__version__` | Existing import smokes are appropriate | KEEP | Existing pytest/lint/format/types | Python | PR/main | Python 3.12 in CI |
| Auth/isolation, outbox, JWT, migrations | Planned phases only; legacy routes public | Cannot prove unavailable functionality | DEFER | Add denial/no-write, transaction/replay/recovery tests with actual implementation | Future integration | Future PRs | Identity/vendor API implementation |
| Full vendor/admin browser journey | Apps are placeholders; legacy UI and API disagree | Mocking it would conceal missing implementation | DEFER | Real signup → submit → approve/reject → receiver when implemented | Future browser/system | Future PRs | Working applications and stub receiver |
| Browser layout/accessibility, visual/performance/load/mutation/fuzz | Predominantly animated presentation; no measured budget or baseline | DOM assertions do not establish these | DEFER | Bounded journeys/accessibility/layout on supported browsers once targets are defined | Browser/dedicated | Future | Separate bounded workload and baselines |
| Docker/Postgres bootstrap | Init script + service placeholders | Local Docker daemon unavailable | DEFER | Fresh-volume databases + negative configuration test | Real local integration | Future | Running Docker; no production target |
| Live providers/notification/signup | Hardcoded external/LAN endpoints | No owned implementation or test accounts | SKIP live calls | Local payload assertions only where implemented | Future provider sandbox | Manual | Approved sandbox; never send real notifications |
| Firmware/mobile APK/package registry | No firmware/mobile source or publishing pipeline here | Binary APK is an asset, not source | SKIP | No speculative framework added | — | — | — |

## Running the checks

From the repository root, with Node 20+:

```sh
npm ci
npm ci --prefix app
npm ci --prefix backend
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build --prefix app
```

`npm test` selects all five Vitest projects. The legacy folders intentionally keep
their separate lockfiles and are not converted into npm workspaces. App tests use
the app's React runtime, avoiding duplicate React hooks with the newer UI package.
Examples of focused runs:

```sh
npm test -- --project legacy-app app/test/feed-queue.test.js
npm test -- --project legacy-backend
npm test -- --project contracts
npm test --prefix app
npm test --prefix backend
```

The backend suite starts `backend/app.js`, the same Express application used by
`server.js`, on an ephemeral loopback port, then connects Mongoose exclusively to
a newly owned MongoDB process. It does not consume `DATABASE_URL`/`MONGODB_URI` or
reuse developer/production databases. It clears only its own test collections,
closes the HTTP listener, disconnects Mongoose and stops the process. Test cases
are sequential within this boundary. Cloudinary is substituted; neither provider
delivery nor provider credentials are validated. The first run needs network
access to download MongoDB; subsequent runs use the binary cache. A download or
boot failure fails the suite instead of silently skipping integration tests.

Test-only tooling uses Vitest 4.1.12 and Testing Library already present in the UI
workspace. The coverage provider is pinned to the installed Vitest version.
Legacy app tests declare Testing Library locally so its native React DOM imports
use the same React 19.1 as the app. `mongodb-memory-server-core` 10.4.3 (MIT,
Node >=16.20.1) supplies a real local database without an install hook; MongoDB is
pinned to 7.0.24. Ajv 8.20.0 and ajv-formats 3.0.1 (MIT) validate the repository's
2020-12 schemas and formats. Upstream repositories/tags, engine requirements and
licenses were checked. References: [MongoDB server harness](https://github.com/typegoose/mongodb-memory-server/tree/v10.4.3),
[harness setup](https://typegoose.github.io/mongodb-memory-server/docs/guides/quick-start-guide/),
[Ajv](https://github.com/ajv-validator/ajv/tree/v8.20.0),
[2020-12 support](https://ajv.js.org/json-schema.html#draft-2020-12-breaking),
[Vitest](https://github.com/vitest-dev/vitest/tree/v4.1.12).

Coverage includes **unimported runtime source**, including legacy screens and
server startup, so a low aggregate number remains visible. No arbitrary coverage
threshold or 100% target is imposed. Assertions, not line counts, determine the
risk evidence. JUnit/HTML/JSON coverage and source/environment metadata are kept
for 14 days by CI; all original exit codes propagate.

Inside each Python service, use an isolated Python >=3.12 environment:

```sh
pip install -e '.[dev]'
ruff check .
ruff format --check .
mypy
pytest --junitxml=reports/pytest.xml
```

## GitHub evidence and enforcement

At assessment time, the starting UI commit had a successful `apps-ci` run
[`40135685761`](https://github.com/shazlo/Shazlo_vendor_portal/actions/runs/40135685761).
A previous services revision had a successful run
[`40184283678`](https://github.com/shazlo/Shazlo_vendor_portal/actions/runs/40184283678).
The most recent service run on an **unrelated open implementation PR** failed
[`40736313290`](https://github.com/shazlo/Shazlo_vendor_portal/actions/runs/40736313290);
that result is not evidence about this branch's scaffold packages. Recent `main`
runs were mostly the footer workflow because the original test workflows used
path filters.

The active `review_CI/CD` ruleset was read: it requires one PR approval and
code scanning/quality rules, but does not list the apps/services checks as required
status checks. The legacy branch-protection endpoint returned 404, so any additional
classic protection is unknown. This change does not alter repository settings.
The new stable checks should be considered for required status enforcement after
their PR runs are verified. `merge_group` is omitted because no merge queue rule
was present. Both workflows check out the immutable event SHA (the PR merge
revision for `pull_request`), run on every base branch without path filtering,
use read-only contents permissions and verified action pins. The footer mutation
workflow is unrelated to testing and remains unchanged.

## Remaining product limitations

The suite is not evidence of secure admin authentication, seller authorization,
successful cross-repository signup, a working pre-register confirmation flow,
email delivery, real Cloudinary delivery or a complete vendor/admin browser journey.
Known gaps above are explicit deferrals, not skipped or expected-failure tests.
In particular, the schemas do not enforce `max_paise >= min_paise`,
`mrp_paise >= price_paise`, aggregate/payload ID equality or ordered unique image
positions. Those require executable producer/receiver validation in the later phase.

## Reproduced defects addressed with the tests

Before changing production behavior, the new queue tests failed for exhausted
queue refills (`[]` instead of the late batch) and empty batches (spurious animation
and blocked advancement). `addBatch` now ignores empty results and starts a new
active batch when the prior queue is exhausted.

The real HTTP/MongoDB test also reproduced catalog self-approval: an uploaded
product with `status: "approved"` and reviewer fields was persisted as approved.
The upload route now forces `pending` and removes caller-supplied decision fields.
This closes that input path only; the legacy admin endpoints remain public.

`backend/app.js` separates the existing HTTP composition from `server.js` database
startup and signal handlers. Routes, response shapes and startup commands are
preserved, and the integration suite imports the actual production composition.
The pre-registration component uses direct imports for its two icons, avoiding
evaluation of the entire icons package during component tests.

The intake form regressions reproduced missing error recovery and false success
on HTTP failures. Both forms now require a successful HTTP response before
showing confirmation, expose a retryable error and retain the user's input.
The waitlist completes when the response arrives instead of using a detached
1.5-second success timer that could report success after failure or unmount.

## Initial verification (before follow-up security review)

Local environment: Windows, Node 24.19.0, npm 12.0.2, Vitest 3.2.7, MongoDB
7.0.24. Python checks used an isolated Python 3.13.15 environment; CI retains
Python 3.12 and Node 20 on Ubuntu to verify the repository's existing targets.

| Check | Observed result |
|---|---|
| `npm run test:ci` | **PASS**: 296 tests in 18 files, no failed/skipped tests; 150.82 seconds including coverage |
| `npm run lint`, `npm run typecheck`, `git diff --check` | **PASS** |
| `npm run build --prefix app` | **PASS**: 83 seconds; existing duplicate CSS-object keys and large-bundle warnings remain |
| Existing vs new JS assertions | 44 existing tests retained, 252 new tests; 52 UI, 4 vendor-portal, 63 legacy app, 56 backend, 121 contracts |
| Python: `ruff check .`, `ruff format --check .`, `mypy`, `pytest --junitxml=reports/pytest.xml` in each service | **PASS**: all four checks per service, one existing pytest case per service; no new placeholder assertions added |
| Workflow YAML and triggers | **PASS**: both workflows parse; every PR and `main` pushes selected |
| Docker/Postgres bootstrap | **BLOCKED** locally: Docker CLI exists but its daemon is unavailable; no database/bootstrap coverage claimed |
| Full browser/system, live providers, auth/outbox/migrations | **NOT RUN**, with reasons and prerequisites in the decision table |

The final coverage report includes every first-party JavaScript/TypeScript runtime
file, including unimported screens: 13.47% lines and 72.25% branches overall.
The feed queue, three recommendation API modules, Axios client and shared UI
runtime report 100% lines and branches for the selected assertions. Large static
presentations, unfinished legacy flows and startup code remain visible at zero;
these percentages do not imply full application or security coverage.

Earlier development runs are not counted as passes: a cold Windows MongoDB
download exceeded the initial 120-second setup allowance, and concurrent package
extraction/build work caused two DOM tests (including an existing demo test) to
exceed their five-second timeout. The final runner uses one worker and a separate
build step, keeps the original DOM test timeout and assertions, and gives cold
database setup a bounded ten-minute allowance. There are no configured test
retries or expected-failure/skip markers. Product regressions above were observed
failing before their corresponding fixes.

## Follow-up safety review

The second review found and corrected a working-directory bug: inline Vitest
project roots were relative to the caller's directory. A root invocation worked,
but invocation from `app/` or `backend/` could discover no tests. Roots are now
absolute, and subprocess regressions verify discovery from both directories.
A separate smoke test boots the actual `backend/server.js` entry point using an
owned MongoDB database and ephemeral port, checks health, and terminates the child.
Cloudinary now has a fail-closed default stub in every integration test; forgetting
a provider stub cannot use developer credentials.

The dependency review upgraded Ajv to 8.20.0 and the existing Vitest runner plus
matching coverage provider to 4.1.12. The latter remains compatible with CI's Node
20 target and removes the vulnerable Tinypool dependency. This is a security
upgrade, not an application dependency migration. See the
[Ajv advisory](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6),
[Vitest advisory](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), and
[Tinypool advisory](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3).
The new root `npm audit --audit-level=moderate` CI step covers test/workspace
dependencies. Checkout credentials are not persisted in either test workflow.

Audit snapshot on 29 October 2026: the updated root lockfile has **zero reported
vulnerabilities**. The unchanged legacy app lockfile reports 26 vulnerable package
entries (18 high, 6 moderate, 2 low); the backend reports 14 (1 critical, 11 high,
2 moderate). Each flagged installed version was compared with the starting UI
branch's lockfiles and is unchanged by this PR. Examples include SheetJS, Axios,
Express middleware and Multer. Counts are package entries, not independent
exploits, and do not establish exploitability in every execution mode.

These production dependencies and the public legacy admin endpoints prevent a
claim that the whole application is production-safe. Replacing the spreadsheet
parser and implementing authentication/authorization require application changes
and acceptance coverage beyond this test PR. Live providers and a complete browser
journey remain unverified as described in the decision table. No live accounts,
notification service, configured developer database or production data were used.

Follow-up local verification: **299 tests in 19 files pass** with Vitest 4.1.12,
including the three new entrypoint/boot regressions; no skips, retries or failures.
Both Python service suites, lint, types and workflow YAML validation pass again.
Vitest 4's AST-based coverage reports 26.60% lines / 18.63% branches across all
included runtime sources. Its executable-statement mapping differs from Vitest 3;
these numbers must not be compared directly with the initial report above.
Unimported application, startup and catalog files were explicitly checked to remain
in the report. The root audit reports zero vulnerabilities; the legacy audit
findings above remain unresolved and are not concealed by the root CI audit gate.


## Penpot design alignment follow-up

The shared theme's original black/gold and Voyage/Inter defaults did not match
Penpot's Design language board when inspected on 29 October 2026. The captured
[source identity, palette, font roles and limits](../packages/ui/docs/penpot-design.md)
now distinguish external design facts from supporting tints and retained numeric
sizes. UI and consumer tests exercise the updated theme; the separate legacy
website theme and scaffold application scope are unchanged.

The final focused run passes **65 tests in nine files** (61 UI and four consumer tests).
Nine additional assertions bring the repository's selected JavaScript total to
308 in 20 files. Lint, workspace types, both Python services' ruff lint/format,
strict mypy and two existing pytest cases pass locally. The root dependency audit
still reports zero vulnerabilities. The production demo build passes with the
three local Fontsource families and their licenses; a build-artifact check also
verifies emitted family names, weights, local font asset paths and license files.
This check catches a stylesheet that imports successfully but declares a different
font-family name than the theme requests.

An attempted full local coverage run passed 305/307 tests and encountered two
five-second timeouts in unchanged legacy pre-registration component tests during
machine contention (712 seconds overall). A focused rerun passes all seven legacy
pre-registration tests. A subsequent UI attempt also timed out in two repeated
demo renders and exposed an error-field outline override; the override is fixed
and covered by a new assertion. The read-only demo fixture now renders once per
file, retaining all assertions. The final 65-test focused run passes without skips.
These attempts are not reported as a full-suite pass; final PR CI must verify the
combined revision on Ubuntu/Node 20. No timeouts were increased and no test retries
or skips added. The legacy production build passes with its existing warnings.

The obsolete screenshot was removed. Chrome extension DOM inspection confirms
the rendered Ovo body, Bodoni Moda heading, canvas background and no horizontal
overflow at the current viewport. Screenshot and font-resource inspection have
intermittently failed, so actual font loading, wider responsive coverage and visual
acceptance are not claimed. Native desktop control is no longer used; subsequent
browser checks use only the Chrome extension, as requested by the user.

The new CodeQL workflow scans JavaScript/TypeScript and Python on every PR (any
base), main pushes and manual dispatch, with pinned actions, bounded jobs, no
persisted checkout credentials and security-events write permission restricted
to the analysis job. No repository protections or required reviews are changed.
CodeQL results must be read from the PR before describing it as merge-ready;
adding a workflow alone does not establish a successful analysis or no alerts.

## Font URL security follow-up (30 October 2026)

After #63 was merged, #44's CodeQL gate detected
[`js/polynomial-redos`, alert 1](https://github.com/shazlo/Shazlo_vendor_portal/security/code-scanning/1)
at `packages/ui/src/fonts.ts:24`. The application tests and builds passed; this
was a real security finding, not a failed unit test. The earlier #63 analysis
used its PR diff (27 files); #44's diff against main covered 64 files, including
the font loader. A passing stacked-PR scan does not establish that its parent
PR's wider security scan is clear.

The trailing-slash regular expression retried from every slash when a long run
ended with a non-slash character. A bounded local reproduction of the actual
exported function took 23.91/62.95/425.69 ms for 4k/8k/16k slash-heavy inputs.
The replacement scans the suffix once with an index and slices once, avoiding
backtracking and repeated substring copies. URL validation and generated CSS
remain unchanged. This is a public library-input risk; exposure to external
requests depends on the consuming application.

Seven additional cases protect root paths, CDN paths, internal slashes, a 100k
trailing slash run and a 100k near-match slash run. Expected CSS URLs are asserted
directly; no machine-speed threshold or timeout relaxation is introduced. The
existing CodeQL gate checks the computational-safety issue. The new function
handled the same 16k input in 0.06 ms and 100k in 0.42 ms locally; these are
illustrative observations, not portable timing guarantees. See the
[official query explanation](https://codeql.github.com/codeql-query-help/javascript/js-polynomial-redos/).

Local affected verification passes: **72 UI/consumer tests**, lint, workspace
types, demo production build and artifact verification. The selected repository
suite now has **315 JavaScript tests in 20 files**, plus the two existing Python
cases. Full CI/security evidence must be tied to the new revision; the open
alert on #44 cannot be considered resolved until the fix lands there and its
own security check passes. No scan is suppressed and no protection is weakened.
