import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnv } from './env';

type EnvBag = Record<string, string | undefined>;

export function createServiceClient(cfEnv?: EnvBag): SupabaseClient | null {
  const url = readEnv('SUPABASE_URL', cfEnv) || readEnv('PUBLIC_SUPABASE_URL', cfEnv);
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', cfEnv);
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(cfEnv?: EnvBag): SupabaseClient | null {
  const url = readEnv('PUBLIC_SUPABASE_URL', cfEnv) || readEnv('SUPABASE_URL', cfEnv);
  const key = readEnv('PUBLIC_SUPABASE_ANON_KEY', cfEnv) || readEnv('SUPABASE_ANON_KEY', cfEnv);
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
