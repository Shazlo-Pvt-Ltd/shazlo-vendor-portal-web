# How to build a module

A module is the admin UI of one service, built as its own web app and shown inside the Shazlo-One shell in an iframe. The first one is `vendor-admin` (Phase 7). This guide is the short path; the decisions behind it are in [ADR 0001](adr/0001-iframe-postmessage-protocol.md) (the protocol) and [ADR 0009](adr/0009-auth-model.md) (the tokens). A working model is the reference module, [`apps/shazlo-one/dev-module`](../apps/shazlo-one/README.md#the-reference-module).

## What a module is, and is not

- **Its own origin, build and deploy.** The shell and the module share no cookie and no storage. The only link is `postMessage`.
- **It has no sign-in screen.** The shell signs the admin in and hands the module a short token (5 minutes) for the module's own backend. The module keeps it in memory.
- **It trusts only the shell.** One exact origin, and the shell's window. Never `*`.
- **Its backend does the real checking.** The postMessage origin checks protect the channel, not the data: every API call is verified on the server against identity-api's keys.

## The five parts

1. A **frontend** that speaks the protocol (`@shazlo/shell-protocol`).
2. A **backend audience**: identity-api must know the service's name and which roles may get a token for it.
3. A **backend that verifies** those tokens and allows the module's origin.
4. **Headers** on the module so only the shell can frame it.
5. A **registry entry** in the shell.

## 1. The frontend

Add `@shazlo/shell-protocol` to the module's `package.json` (`"@shazlo/shell-protocol": "*"` in this workspace). It is the only code that posts or reads cross-frame messages; do not call `postMessage` or add a `message` listener yourself.

```ts
import { createModuleClient } from '@shazlo/shell-protocol'

const shell = createModuleClient({
  shellOrigin: import.meta.env.VITE_SHELL_ORIGIN,   // pass it through: a missing, wildcard or non-https value throws
  module: 'vendor-admin',                           // the id in the shell's registry
  moduleVersion: __APP_VERSION__,
  development: import.meta.env.DEV,
  onAuth: (auth) => { /* a new token arrived: auth.user.email, auth.user.roles, auth.expiresAt */ },
  onNavigate: (path) => router.navigate(path),      // the shell opened a deep link
  onShellError: ({ code }) => showError(code),      // for example version_unsupported
})
shell.sendReady()                                   // on every page load, first
```

What to do with each message:

| You want to | Call | Notes |
| --- | --- | --- |
| Say you are alive | `shell.sendReady()` | On every load, after creating the client. The shell answers with `auth` |
| Call your API | `shell.getAccessToken()` | In memory only; `undefined` once expired. Send it as `Authorization: Bearer`, with `credentials: 'omit'` |
| Handle a `401` | `shell.requestToken('unauthorized')` | At most once every 30 seconds (the client enforces it); repeat the call when `onAuth` fires |
| Keep the shell's tab title and address in step | `shell.sendTitle(path, title)` | On each in-module navigation. The shell **replaces** its address with `/m/<id><path>` and shows the title; `title` is plain text |
| Show a message | `shell.sendToast({ level, message })` | `info`, `success`, `warning` or `error`; plain text, at most 280 characters. Never use `alert()` or a dialog: the sandbox has no `allow-modals` |
| Sign out | `shell.sendLogout()` | The shell ends the session |
| Report a failure | `shell.sendError(code, message, fatal)` | `fatal: true` replaces the module with the shell's error panel |

Rules that keep it safe:

- **The token never leaves memory.** Not in a URL, a log line, `localStorage`, `sessionStorage` or `indexedDB`. The shell's own lint and tests enforce this; copy those rules into your module.
- **Deep links.** When the shell opens `/m/<id>/orders/42`, it sends `navigate { path: '/orders/42' }` once you have a token, and again after every `ready`. Route to it, then send `title` for the page you landed on. Do not send back a path the shell just gave you as if you had navigated.
- **Opened outside the shell** (your URL typed into a tab), render a plain "open this in Shazlo-One" page and do nothing else: no listener, no message, no request. The reference module does this.
- **Unsaved work.** There is no "confirm before leaving" message in protocol version 1, and the sandbox blocks browser prompts. Autosave drafts, or keep the work where a reload or a lost token cannot destroy it.
- **Versions.** List the protocol versions you support in `ready`; the shell supports the current and previous one. Adding an optional field does not bump the version.

## 2. The audience in identity-api

identity-api only issues a module token for a service it knows. In its settings, `AUDIENCE_ROLES` maps each service's name (the token's `aud`) to the roles allowed to get a token for it:

