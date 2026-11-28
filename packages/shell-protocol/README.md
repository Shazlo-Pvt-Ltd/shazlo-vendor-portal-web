# @shazlo/shell-protocol

The `postMessage` protocol between the Shazlo-One shell and each module it frames
([ADR 0001](../../docs/adr/0001-iframe-postmessage-protocol.md)): the types and constants, a runtime
validator for every message, and both ends of the channel. The shell and every module use this
package; nothing else posts or reads cross-frame messages (a test in this package fails if app code
does).

A mistake here is a security bug (a `*` target origin, a missing origin check), so it is written and
tested once, here. There is **no runtime dependency**: the validators are small and hand-written.

```
src/
  constants.ts      PROTOCOL, PROTOCOL_VERSION, MAX_MESSAGE_BYTES, limits
  types.ts          the envelope, every message, DropReason
  validate.ts       parseModuleToShell, parseShellToModule, isEnvelope, isModulePath
  trust.ts          isTrustedMessage: origin AND source window
  size.ts           isWithinSizeLimit: 64 KB, measured as JSON bytes
  version.ts        shellSupportedVersions, negotiateVersion
  origin.ts         assertExactOrigin, ProtocolConfigError
  post.ts           postExact: the only call to postMessage; refuses "*"
  logger.ts         createDropLogger: development logs, production is silent
  shellChannel.ts   createShellChannel: the shell's end
  moduleClient.ts   createModuleClient: a module's end
test/
  harness.ts        two real jsdom windows with a browser-faithful postMessage
  contract.test.ts  both ends together, including hostile cases
  source-guard.test.ts  no "*", one postMessage call, apps go through this package
```

## The message catalogue

Every message is one object: `{ protocol: "shazlo-one", v, type, id, replyTo?, sentAt, payload }`.
`id` and `replyTo` are UUIDs, `sentAt` is milliseconds since the epoch (informational), `v` is an
integer protocol version (currently `1`). A message over **64 KB** is dropped, and so is one holding a
Map, Set, buffer or Blob (JSON writes those as `{}`, so their size could not be counted).

**Shell to module**

| Type | Payload | Notes |
| --- | --- | --- |
| `auth` | `{ accessToken, expiresAt, user: { id, email, roles }, locale? }` | After `ready` (with `replyTo`), and again on every refresh. `expiresAt` is epoch **seconds**. The module ignores one that expires earlier than the token it holds |
| `navigate` | `{ path }` | `path` starts with `/` (not `//`), at most 2000 characters, no backslash or control character |
| `error` | `{ code, message }` | For example `version_unsupported`. A module reads it whatever its `v` |

**Module to shell**

| Type | Payload | Notes |
| --- | --- | --- |
| `ready` | `{ module, supportedVersions, moduleVersion }` | On every page load, first. The shell reads it whatever its `v`, to answer `version_unsupported` |
| `title` | `{ path, title }` | `title` is plain text, at most 200 characters |
| `token:request` | `{ reason: "expired" \| "unauthorized" }` | At most once every 30 seconds (the client enforces it) |
| `logout` | `{ reason? }` | |
| `toast` | `{ level, message, durationMs? }` | `level` is `info`, `success`, `warning` or `error`. `message` is plain text, **at most 280 characters**, and text that looks like an HTML tag is refused. `durationMs` is 0 to 60 000 |
| `error` | `{ code, message, fatal }` | `fatal: true` makes the shell show its error panel |

### What the validators guarantee

- They **never throw** on bad input (a throwing getter, a revoked proxy, `null`, a BigInt are all just dropped).
- **Exact shapes.** A payload is rebuilt from the fields we know, so **unknown fields are ignored** and
  cannot reach a handler, and a `__proto__` key cannot pollute anything.
- **Unknown `type`s are dropped**, as are a wrong `protocol`, a version the receiver does not speak,
  and a payload that fails its checks. A type that is valid in the other direction is unknown here
  (a module cannot send `auth`).
- `expiresAt` must be a finite positive number of epoch seconds (a value in milliseconds is refused);
  `path`s start with `/`; strings have length limits and no control characters.

