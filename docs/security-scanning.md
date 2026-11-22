# Security scanning

What scans this repository in GitHub Actions, when, where the results appear, and what to do with a
finding. Every action is pinned to the full commit SHA of a released tag, and every downloaded
binary is checked against the SHA-256 published with its release. Every job declares its own
`permissions`, and none needs a secret or depends on Dependabot alerts or GitHub secret scanning
being enabled. `dependency-review` does need the repository's **Dependency graph** (Settings > Code
security): without it, that job fails on every pull request with "Dependency review is not
supported on this repository".

**Pull requests from forks** run these workflows too, but GitHub gives them a read-only token, so
nothing can be uploaded to code scanning from them. `osv-scanner` and `zizmor` notice this and put
their findings in the run (summary and log) instead. CodeQL's required `Analyze` checks also need
`security-events: write` to upload, and GitHub's documentation does not say how that behaves for a
fork. If they fail on an outside contributor's pull request, a maintainer can push the branch to this
repository and open the pull request from there.

## What runs

| Workflow (job) | Tool | Runs on | Fails the run when | Results |
|---|---|---|---|---|
| `codeql.yml` (`Analyze (actions)`, `Analyze (javascript-typescript)`, `Analyze (python)`) | CodeQL, `security-extended` queries | every PR, push to `main`, Mondays 03:30 UTC | never by itself; the `review_CI/CD` ruleset blocks merging a PR that adds a medium-or-higher CodeQL alert | Security > Code scanning, PR annotations |
| `dependency-review.yml` | GitHub dependency review | every PR | the PR adds a dependency with a high or critical vulnerability (any scope), or a runtime dependency under GPL or AGPL | job log and run summary |
| `osv-scanner.yml` | OSV-Scanner | every PR, push to `main`, Mondays 04:00 UTC | the scan cannot run (findings are reported, not failed) | Security > Code scanning (tool `osv-scanner`), run summary |
| `pip-audit.yml` (`pip-audit (<project>)`) | pip-audit | every PR, push to `main`, Mondays 04:15 UTC | a PR that changes a Python `pyproject.toml` or `requirements*.txt` leaves a known vulnerability; otherwise it reports only | job log and run summary |
| `secret-scan.yml` (`gitleaks`) | gitleaks | every PR (its commits), push to `main` (the pushed commits), Mondays 04:30 UTC (all history, all branches) | the allowlist test fails, or a secret is found that `.gitleaks.toml` does not allow | job log (values redacted) |
| `workflow-lint.yml` (`zizmor`) | zizmor | PRs and `main` pushes that change `.github/workflows/`, `.github/scripts/` or `dependabot.yml`, Mondays 05:00 UTC | never (reporting) | Security > Code scanning (tool `zizmor`) |
| `workflow-lint.yml` (`actionlint`) | actionlint and shellcheck | same as zizmor | any error in a workflow or in a script in `.github/scripts/` | job log |
| `scorecard.yml` | OpenSSF Scorecard | Mondays 04:45 UTC on `main`, manual | never (reporting); results are not published to the Scorecard API | Security > Code scanning (tool `Scorecard`) |
| `apps-ci.yml` (`audit`) | `npm audit` | PRs that change an npm manifest or lockfile | a moderate or higher advisory | job log |

Python code is also linted by ruff's `S` rules (flake8-bandit) in `services-ci`, configured in
`services/ruff.toml`, so Bandit is not run separately. Dependabot (`.github/dependabot.yml`) proposes
updates for npm, pip, GitHub Actions, the services' Dockerfiles and `docker-compose.yml`, each after
a 7-day cooldown.

What each one covers:

- **CodeQL** reads the TypeScript/JavaScript and Python source and the workflow files. The
  `security-extended` suite adds lower-precision security queries to the default ones (for example
  log injection, partial server-side request forgery, and code injection in workflows).
- **dependency-review** compares the dependency graph of the PR's base and head, so only what the
  PR adds can fail it. A dependency that is already on `main` never does.
- **OSV-Scanner** reads `package-lock.json`, `app/package-lock.json` and `backend/package-lock.json`.
  The Python projects have version ranges in `pyproject.toml` and no lockfile, so the workflow first
  resolves each project's runtime dependencies with `pip install --dry-run` (what its image
  installs) into a `requirements-resolved.txt` next to its `pyproject.toml`. That file exists only in
  the CI checkout; an alert pointing at it names the project.
- **pip-audit** installs each project the way `services-ci` does (runtime and dev dependencies, the
  shared packages from their paths, and for vendor-api the stub receiver its end-to-end test uses)
  and audits that environment. The repository's own packages are skipped.
