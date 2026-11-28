/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IDENTITY_API_URL?: string
  /** `preview` selects the preview module registry; anything else is production. Set by the build, not by hand. */
  readonly VITE_DEPLOY_ENV?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