```json
{"vendor-api": ["super_admin", "vendor_reviewer"], "orders-api": ["super_admin", "orders_clerk"]}
```

Adding a service is a settings change; it must not list `identity-api`. New roles are created by the admin seed or the admin screens and are named `<area>_<role>`. The token carries only the roles listed for that service, and roles are read at exchange time.

## 3. The backend

- **Verify with `packages/py-auth`** (`shazlo-auth`), not by hand: `TokenVerifier(keys, issuer=..., audience="<the service's name>")` with one `JwksClient` per process, then `require_role(...)` on the routes. See [its README](../packages/py-auth/README.md).
- **Allow the module's origin in CORS**, exactly, with no wildcard (compose allows `http://localhost:5175` for vendor-api in development).
- **Accept only the module token** on admin routes; an identity-api token for another audience must be refused.

## 4. Headers on the module

Every response from the module carries:

```
Content-Security-Policy: frame-ancestors https://<the shell's origin>
Referrer-Policy: no-referrer
```

`frame-ancestors` replaces `X-Frame-Options`; do not send the old header. Any other origin that tries to frame the module is refused by the browser. In development the local shell (`http://localhost:5173`) is added. The reference module's `headers.ts` is a model. Give the module its own strict CSP too (`script-src 'self'`, `connect-src` its API only).

## 5. The registry entry in the shell

Adding a module is one entry in the shell's registry, `apps/shazlo-one/src/modules/registry.ts`, in the list of each environment it runs in:

```ts
{
  id: 'vendor-admin',            // the address, /m/vendor-admin
  title: 'Vendor admin',
  description: 'Review vendor applications, products and brand pages.',
  url: 'https://vendor-admin.shazlo.com/',
  origin: 'https://vendor-admin.shazlo.com',   // exact; never a wildcard or a pattern
  roles: ['vendor_reviewer'],    // an admin needs one of these; super_admin opens every module
  audience: 'vendor-api',        // the token audience (step 2)
  supportedVersions: [1],
}
```

The navigation, the routes and the shell's `frame-src` all follow from it, and the registry is checked when the shell builds and starts (no wildcard, https outside development, `url` on its `origin`, no duplicates). The shell's `roles` decide who sees the module; the backend's roles decide what they may do. Keep both.

## Try it

Run the whole thing as described in the [shell README](../apps/shazlo-one/README.md#running-the-whole-thing): the shell on 5173, your module on its own port, and the APIs. Add the module to the **development** registry only until it is ready to deploy. The reference module is the quickest way to see each message work.

## Test it

- **Unit tests**: render the module with a fake shell. `@shazlo/shell-protocol` has a test harness (`test/harness.ts`) with two jsdom windows and a browser-faithful `postMessage`; the reference module's tests show how to use it.
- **Checks to copy from the shell**: no web storage, no raw HTML, no `console.log`, no hard-coded colours or fonts, no inline script in the production build.
- **In a browser** (when the end-to-end setup lands, [#259](https://github.com/Shazlo-Pvt-Ltd/shazlo-vendor-portal-web/issues/259)): the module ignores messages from another origin, refuses to be framed by another origin, and no token appears in a URL, request log or web storage.

## Checklist

- [ ] Uses `@shazlo/shell-protocol`; no hand-written `postMessage` or `message` listener
- [ ] `VITE_SHELL_ORIGIN` is one exact origin, passed through unchanged
- [ ] Token only in memory; sent as a bearer header with `credentials: 'omit'`
- [ ] `401` handled with `requestToken`, once per 30 seconds
- [ ] `sendReady` on every load; `sendTitle` on every in-module navigation; `navigate` handled
- [ ] A plain page when opened outside the shell
- [ ] `frame-ancestors` is the shell's origin only; `Referrer-Policy: no-referrer`
- [ ] Service name in `AUDIENCE_ROLES`; backend verifies with `shazlo-auth` and allows the module's origin
- [ ] Registry entry with the right `roles` and `audience`
