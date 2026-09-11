interface ImportMetaEnv {
  readonly PUBLIC_MARKETING_URL?: string
  readonly PUBLIC_APP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.css?url' {
  const href: string
  export default href
}
