// End-to-end check of the portal Analyze tab. Usage:
//   node analyze-e2e.mjs <base> <video> [--cookie sio_member=...] [--local-login email] [--token-file path]
import fs from 'node:fs';
const args = process.argv.slice(2);
const base = args[0];
const video = args[1];
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const jar = new Map();
if (opt('--cookie')) { const [k, v] = opt('--cookie').split('='); jar.set(k, v); }
const secret = opt('--token-file') ? fs.readFileSync(opt('--token-file'), 'utf8').trim() : null;
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function store(res) { for (const c of res.headers.getSetCookie?.() || []) { const [p] = c.split(';'); const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1)); } }
async function req(path, opts = {}, withCookie = true) {
  const { headers = {}, ...rest } = opts;
  const res = await fetch(path.startsWith('http') ? path : base + path, { redirect: 'manual', ...rest, headers: { ...(withCookie ? { cookie: cookieHeader() } : {}), ...headers } });
  store(res);
  return res;
}
const out = [];
const check = (name, ok, extra = '') => { out.push({ name, ok: Boolean(ok), extra }); };
const leaks = (text) => secret && text.includes(secret);

// Anonymous checks
let r = await req('/analyze', {}, false);
check('anon /analyze redirects to login', [302, 303].includes(r.status) && /\/login/.test(r.headers.get('location') || ''), `${r.status} ${r.headers.get('location')}`);
r = await req('/analyze/api/config', {}, false);
check('anon /analyze/api/config is 401', r.status === 401, String(r.status));
r = await req('/analyze/static/app.js', {}, false);
check('anon /analyze/static/app.js is 401', r.status === 401, String(r.status));
r = await req('/api/health', {}, false);
const health = await r.text();
check('/api/health ok', r.status === 200 && /"ok":true/.test(health), health);

if (opt('--local-login')) {
  const email = opt('--local-login');
  const sent = await req('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${encodeURIComponent(email)}` });
  const t = await sent.text();
  const link = t.match(/Local link: (http[^\s<]+)/)?.[1];
  check('local magic link', Boolean(link));
  await req(link.replace('http://127.0.0.1:8787', base));
  await req('/profile', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Analyze+Tester&kit=Practice+pad&level=intermediate' });
}

// Page
r = await req('/analyze');
const page = await r.text();
check('member /analyze 200', r.status === 200, String(r.status));
check('page has analyzer markup', /id="params"/.test(page) && /id="results"/.test(page) && /id="upload-pane"/.test(page));
check('nav shows Analyze', />Analyze</.test(page) && /href="\/analyze"/.test(page));
check('nav hides Challenges', !/href="\/challenges"/.test(page));
check('page loads proxied app.js', /\/analyze\/static\/app\.js/.test(page));
check('Permissions-Policy camera self', /camera=\(self\)/.test(r.headers.get('permissions-policy') || ''), r.headers.get('permissions-policy'));
check('page has no key', !leaks(page));
check('page has no em dash', !page.includes('\u2014'));
r = await req('/');
const home = await r.text();
check('home nav shows Analyze, no Challenges tab', /<span>Analyze<\/span>/.test(home) && !/<span>Challenges<\/span>/.test(home));
r = await req('/challenges');
check('/challenges route still reachable', r.status === 200, String(r.status));

// Static JS through proxy
for (const f of ['app.js', 'record.js', 'skeleton.js']) {
  r = await req(`/analyze/static/${f}`);
  const js = await r.text();
  check(`static ${f} 200`, r.status === 200, `${r.status} ${js.length}b`);
  check(`static ${f} no key`, !leaks(js));
  if (f === 'app.js') check('app.js rewritten to /analyze/api/', js.includes('"/analyze/api/config"') && !/(["'`])\/api\//.test(js));
}
r = await req('/analyze/static/label.js');
check('label.js blocked', r.status === 404, String(r.status));
r = await req('/analyze/label');
check('/analyze/label blocked', r.status === 404, String(r.status));
r = await req('/analyze/api/dataset/from-job/0123456789abcdef0123456789abcdef', { method: 'POST' });
check('dataset intake blocked', r.status === 404, String(r.status));
r = await req('/analyze/api/config?key=nope');
const cfgText = await r.text();
check('config via proxy', r.status === 200 && /max_upload_mb/.test(cfgText), cfgText);
check('config no set-cookie', !r.headers.get('set-cookie'));

// Upload
if (video) {
  const buf = fs.readFileSync(video);
  const fd = new FormData();
  fd.append('rudiment', 'Single Paradiddle');
  fd.append('target_bpm', '100');
  fd.append('video', new Blob([buf], { type: 'video/mp4' }), video.split(/[\\/]/).pop());
  const t0 = Date.now();
  r = await req('/analyze/api/analyze', { method: 'POST', body: fd, headers: { origin: opt('--origin') || base } });
  const upText = await r.text();
  let up = {};
  try { up = JSON.parse(upText); } catch { up = { raw: upText.slice(0, 200) }; }
  check('upload 202 via proxy', r.status === 202 && up.job_id, `${r.status} ${JSON.stringify(up)}`);
  if (up.job_id) {
    let job;
    for (let i = 0; i < 240; i++) {
      r = await req(`/analyze/api/jobs/${up.job_id}`);
      job = await r.json();
      if (job.status === 'done' || job.status === 'error') break;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    check('job done', job.status === 'done', JSON.stringify(job));
    r = await req(`/analyze/api/results/${up.job_id}`);
    const rep = await r.json();
    check('results via proxy', r.status === 200 && rep.scores, `verified=${rep.scores?.verified} overall=${rep.scores?.overall} fps=${rep.source?.fps} low_fps=${rep.quality?.low_fps}`);
    check('results no key', !leaks(JSON.stringify(rep)));
    r = await req(`/analyze/api/jobs/${up.job_id}/video`, { headers: { range: 'bytes=0-1023' } });
    const vb = await r.arrayBuffer();
    check('video range 206 via proxy', r.status === 206 && vb.byteLength === 1024, `${r.status} ${r.headers.get('content-range')} ${r.headers.get('content-type')}`);
    r = await req(`/analyze/api/jobs/${up.job_id}/video`);
    const full = await r.arrayBuffer();
    check('video full via proxy', r.status === 200 && full.byteLength === buf.length, `${r.status} ${full.byteLength}`);
    out.push({ name: 'job', ok: true, extra: `${up.job_id} in ${((Date.now() - t0) / 1000).toFixed(1)} s` });
  }
}
console.log(JSON.stringify(out, null, 1));
console.log(out.every((o) => o.ok) ? 'ALL OK' : 'FAILURES: ' + out.filter((o) => !o.ok).map((o) => o.name).join(', '));
