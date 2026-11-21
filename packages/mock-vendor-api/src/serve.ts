import { createServer } from 'node:http'
import { getResponse } from 'msw'
import { createMockVendorApi } from './db'
import { createVendorApiHandlers } from './handlers'

// A local stand-in for vendor-api's admin routes, so the Shazlo One shell and the vendor-admin
// module (two origins) share one state. `npm run serve -w @shazlo/mock-vendor-api` → http://localhost:5194
const PORT = Number(process.env.PORT ?? 5194)
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5192,http://localhost:5193,http://localhost:4192,http://localhost:4193').split(',')

let db = createMockVendorApi()
const handlers = createVendorApiHandlers(() => db)

createServer(async (req, res) => {
  const origin = req.headers.origin ?? ''
  if (ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  }
  if (req.method === 'OPTIONS') return void res.writeHead(204).end()
  if (req.url === '/__reset' && req.method === 'POST') {
    db = createMockVendorApi()
    return void res.writeHead(204).end()
  }
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: Object.entries(req.headers).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  })
  const response = await getResponse(handlers, request)
  if (!response) return void res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Not found', extra: { code: 'not_found' } }))
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
}).listen(PORT, () => console.log(`mock vendor-api on http://localhost:${PORT}`))
