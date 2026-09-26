import { html, type Person } from './auth';
import { shell } from './ui';

/**
 * Analyze tab: the member portal proxies /analyze/* to the Stick It Out analyzer
 * (FastAPI on the studio PC, reached through the named Cloudflare Tunnel at
 * ANALYZER_ORIGIN). The Worker adds the analyzer ACCESS_TOKEN server-side from the
 * ANALYZER_TOKEN secret, so members never see or need the key. Only logged-in members
 * reach these routes (index.ts checks the session first).
 *
 * The page is rendered natively in the portal shell: the analyzer's <main> markup is
 * fetched from the origin on each request (so analyzer UI changes show up without a
 * portal deploy), wrapped in `.az`, and styled by ANALYZE_CSS with the portal's own
 * variables. The analyzer's style.css is not loaded here. The analyzer's JS is served
 * through the proxy with its absolute "/api/" URLs rewritten to "/analyze/api/".
 */

export type AnalyzeEnv = { ANALYZER_ORIGIN?: string; ANALYZER_TOKEN?: string };

export const ANALYZE_PREFIX = '/analyze';
const OFFLINE = 'Analyzer is offline right now, try again later.';
const PAGE_TIMEOUT_MS = 8000;
const API_TIMEOUT_MS = 25000;
const JOB = '[0-9a-f]{32}';

/** Member-facing analyzer routes. Anything else (label page, dataset intake, tools) is 404 here. */
function upstreamPath(method: string, sub: string): string | null {
  const read = method === 'GET' || method === 'HEAD';
  if (read && /^\/static\/[A-Za-z0-9_\-]+(\.[A-Za-z0-9_\-]+)*\.(js|mjs|css|png|svg|webp|jpg|ico)$/.test(sub)) {
    return /^\/static\/label[.\-_]/i.test(sub) ? null : sub;
  }
  if (read && sub === '/api/config') return sub;
  if (method === 'POST' && sub === '/api/analyze') return sub;
  if (read && new RegExp(`^/api/jobs/${JOB}$`).test(sub)) return sub;
  if (read && new RegExp(`^/api/jobs/${JOB}/video$`).test(sub)) return sub;
  if (read && new RegExp(`^/api/results/${JOB}$`).test(sub)) return sub;
  return null;
}

function configured(env: AnalyzeEnv): { origin: string; token: string } | null {
  const origin = (env.ANALYZER_ORIGIN || '').trim().replace(/\/+$/, '');
  const token = (env.ANALYZER_TOKEN || '').trim();
  return origin && token ? { origin, token } : null;
}

async function upstream(
  env: AnalyzeEnv,
  path: string,
  init: { method: string; headers?: Headers; body?: ReadableStream | null; timeoutMs?: number },
): Promise<Response | null> {
  const cfg = configured(env);
  if (!cfg) return null;
  const headers = init.headers || new Headers();
  headers.set('X-Access-Token', cfg.token);
  try {
    return await fetch(`${cfg.origin}${path}`, {
      method: init.method,
      headers,
      body: init.body ?? undefined,
      redirect: 'manual',
      signal: init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined,
    });
  } catch (err) {
    console.log(JSON.stringify({ analyze: 'upstream-error', path, error: String(err) }));
    return null;
  }
}

function isJson(res: Response): boolean {
  return (res.headers.get('Content-Type') || '').includes('application/json');
}

