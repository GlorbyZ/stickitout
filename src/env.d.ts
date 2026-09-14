/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly RESEND_API_KEY?: string;
  readonly RESEND_FROM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'cloudflare:workers' {
  export const env: Record<string, string | undefined>;
}
