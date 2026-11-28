import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface EvilSite {
  /** An origin that is neither the shell's nor the module's (127.0.0.1, so another site than localhost). */
  origin: string
  /** A second such origin (another port), for a control frame. */
  otherOrigin: string
  /** Serves `html` at `path` on both origins. */
  page(path: string, html: string): void
  close(): Promise<void>
}

/**
 * An attacker's pages, served for real on this machine. They are not faked with `page.route`: Chromium
 * treats a routed page on a made-up host as a public site, and its local network access rules then stop
 * that page from framing or reaching localhost at all, which would hide whether the shell or the module
 * refused. On 127.0.0.1 the attacker is local like them, so any refusal seen is theirs.
 */
export async function startEvilSite(): Promise<EvilSite> {
  const pages = new Map<string, string>()
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    const body = pages.get(new URL(request.url ?? '/', 'http://evil.invalid').pathname)
    if (body === undefined) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body)
  }
  const listen = async (): Promise<Server> => {
    const server = createServer(handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return server
  }
  const servers = [await listen(), await listen()] as const
  const originOf = (server: Server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    origin: originOf(servers[0]),
    otherOrigin: originOf(servers[1]),
    page: (path, html) => void pages.set(path, html),
    close: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.closeAllConnections()
              server.close(() => resolve())
            }),
        ),
      )
    },
  }
}

/**
 * A page that frames `target` next to a control frame from another attacker origin, and sets its title
 * to "framed" once both frames fired `load` (a blocked frame fires it too). The control proves this
 * browser frames another local origin here, so a refused `target` was refused by its own headers.
 */
export function framingPage(site: EvilSite, target: string): string {
  const onload = "window.loaded=(window.loaded||0)+1;if(window.loaded===2)document.title='framed'"
  return `<!doctype html><title>evil</title>
<iframe id="control" src="${site.otherOrigin}/control" onload="${onload}"></iframe>
<iframe id="victim" src="${target}" onload="${onload}"></iframe>`
}

export const CONTROL_PAGE = '<!doctype html><title>control</title><h1>control frame</h1>'
