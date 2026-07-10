// Vercel Edge Middleware — branded password gate for the Position Assistant.
//
// Runs at the edge on every request BEFORE static files are served. Unauthenticated
// visitors get a branded Sucafina login page (password only, no username); a correct
// password sets an auth cookie and redirects into the app. The password is validated
// server-side and never ships in the client JS bundle.
//
// Only runs on Vercel (production / preview) — a plain local `vite dev` does NOT run
// this file, so local development stays ungated.
//
// The password is read from the `SITE_PASSWORD` env var (set in the Vercel project
// settings — NOT committed, and intentionally not `VITE_`-prefixed so it is never
// bundled into the client).

export const config = {
  runtime: 'edge',
  matcher: '/:path*', // gate every route + asset (root included)
};

const COOKIE_NAME = 'position_assistant_auth';
const MAX_AGE = 60 * 60 * 24 * 7; // keep the visitor signed in for 7 days
const LOGO = 'data:image/png;base64,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';

async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Only allow same-origin relative paths as a post-login redirect target (no open redirects).
function sanitizeNext(raw: string | null): string {
  if (!raw) return '/';
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function loginPage(opts: { error: boolean; next: string }): string {
  const action = '/__auth?next=' + encodeURIComponent(opts.next);
  const errorBlock = opts.error
    ? '<p class="err" role="alert">Incorrect password. Please try again.</p>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Position Assistant — Sucafina Kenya Desk</title>
<style>
  :root {
    --teal: #1f7a76;
    --teal-dark: #17615e;
    --green: #6fae3f;
    --ink: #33514f;
    --muted: #7a8b89;
    --line: #d9e2e0;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    background: radial-gradient(1200px 600px at 50% -10%, #ffffff 0%, #eef4f2 55%, #e3ede9 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    position: relative;
    width: 100%;
    max-width: 400px;
    background: #ffffff;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 44px 40px 36px;
    text-align: center;
    box-shadow: 0 24px 60px -24px rgba(23, 97, 94, 0.35), 0 2px 8px rgba(0, 0, 0, 0.04);
    overflow: hidden;
  }
  .card::before {
    content: "";
    position: absolute;
    inset: 0 0 auto 0;
    height: 4px;
    background: linear-gradient(90deg, var(--teal), var(--green));
  }
  .logo { width: 176px; max-width: 70%; height: auto; margin: 4px auto 20px; display: block; }
  h1 { font-size: 19px; font-weight: 600; letter-spacing: 0.2px; margin: 0 0 6px; color: var(--ink); }
  .sub { font-size: 13.5px; color: var(--muted); margin: 0 0 26px; }
  form { display: flex; flex-direction: column; gap: 12px; text-align: left; }
  label { font-size: 12.5px; font-weight: 600; color: var(--muted); letter-spacing: 0.3px; }
  input[type="password"] {
    width: 100%;
    padding: 12px 14px;
    font-size: 15px;
    color: var(--ink);
    background: #fbfdfc;
    border: 1px solid var(--line);
    border-radius: 10px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  input[type="password"]:focus {
    border-color: var(--teal);
    box-shadow: 0 0 0 3px rgba(31, 122, 118, 0.16);
    background: #ffffff;
  }
  button {
    margin-top: 4px;
    padding: 12px 16px;
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
    background: var(--teal);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s, transform 0.05s;
  }
  button:hover { background: var(--teal-dark); }
  button:active { transform: translateY(1px); }
  .err { color: #c0392b; font-size: 13px; margin: 2px 0 0; text-align: center; }
  .foot { margin-top: 22px; font-size: 11.5px; color: var(--muted); letter-spacing: 0.3px; }
</style>
</head>
<body>
  <main class="card">
    <img class="logo" src="${LOGO}" alt="Sucafina" />
    <h1>Position Assistant</h1>
    <p class="sub">Kenya trading desk &middot; enter the access password to continue.</p>
    <form method="POST" action="${action}">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
      <button type="submit">Unlock assistant</button>
      ${errorBlock}
    </form>
    <p class="foot">Authorized access only</p>
  </main>
</body>
</html>`;
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async function middleware(request: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return; // gate not configured -> serve normally (avoids accidental full lockout)

  const url = new URL(request.url);
  const token = await sha256hex('position-gate::' + password);

  // Login form submission.
  if (request.method === 'POST' && url.pathname === '/__auth') {
    let supplied = '';
    try {
      const form = await request.formData();
      supplied = String(form.get('password') ?? '');
    } catch {
      /* malformed body -> treated as wrong password */
    }
    const next = sanitizeNext(url.searchParams.get('next'));
    if (supplied === password) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: next,
          'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return htmlResponse(loginPage({ error: true, next }), 401);
  }

  // Already authenticated?
  const cookie = request.headers.get('cookie') ?? '';
  const authed = cookie.split(/;\s*/).some((c) => c === `${COOKIE_NAME}=${token}`);
  if (authed) return; // continue to the app

  // Not authenticated -> serve the branded login page.
  return htmlResponse(loginPage({ error: false, next: url.pathname + url.search }));
}
