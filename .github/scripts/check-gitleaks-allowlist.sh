#!/usr/bin/env bash
# Regression test for the allowlists in .gitleaks.toml: each committed test or demo value stays
# allowed only in its own file, a password for any other value, host or file is still reported,
# and no allowlisted file hides a different secret. Every case is written to an empty directory and
# scanned with `gitleaks dir`.
#
# Usage, from the repository root: .github/scripts/check-gitleaks-allowlist.sh [gitleaks binary]
# CI runs it in secret-scan.yml before the scan.
set -euo pipefail

gitleaks=${1:-gitleaks}
config="$PWD/.gitleaks.toml"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Test values are joined from two halves at run time (and URI schemes come from variables), so this
# file holds no secret for the repository's own scan to find.
j() { printf '%s%s' "$1" "$2"; }
pg=postgresql
mg=mongodb
rd=redis
mq=amqp
# A GitHub token shape, which gitleaks' github-pat rule reports.
gh_token=$(j ghp_Zx8vQ2mN7pL4kR9t W3yB6cD1fG5hJ0aSdQwE)

cases=0
failures=0

# check allow <path> <line>          no rule at all may report <line> in <path>
# check report <rule> <path> <line>  <rule> must report it
check() {
  local expect=$1 rule="" path line dir status
  local rules=()
  if [ "$expect" = report ]; then
    rule=$2
    shift
    rules=(--enable-rule "$rule")
  fi
  path=$2
  line=$3
  cases=$((cases + 1))
  dir="$work/$cases"
  mkdir -p "$dir/$(dirname "$path")"
  printf '%s\n' "$line" > "$dir/$path"
  set +e
  (cd "$dir" && "$gitleaks" dir . --config "$config" "${rules[@]}" --no-banner --log-level error --exit-code 3 > /dev/null 2>&1)
  status=$?
  set -e
  case "$expect:$status" in
    allow:0 | report:3) echo "ok    $expect ${rule:+($rule) }$path" ;;
    allow:3 | report:0)
      echo "FAIL  expected $expect${rule:+ by $rule}: $path: $line" >&2
      failures=$((failures + 1))
      ;;
    *)
      echo "ERROR gitleaks exited with $status on $path" >&2
      exit 2
      ;;
  esac
}

uri="connection-uri-with-password"
generic="generic-api-key"

# --- Connection strings ---------------------------------------------------------------------------
# The committed values, in their own files: allowed.
check allow .github/workflows/services-ci.yml "      DATABASE_URL: ${pg}://shazlo:shazlo@localhost:5432/test"
check allow services/identity-api/.env.example "DATABASE_URL=${pg}+asyncpg://shazlo:change-me@localhost:5432/identity"
check allow services/vendor-api/.env.example "DATABASE_URL=${pg}+asyncpg://shazlo:change-me@localhost:5432/vendor"
check allow services/vendor-api/tests/test_settings.py "            database_url=\"${pg}://shazlo:DbPassw0rd@db.internal/vendor\","
check allow backend/README.md "MONGODB_URI=${mg}+srv://admin:YOUR_PASSWORD@cluster0.example.mongodb.net/shazlo"

# The same values in any other file: reported.
check report $uri app/src/config.js "const url = \"${pg}://shazlo:shazlo@localhost:5432/test\""
check report $uri services/vendor-api/vendor_api/settings.py "DEFAULT = \"${pg}+asyncpg://shazlo:change-me@localhost:5432/vendor\""
check report $uri services/vendor-api/vendor_api/settings.py "DEFAULT = \"${pg}://shazlo:DbPassw0rd@db.internal/vendor\""
check report $uri docs/setup.md "MONGODB_URI=${mg}+srv://admin:YOUR_PASSWORD@cluster0.example.mongodb.net/shazlo"

# Another password in those files, even for the same host: reported.
check report $uri .github/workflows/services-ci.yml "      DATABASE_URL: ${pg}://shazlo:Real-Value-7731@localhost:5432/test"
check report $uri services/vendor-api/.env.example "DATABASE_URL=${pg}+asyncpg://shazlo:Real-Value-7731@localhost:5432/vendor"
check report $uri services/vendor-api/tests/test_settings.py "            database_url=\"${pg}://shazlo:Real-Value-7731@db.internal/vendor\","

