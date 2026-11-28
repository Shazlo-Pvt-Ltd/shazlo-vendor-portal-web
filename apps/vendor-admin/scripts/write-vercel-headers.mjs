// Runs before `vite build` (npm "prebuild"). It writes the headers block of vercel.json from the one
// policy in src/security/headers.ts, for this deployment's shell and vendor-api origins: frame-ancestors
// names the shell, and the shell may read /shazlo-module.json. On Vercel it always writes; elsewhere
// only with --write, or --placeholder for the committed file. Node runs the TypeScript files as they are.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readEnv } from '../src/config/env.ts'
import { PLACEHOLDER_API_ORIGIN, PLACEHOLDER_SHELL_ORIGIN, vercelHeaders } from '../src/security/headers.ts'

const placeholder = process.argv.includes('--placeholder')
if (!process.env.VERCEL && !process.argv.includes('--write') && !placeholder) {
  console.log('write-vercel-headers: not on Vercel, vercel.json left as it is.')
  process.exit(0)
}

let origins = { shellOrigin: PLACEHOLDER_SHELL_ORIGIN, apiOrigin: PLACEHOLDER_API_ORIGIN }
if (!placeholder) {
  const settings = readEnv(process.env, { dev: false })
  if (!settings.ok) {
    console.error(`write-vercel-headers: the Vendors module is not set up correctly:\n- ${settings.problems.join('\n- ')}`)
    process.exit(1)
  }
  origins = settings.env
}

const target = fileURLToPath(new URL('../vercel.json', import.meta.url))
const config = JSON.parse(readFileSync(target, 'utf8'))
config.headers = vercelHeaders(origins)
writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`)
console.log(`write-vercel-headers: frame-ancestors ${origins.shellOrigin}; connect-src ${origins.apiOrigin}.`)
