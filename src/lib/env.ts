type EnvBag = Record<string, string | undefined>;

function fromVite(key: string): string {
  const bag = import.meta.env as EnvBag;
  const value = bag[key];
  return typeof value === 'string' ? value.trim() : '';
}

function fromProcess(key: string): string {
  try {
    const value = process.env?.[key];
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Read a runtime secret. Cloudflare Pages / Workers secrets win;
 * Vite `.env` / `.dev.vars` fill in locally.
 */
export function readEnv(key: string, cfEnv?: EnvBag): string {
  const fromCf = cfEnv?.[key];
  if (typeof fromCf === 'string' && fromCf.trim()) return fromCf.trim();
  return fromVite(key) || fromProcess(key);
}

export function siteUrl(cfEnv?: EnvBag): string {
  return readEnv('PUBLIC_SITE_URL', cfEnv).replace(/\/$/, '') || 'https://stickitoutbook.com';
}

export async function cloudflareEnv(): Promise<EnvBag> {
  try {
    const mod = await import('cloudflare:workers');
    return (mod.env ?? {}) as EnvBag;
  } catch {
    return {};
  }
}