- **gitleaks** uses its default rules plus one for connection strings with an inline password
  (`mongodb://`, `postgresql://`, `redis://`, ...). Before scanning, the job runs
  `.github/scripts/check-gitleaks-allowlist.sh`, which checks that each allowlisted test value is
  allowed only in its own file, that another password or secret in those files is still reported,
  and that local-looking hosts (`localhost`, `postgres`, `*.example`, ...) get no free pass.
- **zizmor** looks for template injection, excessive permissions, unpinned actions, persisted
  credentials, risky triggers and similar workflow problems; **actionlint** for mistakes.

Downloaded tools (OSV-Scanner, gitleaks, actionlint) are pinned by version and SHA-256 in the
workflow's `env`; Dependabot does not update them, so bump the version and the checksum together
from the release's checksums file.

## Triage

**CodeQL alert on a PR.** Fix the code. If the alert is a false positive, dismiss it in the alert
with the reason ("False positive" or "Used in tests") and a comment saying why; the dismissal is
recorded and the ruleset then lets the PR merge. Do not disable a query for the whole repository
to get one PR through.

**dependency-review failure.** Pick a version without the vulnerability (the summary shows the
first patched version). If none exists and the risk is accepted, add the advisory to
`allow-ghsas` in `dependency-review.yml` with a comment saying why and until when. For a licence
failure, choose another package; an exception for one package goes in
`allow-dependencies-licenses` (as a purl) with a comment saying why.

**OSV-Scanner or pip-audit finding.** Update the package (for npm, `npm update <pkg>` or a
Dependabot PR; for Python, raise the lower bound in `pyproject.toml`). For an advisory that does not
apply, an `osv-scanner.toml` next to the lockfile can ignore one vulnerability ID with a reason and
an expiry date (`[[IgnoredVulns]]`, `id`, `ignoreUntil`, `reason`); dismiss the code scanning alert
with the same reason. pip-audit takes `--ignore-vuln <id>` in `pip-audit.yml`, also with a comment.

**gitleaks finding.** Treat it as real until shown otherwise:

1. If it is a real credential, revoke or rotate it at the provider **first**: once pushed, it is
   public in this repository's history, and removing the file does not change that.
2. Then remove it from the code (read it from the environment instead), and if needed rewrite
   history, which is a separate decision for the repository owners.
3. A finding that remains in history after the credential is rotated can be silenced by adding its
   fingerprint (printed by `gitleaks git --report-path` as `Fingerprint`, `<commit>:<file>:<rule>:<line>`)
   to a `.gitleaksignore` file at the repository root, with a comment naming the rotation. The file
   does not exist yet: the first such finding creates it.
4. Only a value that is deliberately committed test or demo data goes in `.gitleaks.toml`, with
   `condition = "AND"`, the exact file path and the exact value (see the entries there). Never
   allowlist a whole file, directory or rule.
   - A value that one of the default rules reports goes in a global `[[allowlists]]` entry **with
     `targetRules`** naming that rule (the finding's `RuleID`). Without `targetRules`, gitleaks skips
     the entry's paths entirely for every rule, whatever its `condition`, so any other secret in
     those files would go unreported.
   - A connection string goes under the `connection-uri-with-password` rule's own
     `[[rules.allowlists]]`, matching the whole URI up to the host (`regexTarget = "match"`).
   - Add an `allow` case and a `report` case for it to `.github/scripts/check-gitleaks-allowlist.sh`,
     and run that script locally: `bash .github/scripts/check-gitleaks-allowlist.sh path/to/gitleaks`.

Run it locally the same way CI does (with the released binary, checksum checked):

```bash
gitleaks git . --config .gitleaks.toml --redact --log-opts="origin/main..HEAD"   # your branch
gitleaks git . --config .gitleaks.toml --redact --log-opts="--all"               # everything
```

**zizmor or Scorecard alert.** Fix the workflow (zizmor's audit documentation explains each
finding and usually the fix). If a finding is intended, add an inline
`# zizmor: ignore[<audit>]` comment on that line with the reason. Scorecard checks that need a
repository setting (branch protection, code review) are fixed in Settings, not in code.

## Repository settings

`dependency-review` needs one of them:

- **Dependency graph**: the dependency review API it calls compares the graphs of the PR's base
  and head, and answers only when the graph is enabled.

The other workflows deliberately do not depend on these settings, but enabling them in Settings >
Code security adds coverage the workflows cannot give:

- **Dependabot alerts** and **Dependabot security updates**: alerts for vulnerable dependencies on
  `main` as advisories are published, and fix PRs that skip the cooldown.
- **Secret scanning** and **push protection**: GitHub's provider-verified patterns, and blocking a
  push that contains a secret before it reaches the repository (gitleaks can only report afterwards).
- **Private vulnerability reporting**, so a reporter has a private channel.
