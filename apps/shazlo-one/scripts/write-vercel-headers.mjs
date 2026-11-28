// Runs before `vite build` (npm "prebuild"). It writes the headers block of vercel.json from the one
// policy in src/security/headers.ts, for this build's identity-api origin and module registry, so
// production gets exactly the policy the dev and preview servers use. On Vercel it always writes;
// elsewhere only with --write (the committed file holds the policy for the placeholder origin and no
// modules, and a laptop build should not dirty it). Node runs the TypeScript files as they are.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseRegistry, registryCsp } from '../../../packages/shell-protocol/src/registry.ts'
import { readEnv } from '../src/config/env.ts'
import { PLACEHOLDER_IDENTITY_ORIGIN, vercelHeaders } from '../src/security/headers.ts'

const placeholder = process.argv.includes('--placeholder')
if (!process.env.VERCEL && !process.argv.includes('--write') && !placeholder) {
  console.log('write-vercel-headers: not on Vercel, vercel.json left as it is.')
  process.exit(0)
}

function fail(lines) {
  console.error(`write-vercel-headers: Shazlo One is not set up correctly:\n- ${lines.join('\n- ')}`)
  process.exit(1)
}

let identityOrigin = PLACEHOLDER_IDENTITY_ORIGIN
let csp = { frameSrc: [], connectSrc: [] }
if (!placeholder) {
  const settings = readEnv(process.env, { dev: false })
  if (!settings.ok) fail(settings.problems)
  if (settings.env.mock) fail(['VITE_MOCK_API=on is a demo build: give it its own policy, not production headers.'])
  identityOrigin = settings.env.identityOrigin
  const file = process.env.VITE_SHELL_REGISTRY
  if (!file) fail(['VITE_SHELL_REGISTRY is not set: name the production module registry (exact https URLs).'])
  try {
    csp = registryCsp(parseRegistry(JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')), 'production'))
  } catch (error) {
    fail([error instanceof Error ? error.message : String(error)])
  }
}

const target = fileURLToPath(new URL('../vercel.json', import.meta.url))
const config = JSON.parse(readFileSync(target, 'utf8'))
config.headers = vercelHeaders({ identityOrigin, frameOrigins: csp.frameSrc, moduleConnectOrigins: csp.connectSrc })
writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`)
console.log(`write-vercel-headers: connect-src allows ${identityOrigin} and ${csp.connectSrc.length} module origin(s); frame-src allows ${csp.frameSrc.length}.`)
