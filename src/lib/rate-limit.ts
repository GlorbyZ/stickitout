const buckets = new Map<string, { count: number; resetAt: number }>();

/** Isolate-local rate limit. Good enough for this slice; KV/Durable Object next. */
export function allowRequest(key: string, limit = 5, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
