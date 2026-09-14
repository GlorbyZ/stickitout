import type { APIRoute } from 'astro';

export const prerender = false;

/** TODO: Stripe membership webhook. Do not invent product IDs or signing secrets. */
export const POST: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      ok: false,
      message: 'TODO: Stripe webhook for memberships. Not in this slice.',
    }),
    {
      status: 501,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    },
  );
};