# Hosts that look local or reserved, in any file: reported (a real password can point at them too).
check report $uri backend/.env "MONGODB_URI=${mg}://admin:Real-Value-7731@localhost:27017/shazlo"
check report $uri backend/.env "MONGODB_URI=${mg}://admin:Real-Value-7731@127.0.0.1:27017/shazlo"
check report $uri docker-compose.yml "      DATABASE_URL: ${pg}://shazlo:Real-Value-7731@postgres:5432/vendor"
check report $uri services/vendor-api/vendor_api/queue.py "URL = \"${rd}://worker:Real-Value-7731@redis:6379/1\""
check report $uri services/vendor-api/vendor_api/queue.py "URL = \"${mq}://worker:Real-Value-7731@h/vhost\""
check report $uri app/src/db.ts "export const url = '${mg}://admin:Real-Value-7731@db.example/shop'"

# --- Values generic-api-key reports -----------------------------------------------------------------
# Each committed value, in its own file: allowed.
check allow apps/vendor-portal/src/api/uploads/testing.ts "export const API_KEY = '$(j key-1234567 89012345)'"
check allow services/vendor-api/tests/test_e2e_publishing.py "SECRET = \"$(j e2e-publishing-secret- 0123456789-abcdef)\""
check allow services/vendor-api/tests/test_publisher.py "    password = \"$(j Sup3rSecret Passw0rd)\""
check allow services/vendor-api/tests/test_settings.py "    secret = \"$(j Hunter2-central- secret-0123456789abcdef)\""
check allow services/vendor-api/tests/test_email_senders.py "TOKEN = \"$(j tok_Secret -9f8e7d)\"  # noqa: S105"
check allow services/vendor-api/tests/test_email_templates.py "TOKEN = \"$(j tok_AbC -123_xyz)\"  # noqa: S105"
check allow docs/adr/0003-contract/README.md "Idempotency-Key: $(j d2c8a7b1-3e5f- 4092-8b4c-6f9e1d8b2c35)"
check allow apps/shazlo-one/src/mocks/identity.ts "export const DEMO_ADMIN = { email: 'naman@shazlo.store', password: '$(j shazlo-one- 2026)' }"
check allow apps/vendor-admin/e2e/support.ts "  password: '$(j shazlo-one- 2026)',"
check allow apps/vendor-portal/src/mocks/db.ts "export const DEMO_LOGIN = { email: 'kiran@kalkistudio.in', password: '$(j ajrakh- indigo-26)' }"
check allow apps/vendor-portal/src/screens/auth/SignIn.test.tsx "const password = '$(j ajrakh- indigo-26)'"

# The same values in another file: reported.
check report $generic apps/vendor-portal/src/api/uploads/upload.ts "export const API_KEY = '$(j key-1234567 89012345)'"
check report $generic services/vendor-api/vendor_api/publisher.py "SECRET = \"$(j e2e-publishing-secret- 0123456789-abcdef)\""
check report $generic services/vendor-api/vendor_api/settings.py "    password = \"$(j Sup3rSecret Passw0rd)\""
check report $generic services/vendor-api/vendor_api/settings.py "    secret = \"$(j Hunter2-central- secret-0123456789abcdef)\""
check report $generic services/vendor-api/vendor_api/email.py "TOKEN = \"$(j tok_Secret -9f8e7d)\""
check report $generic services/vendor-api/vendor_api/email.py "TOKEN = \"$(j tok_AbC -123_xyz)\""
check report $generic docs/adr/0004-example/README.md "Idempotency-Key: $(j d2c8a7b1-3e5f- 4092-8b4c-6f9e1d8b2c35)"
check report $generic apps/shazlo-one/src/api/client.ts "const password = '$(j shazlo-one- 2026)'"
check report $generic apps/vendor-portal/src/api/client.ts "const password = '$(j ajrakh- indigo-26)'"

# Another value in those files: reported.
check report $generic apps/vendor-portal/src/api/uploads/testing.ts "export const API_KEY = '$(j key-8f3Kq9 2jX7m1p4Zr)'"
check report $generic services/vendor-api/tests/test_publisher.py "    password = \"$(j Wq7-Zr2p -Lx9Vb4Nc)\""

# No allowlisted file hides a different kind of secret.
for path in \
  apps/vendor-portal/src/api/uploads/testing.ts \
  services/vendor-api/tests/test_e2e_publishing.py \
  services/vendor-api/tests/test_publisher.py \
  services/vendor-api/tests/test_settings.py \
  services/vendor-api/tests/test_email_service.py \
  docs/adr/0003-contract/README.md \
  apps/shazlo-one/src/mocks/identity.ts \
  apps/vendor-portal/src/mocks/db.ts \
  backend/README.md \
  .github/workflows/services-ci.yml; do
  check report github-pat "$path" "token = '$gh_token'"
done

if [ "$failures" -gt 0 ]; then
  echo "$failures of $cases allowlist cases failed" >&2
  exit 1
fi
echo "All $cases allowlist cases passed"
