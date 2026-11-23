import { execFileSync } from 'node:child_process'
import { URL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// backend/.env with live database and Cloudinary credentials was committed more than once before
// it was ignored. These checks keep secret-bearing files out of commits. --no-index asks only the
// ignore rules, so the answer does not depend on what happens to be tracked or present.
const root = fileURLToPath(new URL('../../', import.meta.url))

function isIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', path], { cwd: root, stdio: 'ignore' })
    return true
  } catch (error) {
    if (error.status === 1) return false
    throw error
  }
}

describe('files that hold secrets stay out of git', () => {
  it.each([
    '.env', 'backend/.env', 'app/.env.local', 'services/vendor-api/.env.production',
    'services/identity-api/.keys/signing.json', 'certs/server.pem', 'certs/server.key',
    'id_rsa', 'deploy/id_ed25519', 'certs/client.p12', 'certs/client.pfx',
    'credentials.json', 'gcp/credentials-prod.json', 'serviceAccountKey.json', 'firebase/service-account.json',
    '.claude/settings.local.json', '.claude/worktrees/agent-1/backend/.env.example',
  ])('ignores %s', (path) => {
    expect(isIgnored(path)).toBe(true)
  })

  it.each(['.env.example', 'backend/.env.example', 'apps/vendor-portal/.env.example', 'package.json'])(
    'still tracks %s', (path) => {
      expect(isIgnored(path)).toBe(false)
    })
})