/** Tunnel down (Cloudflare 1033/530), connector up but server down (502), gate mismatch (401 from the origin). */
function looksOffline(res: Response | null): boolean {
  if (!res) return true;
  if (res.status === 401 || res.status === 403) return true;
  return res.status >= 500 && !isJson(res);
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const PASS_HEADERS = [
  'Content-Type',
  'Content-Length',
  'Content-Range',
  'Accept-Ranges',
  'ETag',
  'Last-Modified',
  'Content-Disposition',
];
const FORWARD_HEADERS = ['Content-Type', 'Range', 'If-Range', 'If-None-Match', 'If-Modified-Since', 'Accept'];

/** Proxy one /analyze/* request (not the page itself). Caller has already checked the member session. */
export async function analyzeProxy(request: Request, env: AnalyzeEnv, sub: string): Promise<Response> {
  const method = request.method.toUpperCase();
  const target = upstreamPath(method, sub);
  if (!target) return jsonError(404, 'Not found.');
  const url = new URL(request.url);
  const query = new URLSearchParams(url.search);
  query.delete('key');
  const qs = query.toString();

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  // Cookies and the portal session never go to the analyzer.
  const isUpload = method === 'POST';
  const res = await upstream(env, target + (qs ? `?${qs}` : ''), {
    method,
    headers,
    body: isUpload ? request.body : null,
    timeoutMs: isUpload || target.endsWith('/video') ? undefined : API_TIMEOUT_MS,
  });
  if (looksOffline(res)) {
    if (res) console.log(JSON.stringify({ analyze: 'offline', path: target, status: res.status }));
    return target.startsWith('/static/')
      ? new Response('/* analyzer offline */', { status: 503, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })
      : jsonError(503, OFFLINE);
  }
  const upstreamRes = res as Response;
  const out = new Headers();
  for (const name of PASS_HEADERS) {
    const v = upstreamRes.headers.get(name);
    if (v) out.set(name, v);
  }
  out.set('X-Content-Type-Options', 'nosniff');
  if (target.startsWith('/static/')) {
    out.set('Cache-Control', 'private, no-cache');
    if (/\.m?js$/.test(target) && upstreamRes.ok) {
      const code = rewriteJs(await upstreamRes.text());
      out.delete('Content-Length');
      out.delete('ETag');
      out.set('Content-Type', 'text/javascript; charset=utf-8');
      return new Response(method === 'HEAD' ? null : code, { status: upstreamRes.status, headers: out });
    }
  } else {
    out.set('Cache-Control', 'private, no-store');
  }
  return new Response(method === 'HEAD' ? null : upstreamRes.body, { status: upstreamRes.status, headers: out });
}

/** The analyzer's frontend calls absolute /api/... URLs. Inside the portal they live under /analyze/api/. */
export function rewriteJs(code: string): string {
  return code.replace(/(["'`])\/api\//g, `$1${ANALYZE_PREFIX}/api/`);
}

/** Pull the analyzer's <main> markup out of its index.html. */
export function extractMain(doc: string): string | null {
  const m = doc.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
  return m ? m[1] : null;
}

export async function analyzePage(env: AnalyzeEnv, base: string, user: Person, path: string): Promise<Response> {
  const res = await upstream(env, '/', { method: 'GET', timeoutMs: PAGE_TIMEOUT_MS });
  let inner: string | null = null;
  if (res && res.ok && (res.headers.get('Content-Type') || '').includes('text/html')) {
    inner = extractMain(await res.text());
  } else if (res) {
    console.log(JSON.stringify({ analyze: 'page-offline', status: res.status }));
  }
  const headers = { 'Permissions-Policy': 'camera=(self), microphone=(self), fullscreen=(self)' };
  if (!inner) return html(analyzeOffline(base, user, path), 503, { ...headers, 'Retry-After': '120' });
  const body = `<style>${ANALYZE_CSS}</style>
<div id="analyze" class="az">${inner}</div>`;
  const scripts = `<script type="module" src="${base}${ANALYZE_PREFIX}/static/app.js"></script>`;
  return html(shell({ title: 'Analyze | Stick It Out', base, kind: 'member', path, user, body, scripts }), 200, headers);
}

export function analyzeOffline(base: string, user: Person, path: string): string {
  const body = `<style>${ANALYZE_CSS}</style>
<div class="az">
  <section class="card az-offline" role="status">
    <svg class="az-offline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h3l2-5 3 10 3-7 2 4h5"/><path d="M4 4l16 16"/></svg>
    <h1>Analyze</h1>
    <p class="az-offline-msg">${OFFLINE}</p>
    <p class="muted">The analyzer runs on the Stick It Out studio computer. When it is back on, this tab works again. Nothing you did caused this.</p>
    <p><a class="btn primary" href="${base}${ANALYZE_PREFIX}">Try again</a></p>
  </section>
</div>`;
  return shell({ title: 'Analyze | Stick It Out', base, kind: 'member', path, user, body });
}

/** Portal-native (dark) styling for the analyzer markup. Scoped to .az; uses the portal CSS variables. */
export const ANALYZE_CSS = `
.az { --ok: #4cd486; --warn: var(--gel); --bad: #ef8f80; min-width: 0; overflow-wrap: break-word; }
.az [hidden] { display: none !important; }
.az * { min-width: 0; }
.az .card { background: var(--wings); border: 1px solid var(--line); border-radius: var(--radius); padding: 1.15rem 1.2rem; margin: 0 0 1rem; }
.az h1 { font-size: clamp(2.2rem, 8vw, 3rem); line-height: 0.92; margin: 0 0 0.55rem; }
.az h2 { font-size: 1.55rem; line-height: 1; margin: 0 0 0.75rem; color: var(--cue); }
.az p { line-height: 1.5; margin: 0.5rem 0 0; }
.az .muted { color: var(--chrome); }
.az .small { font-size: 0.86rem; }
.az .center { text-align: center; }
.az a { color: var(--gel); }
/* Staff-only analyzer tools stay off the member portal (their routes are not proxied). */
.az .training-guide, .az #add-training, .az #add-training-msg, .az #json-link { display: none !important; }
.az #results.no-charts .chart-card { display: none; }

/* Mode switch: two big segments. */
.az .mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 100%; max-width: 28rem; margin: 1rem 0 1.1rem;
  padding: 4px; background: var(--blackout); border: 1px solid var(--line); border-radius: 99px; }
.az .mode { min-height: 48px; border: 0; border-radius: 99px; background: transparent; color: var(--chrome); cursor: pointer;
  font: inherit; font-weight: 700; font-size: 0.9rem; letter-spacing: 0.06em; text-transform: uppercase; }
.az .mode.active { background: var(--gel); color: var(--on-gel); }

/* Params */
.az .params { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.85rem; margin: 0 0 1rem; }
@media (min-width: 640px) { .az .params { grid-template-columns: 1fr 1fr; } .az .advanced { grid-column: 1 / -1; } }
.az .params > label, .az .advanced label { display: grid; gap: 0.4rem; margin: 0; }
.az .params input { min-height: 48px; }
.az .advanced summary { min-height: var(--touch); display: flex; align-items: center; cursor: pointer; color: var(--chrome);
  font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; }
.az .advanced[open] { display: grid; gap: 0.8rem; }
@media (min-width: 640px) { .az .advanced[open] { grid-template-columns: 1fr 1fr; } .az .advanced summary { grid-column: 1 / -1; } }

/* Buttons: portal .btn; plain analyzer buttons become ghost buttons. */
.az .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0.6rem 1.15rem;
  background: transparent; color: var(--cue); border: 1px solid rgba(154, 163, 173, 0.35); border-radius: var(--radius);
  font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
.az .btn.primary { background: var(--gel); color: var(--on-gel); border-color: var(--gel); }
.az .btn.danger { background: #b8483a; color: #fff; border-color: #b8483a; }
.az .btn:disabled { opacity: 0.45; cursor: not-allowed; }
.az .controls { display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; align-items: center; margin-top: 0.8rem; }
.az .controls select { width: auto; max-width: 100%; min-height: 48px; }
.az label.check { display: inline-flex; align-items: center; gap: 0.55rem; min-height: var(--touch); margin: 0;
  font-size: 0.95rem; color: var(--cue); letter-spacing: 0; text-transform: none; }
.az .check input { width: 22px; height: 22px; margin: 0; accent-color: var(--gel); flex: 0 0 auto; }

/* Camera stage */
.az .stage { position: relative; background: #000; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; aspect-ratio: 16 / 9; }
.az .stage video, .az .stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.az .stage canvas { pointer-events: none; }
.az .stage.mirrored video, .az .stage.mirrored canvas { transform: scaleX(-1); }
.az .stage-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.9rem; padding: 1.2rem; text-align: center; color: var(--cue);
  background: radial-gradient(120% 120% at 50% 0%, rgba(232, 163, 23, 0.12) 0%, transparent 60%), #0a0908; }
.az .stage-empty p { margin: 0; max-width: 26rem; color: var(--chrome); font-size: 0.95rem; }
.az .hud { position: absolute; top: 0.6rem; left: 0.6rem; right: 0.6rem; display: flex; gap: 0.4rem; flex-wrap: wrap; }
.az .hud .pill { min-height: 26px; padding: 0 0.6rem; border: 0; border-radius: 99px; background: rgba(12, 11, 10, 0.78);
  color: var(--cue); font-size: 0.78rem; }
.az .hud .pill:empty { display: none; }
.az .hud .pill.warn { background: var(--gel); color: var(--on-gel); }
.az .hud .pill.good { background: #1f7a45; color: #fff; }
.az .hud .pill.rec { background: #c0392b; color: #fff; font-weight: 700; }
/* Live fps badge: green at 60 fps, brand accent under 50, red when too low to analyse. */
.az .hud .pill.fps-badge { min-height: 32px; padding: 0 0.8rem; font-size: 0.95rem; font-weight: 700; display: inline-flex; align-items: center; }
.az .hud .pill.fps-badge.good { background: #1f7a45; color: #fff; }
.az .hud .pill.fps-badge.warn { background: var(--gel); color: var(--on-gel); }
.az .hud .pill.fps-badge.bad { background: #c0392b; color: #fff; }
.az .hud .pill.fps-badge.idle { background: rgba(12, 11, 10, 0.78); color: var(--cue); }
/* Camera picker above the preview */
.az .cam-bar { display: flex; align-items: center; gap: 0.6rem; margin: 0 0 0.7rem; }
.az .cam-bar[hidden], .az #cam-flip[hidden] { display: none; }
.az .cam-bar label { margin: 0; flex: 0 0 auto; }
.az .cam-bar select { flex: 1 1 auto; min-width: 0; width: auto; min-height: 48px; }
.az .cam-bar .btn { flex: 0 0 auto; min-height: 48px; padding: 0 1rem; }
.az .saved-fps { margin-bottom: 0.4rem; font-size: 0.9rem; color: var(--chrome); }
.az .saved-fps b { color: var(--cue); } .az .saved-fps.good b { color: var(--ok); } .az .saved-fps.warn b { color: var(--gel); }
/* 60 fps capture: no blur layers over the live preview on this page. A backdrop-filter on the
   sticky top bar and the fixed dock re-blurs every camera frame the video scrolls under, which
   costs phone GPUs frames. Solid bars look the same on this dark page. */
header.bar, body.kind-member .dock { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; background: #0c0b0a !important; }
.az .stage { contain: paint; }
.az .countdown { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-family: "Bebas Neue", system-ui, sans-serif; font-size: 8rem; color: var(--gel); text-shadow: 0 4px 24px #000; }
@media (orientation: portrait) and (max-width: 640px) { .az #stage { aspect-ratio: 3 / 4; max-height: 64svh; margin-inline: auto; } }
.az .hint { font-size: 0.88rem; }
.az .tip { margin: 0.8rem 0 0; padding: 0.65rem 0.8rem; border-radius: 10px; font-size: 0.9rem; color: var(--cue);
  background: rgba(232, 163, 23, 0.08); border-left: 3px solid var(--gel); }
.az .tip b { color: var(--gel); }
.az .notice { margin-top: 0.8rem; padding: 0.75rem 0.9rem; border-radius: 10px; color: var(--cue); background: rgba(242, 235, 227, 0.06);
  border-left: 4px solid var(--chrome); }
.az .notice.ok { border-left-color: var(--ok); background: rgba(76, 212, 134, 0.1); }
.az .notice.warn { border-left-color: var(--gel); background: rgba(232, 163, 23, 0.12); }
.az .notice.bad { border-left-color: var(--bad); background: rgba(239, 143, 128, 0.12); }
.az .take { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.9rem; margin-top: 1rem; }
@media (min-width: 720px) { .az .take { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.az .take video { width: 100%; max-height: 60svh; border-radius: 10px; background: #000; }

/* Upload */
.az .drop { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 9.5rem; margin: 0 0 0.9rem;
  padding: 1.6rem 1rem; text-align: center; cursor: pointer; border: 2px dashed rgba(232, 163, 23, 0.45); border-radius: var(--radius);
  background: rgba(232, 163, 23, 0.05); color: var(--cue); font-size: 1rem; letter-spacing: 0; text-transform: none; }
.az .drop strong { color: var(--gel); font-size: 1.1rem; }
.az .drop.over { border-color: var(--gel); background: rgba(232, 163, 23, 0.12); }
.az .drop input { display: none; }
.az #upload-btn { width: 100%; margin-top: 0.9rem; font-size: 1.05rem; }
@media (min-width: 640px) { .az #upload-btn { width: auto; min-width: 14rem; } }

/* Progress */
.az .progress { margin-top: 1rem; }
.az .bar { position: static; min-height: 0; height: 12px; padding: 0; border: 0; background: var(--blackout); border-radius: 99px; overflow: hidden;
  backdrop-filter: none; display: block; }
.az #bar-fill { height: 100%; width: 0; background: linear-gradient(90deg, var(--gel), var(--gel-deep)); transition: width 0.3s; }

/* Results: Verified box */
.az .verified-card { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.8rem; align-items: center;
  border-color: rgba(232, 163, 23, 0.4);
  background: radial-gradient(120% 140% at 88% 12%, rgba(232, 163, 23, 0.14) 0%, transparent 58%), var(--wings); }
@media (min-width: 640px) { .az .verified-card { grid-template-columns: auto minmax(0, 1fr); gap: 1.4rem; } }
.az .verified-card .label { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--chrome); }
.az .verified-card .big { font-family: "Bebas Neue", system-ui, sans-serif; font-size: clamp(3.4rem, 16vw, 4.6rem); line-height: 0.9; color: var(--gel); }
.az .verified-card .est { margin-top: 0.2rem; font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gel); }
.az .verified-card > div:last-child { font-size: 0.92rem; line-height: 1.45; color: var(--cue); }
.az .verified-card b { color: var(--gel); }
.az .vcounts { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 0.6rem; }
.az .vcounts > span { padding: 0.25rem 0.6rem; border-radius: 99px; background: var(--blackout); border: 1px solid var(--line); font-size: 0.82rem; }
/* 30 fps disclaimer: brand-accent warning, readable on dark. */
.az .lowfps-notice { grid-column: 1 / -1; display: grid; gap: 0.2rem; padding: 0.75rem 0.9rem; border-radius: 10px;
  background: rgba(232, 163, 23, 0.14); border: 1px solid rgba(232, 163, 23, 0.35); border-left: 5px solid var(--gel);
  color: var(--cue); font-size: 0.95rem; line-height: 1.45; }
.az .lowfps-notice b { color: var(--gel); font-size: 0.78rem; letter-spacing: 0.1em; text-transform: uppercase; }

/* Score rings: big Overall on the left, the other four in a 2 x 2 grid on phones. */
.az .dials { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0.6rem; align-items: start; }
.az .dial { text-align: center; }
.az .dial svg { width: 100%; max-width: 104px; height: auto; display: block; margin: 0 auto; }
.az .dial .name { margin-top: 0.25rem; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--cue); }
.az .dial .why { font-size: 0.72rem; color: var(--chrome); line-height: 1.3; }
.az .dial svg text { fill: var(--cue); font-family: "Bebas Neue", system-ui, sans-serif; font-size: 32px; font-weight: 400; }
.az .dial circle[stroke="#eee6cf"] { stroke: rgba(242, 235, 227, 0.12); }
.az .dial circle[stroke="#1f9d55"] { stroke: var(--ok); }
.az .dial circle[stroke="#d69e00"] { stroke: var(--gel); }
.az .dial circle[stroke="#d64545"] { stroke: var(--bad); }
.az .dial circle[stroke="#ccc"] { stroke: var(--chrome); }
.az .dial.overall .name { color: var(--gel); }
@media (max-width: 560px) {
  .az .dials { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr); gap: 0.55rem 0.5rem; }
  .az .dial.overall { grid-column: 1; grid-row: 1 / span 2; align-self: center; }
  .az .dial svg { max-width: 74px; }
  .az .dial.overall svg { max-width: 118px; }
  .az .dial .name { font-size: 0.7rem; letter-spacing: 0.03em; }
}
/* Stat tiles */
.az .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.5rem; margin-top: 1rem; }
.az .stat { display: flex; flex-direction: column-reverse; justify-content: flex-end; gap: 0.15rem; padding: 0.6rem 0.7rem;
  background: var(--blackout); border: 1px solid var(--line); border-radius: 10px; }
.az .stat b { font-size: 0.98rem; font-weight: 700; color: var(--cue); line-height: 1.25; overflow-wrap: anywhere; }
.az .stat span { font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--chrome); line-height: 1.25; }
@media (max-width: 560px) { .az .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* Playback: the video fits the screen. */
.az .playback-card { padding: 0.9rem; }
.az .stage.playback { aspect-ratio: auto; min-height: 0; }
.az .stage.playback video { position: relative; display: block; width: 100%; height: auto; max-height: 72svh; background: #000; }
.az .playback-card .check { margin-top: 0.4rem; }

/* Sticking, hands, stroke table */
.az .grid2 { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; margin-bottom: 1rem; }
@media (min-width: 760px) { .az .grid2 { grid-template-columns: 1fr 1fr; } }
.az .grid2 .card { margin-bottom: 0; }
.az .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; max-width: 100%; }
.az table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.az th, .az td { padding: 0.5rem 0.45rem; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
.az th { color: var(--chrome); font-weight: 600; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; }
.az th:first-child, .az td:first-child { text-align: left; }
.az tr.wrong td { background: rgba(239, 143, 128, 0.1); }
.az td[style*="#1f9d55"] { color: var(--ok) !important; }
.az td[style*="#d69e00"] { color: var(--gel) !important; }
.az td[style*="#d64545"] { color: var(--bad) !important; }
.az .tag { display: inline-block; min-height: 0; border: 0; padding: 0.1rem 0.5rem; border-radius: 99px; font-size: 0.74rem; }
.az .tag.verified { background: rgba(76, 212, 134, 0.14); color: var(--ok); }
.az .tag.unverified { background: rgba(232, 163, 23, 0.14); color: var(--gel); }
.az .breaks { margin: 0.5rem 0 0; padding-left: 1.2rem; max-height: 14rem; overflow: auto; font-size: 0.9rem; }
.az #more-strokes { margin-top: 0.8rem; }
.az .how summary { cursor: pointer; list-style: none; min-height: var(--touch); display: flex; align-items: center; }
.az .how summary::-webkit-details-marker { display: none; }
.az .how summary h2 { margin: 0; }
.az .how summary h2::after { content: " +"; color: var(--gel); }
.az .how[open] summary h2::after { content: " -"; }
.az .how code { background: var(--blackout); color: var(--gel); padding: 0.1rem 0.35rem; border-radius: 5px; font-size: 0.82rem; overflow-wrap: anywhere; }
.az .how li { margin-bottom: 0.5rem; line-height: 1.5; }
.az .k { padding: 0.05rem 0.4rem; border-radius: 5px; color: var(--on-gel); }
.az .k.good { background: var(--ok); } .az .k.mid { background: var(--gel); } .az .k.badk { background: var(--bad); }
.az p.center { display: flex; flex-wrap: wrap; gap: 0.6rem; justify-content: center; }
@media (max-width: 560px) { .az #again { width: 100%; } }

/* Offline */
.az-offline { text-align: center; padding: 2.2rem 1.2rem; border-color: rgba(232, 163, 23, 0.35); }
.az-offline-icon { width: 56px; height: 56px; color: var(--gel); margin: 0 auto 0.6rem; display: block; }
.az-offline-msg { font-size: 1.15rem; font-weight: 700; color: var(--cue); }
.az-offline .btn { margin-top: 0.9rem; min-width: 12rem; }
@media (max-width: 840px) {
  .az .card { padding: 1rem; }
}
`;
