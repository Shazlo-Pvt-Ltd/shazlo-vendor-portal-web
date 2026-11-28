// `npm run dev:with-module`: the shell (5173) and the reference module (5175), side by side, in one
// terminal. Either one stopping stops both. Development only.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

const servers = [
  { name: 'shell', args: [vite] },
  // `--configLoader runner`: the module's config reads the protocol package, which is TypeScript source.
  { name: 'module', args: [vite, '--config', 'dev-module/vite.config.ts', '--configLoader', 'runner'] },
]

const children = servers.map(({ name, args }) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit' })
  child.on('error', (error) => {
    console.error(`dev-with-module: could not start the ${name}: ${error.message}`)
    stop(1)
  })
  child.on('exit', (code) => stop(code ?? 0))
  return child
})

let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  process.exitCode = code
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
