/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly VITE_API_BASE_URL?: string
  readonly VITE_DEV_ADMIN_KEY?: string
  readonly VITE_MOCK?: string
}

interface ImportMeta { readonly env: ImportMetaEnv }
