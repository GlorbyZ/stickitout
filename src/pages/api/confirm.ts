import type { APIRoute } from 'astro';
import { cloudflareEnv } from '../../lib/env';
import { createServiceClient } from '../../lib/supabase';

export const prerender = false;

export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token') || url.searchParams.get('t') || '';
  if (!token) return redirect('/free-lesson');

  const cfEnv = await cloudflareEnv();
  const supabase = createServiceClient(cfEnv);
  if (!supabase) return redirect('/free-lesson');

  const { data } = await supabase
    .from('subscribers')
    .select('id, confirm_expires_at')
    .eq('confirm_token', token)
    .maybeSingle();

  if (!data) return redirect('/free-lesson');

  if (data.confirm_expires_at && new Date(data.confirm_expires_at) < new Date()) {
    return redirect('/free-lesson');
  }

  const now = new Date().toISOString();
  await supabase
    .from('subscribers')
    .update({ confirmed_at: now, updated_at: now })
    .eq('id', data.id);

  await supabase.from('email_events').insert({
    subscriber_id: data.id,
    event_type: 'confirmed',
    payload: {},
  });

  return redirect(`/free-lesson/watch?t=${encodeURIComponent(token)}`);
};