## Trust and origins

Both ends accept a message only if `event.origin` is the **exact** expected origin **and**
`event.source` is the **exact** expected window (the iframe's `contentWindow` for the shell, `window.parent`
for a module). Both ends post only to that exact origin. `*` is refused everywhere: `postExact` throws
on `*`, an empty or an opaque origin, and the constructors throw on a missing, wildcard, pattern, path
or non-https origin (`http://localhost` is allowed only with `development: true`), and on a version
list or module id the other end would refuse. The check runs
before anything about the message is read, and a message from anyone else is ignored without a log
line, so a page that frames us cannot flood the console.

## Versions

The shell supports the current version and the previous one (`shellSupportedVersions()`).
`negotiateVersion` picks the highest both sides speak. With none in common the shell answers
`error` with `version_unsupported` (on its own highest version) and calls `onVersionUnsupported`, so
the shell can show a panel naming the module and its version. Adding an optional payload field does not
bump `v`; removing or renaming one does.

## Logging

With `development: true` each dropped message is logged with the reason, the type and the origin, and
**never its content** (it may hold a token). A production build (`development` omitted or `false`) is
silent.

## How the shell uses it

```ts
import { createShellChannel } from '@shazlo/shell-protocol'

// 1. Create the channel BEFORE setting the iframe's src: it listens from this moment.
const channel = createShellChannel({
  iframe,                              // the HTMLIFrameElement
  origin: entry.origin,                // the module's exact origin, from the registry
  development: import.meta.env.DEV,
  onReady: ({ id }) => {
    // 2. Answer with the module's token (from POST /v1/auth/token), replying to ready.
    channel.sendAuth({ accessToken, expiresAt, user }, { replyTo: id })
  },
  onVersionUnsupported: (info) => showPanel(info.module, info.moduleVersion),
  onTitle: ({ path, title }) => syncBreadcrumb(path, title),
  onTokenRequest: () => channel.sendAuth(freshAuth()),
  onLogout: () => endSession(),
  onToast: ({ level, message }) => showToast(level, message), // render as text, never HTML
  onModuleError: ({ fatal }) => fatal && showErrorPanel(),
})
iframe.src = entry.url
// later: channel.sendAuth(...) on each refresh, channel.sendNavigate('/orders/42'), channel.dispose()
```

## How a module adopts it

```ts
import { createModuleClient } from '@shazlo/shell-protocol'

// SHELL_ORIGIN is a build-time setting per environment. Pass it through unchanged: a missing value,
// a wildcard or a non-https origin throws, so a bad production build fails at start.
const shell = createModuleClient({
  shellOrigin: import.meta.env.VITE_SHELL_ORIGIN,
  module: 'vendor-admin',
  moduleVersion: __APP_VERSION__,
  development: import.meta.env.DEV,
  onAuth: () => { /* a new token: shell.getAccessToken() */ },
  onNavigate: (path) => router.navigate(path),
  onShellError: ({ code }) => showError(code),
})

shell.sendReady()                                   // on every page load, first
const token = shell.getAccessToken()                // in memory only; undefined once expired
fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  .then((response) => response.status === 401 && shell.requestToken('unauthorized'))
shell.sendTitle(location.pathname, 'Orders')        // on each in-module navigation
shell.sendToast({ level: 'success', message: 'Saved.' })
```

Keep the token **in memory only**: never in a URL, a log, `localStorage` or `sessionStorage`. Use
`shell.needsToken()` to ask for a new one before the old one ends (the shell also pushes a fresh `auth`
at about 80% of the lifetime).

## Testing

`npm test --workspace @shazlo/shell-protocol`. The contract tests run both ends together over two real
jsdom windows. jsdom's own `postMessage` sets neither `origin` nor `source`, so `test/harness.ts`
replaces it with one that behaves like a browser's (the sender's origin and window, delivery only when the
target origin matches, structured clone), and records every call so a test can prove none used `*`. The
hostile cases cover the wrong origin, the wrong window, oversize, malformed, wrong-protocol and
wrong-version messages, and a replayed `auth` with an older `expiresAt`.
