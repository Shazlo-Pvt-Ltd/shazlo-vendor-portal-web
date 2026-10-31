# apps

React + TypeScript (Vite) apps, managed as npm workspaces from the repo root (`apps/*`, `packages/*`).

## Tooling (enforced by CI)

| Tool | Config | Command (from repo root) |
|---|---|---|
| eslint | `eslint.config.js` (shared; ignores legacy `app/`, `backend/` and `services/`) | `npm run lint` |
| tsc | `tsconfig.base.json`, extended by each workspace | `npm run typecheck` |
| vitest | root `vitest.config.ts` selects workspace, legacy and contract projects | `npm test` |

Setup: `npm ci` at the repo root (Node 20+), plus `npm ci --prefix app` and
`npm ci --prefix backend` for the legacy test projects. Typechecking discovers
workspace scripts; add new test projects to the root Vitest configuration.
See [the test strategy](../docs/testing.md) for focused commands and limitations.
