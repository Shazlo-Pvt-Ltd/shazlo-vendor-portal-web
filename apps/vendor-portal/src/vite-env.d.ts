/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VENDOR_API_URL?: string
  /** `on` answers the API from the in-browser mocks (demo and browser tests); `off` by default. */
  readonly VITE_MOCK_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
