// Runs before `vite build` (npm "prebuild"). On Vercel it rewrites the headers in vercel.json so the
// Content-Security-Policy names this deployment's real API origin (VITE_IDENTITY_API_URL). Anywhere
// else (a laptop, CI) it changes nothing, so a local build never dirties the committed file.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vercelHeaders } from '../src/security/headers.ts'
import { environmentOf, modulesFor, originsOf } from '../src/modules/registry.ts'

if (!process.env.VERCEL) {
  console.log('write-vercel-headers: not on Vercel, vercel.json left as it is.')
  process.exit(0)
}

const raw = (process.env.VITE_IDENTITY_API_URL ?? '').trim()
let origin
try {
  const url = new URL(raw)
  // A plain host name only: the URL parser accepts ';' in a host, which would start a new CSP directive.
  if (url.protocol !== 'https:' || !/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(url.hostname) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('not a plain https origin')
  }
  origin = url.origin
} catch {
  console.error('write-vercel-headers: VITE_IDENTITY_API_URL must be a plain https origin (for example https://identity.shazlo.com).')
  process.exit(1)
}

const file = fileURLToPath(new URL('../vercel.json', import.meta.url))
const config = JSON.parse(readFileSync(file, 'utf8'))
// A broken registry fails the build here, before anything is deployed.
let moduleOrigins
try {
  const target = process.env.VITE_DEPLOY_ENV || process.env.VERCEL_ENV
  moduleOrigins = originsOf(modulesFor(environmentOf({ dev: false, target })))
} catch (error) {
  console.error(`write-vercel-headers: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

config.headers = vercelHeaders(origin, moduleOrigins)
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
console.log(`write-vercel-headers: connect-src now allows ${origin}; frame-src allows ${moduleOrigins.length} module origin(s).`)
