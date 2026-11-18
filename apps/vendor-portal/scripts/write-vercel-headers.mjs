// Runs before `vite build` (npm "prebuild"). On Vercel it rewrites the headers in vercel.json so the
// Content-Security-Policy names this deployment's real API origin (VITE_VENDOR_API_URL). Anywhere
// else (a laptop, CI) it changes nothing, so a local build never dirties the committed file.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { vercelHeaders } from '../src/security/headers.ts'

if (!process.env.VERCEL) {
  console.log('write-vercel-headers: not on Vercel, vercel.json left as it is.')
  process.exit(0)
}

const raw = (process.env.VITE_VENDOR_API_URL ?? '').trim()
let origin
try {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('not a plain https origin')
  }
  origin = url.origin
} catch {
  console.error('write-vercel-headers: VITE_VENDOR_API_URL must be a plain https origin (for example https://api.shazlo.com).')
  process.exit(1)
}

const file = fileURLToPath(new URL('../vercel.json', import.meta.url))
const config = JSON.parse(readFileSync(file, 'utf8'))
config.headers = vercelHeaders(origin)
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
console.log(`write-vercel-headers: connect-src now allows ${origin}.`)
