// Vercel Edge Function — server-side proxy for the agent's dashboard-feed webhook.
//
// The SPA fetches GET /api/feed; this function POSTs to the webhook with the
// shared secret from the Vercel env, so the secret never ships in the client
// bundle (same rule as SITE_PASSWORD in middleware.ts). The site-password
// middleware runs before this, so the feed is only reachable once signed in.
//
// Env (Vercel project settings, NOT VITE_-prefixed):
//   FEED_WEBHOOK_URL      https://webhook.heylua.ai/{agentId}/dashboard-feed
//   DASHBOARD_FEED_SECRET the same value set on the agent

export const config = { runtime: 'edge' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default async function handler(): Promise<Response> {
  const url = process.env.FEED_WEBHOOK_URL;
  const secret = process.env.DASHBOARD_FEED_SECRET;
  if (!url || !secret) return json({ error: 'feed not configured' }, 503);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) return json({ error: `feed upstream returned ${res.status}` }, 502);
    const payload = await res.json();
    if (payload?.error) return json({ error: 'feed rejected the request' }, 502);
    return json(payload);
  } catch {
    return json({ error: 'feed unreachable' }, 502);
  }
}
