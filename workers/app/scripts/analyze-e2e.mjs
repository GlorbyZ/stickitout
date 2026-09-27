// End-to-end check of the portal Analyze tab. Usage:
//   node analyze-e2e.mjs <base> <video> [--cookie sio_member=...] [--local-login email] [--token-file path]
//        [--resumable N]  resumable piece upload in N MB pieces, with a dropped piece, reload-resume and duplicate
//        [--expect-fps N] check the measured fps of the saved video
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
check('page has coaching section above scores', /id="coaching"/.test(page) && page.indexOf('id="coaching"') < page.indexOf('id="dials"'));
r = await req('/');
const home = await r.text();
check('home nav shows Analyze, no Challenges tab', /<span>Analyze<\/span>/.test(home) && !/<span>Challenges<\/span>/.test(home));
r = await req('/challenges');
check('/challenges route still reachable', r.status === 200, String(r.status));

// Static JS through proxy
for (const f of ['app.js', 'record.js', 'skeleton.js', 'camera.js', 'overlay.js', 'pose-engine.js', 'pose-worker.js']) {
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
  const origin = { origin: opt('--origin') || base };
  let up = {};
  if (opt('--resumable')) {
    // Resumable piece upload: a dropped connection mid-piece, a damaged piece, a reload that
    // resumes from the server's list, a duplicate piece, and finish sent twice.
    const { createHash } = await import('node:crypto');
    const sha = (b) => createHash('sha256').update(b).digest('hex');
    const sf = new FormData();
    sf.append('filename', video.split(/[\\/]/).pop());
    sf.append('size', String(buf.length));
    sf.append('piece_bytes', String(Math.round(Number(opt('--resumable')) * 1048576)));
    r = await req('/analyze/api/uploads', { method: 'POST', body: sf, headers: origin });
    const st = await r.json().catch(() => ({}));
    check('upload start 201 via proxy', r.status === 201 && st.upload_id && st.pieces >= 3, `${r.status} ${JSON.stringify(st)}`);
    const id = st.upload_id, step = st.piece_bytes, n = st.pieces || 0;
    const piece = (i) => buf.subarray(i * step, Math.min(buf.length, (i + 1) * step));
    const put = (i, body, sum) => req(`/analyze/api/uploads/${id}/pieces/${i}?sha256=${sum || sha(piece(i))}`, { method: 'PUT', body: body ?? piece(i), headers: origin });
    const half = Math.floor(n / 2);
    let okCount = 0;
    for (let i = 0; i < half; i++) if ((await put(i)).status === 200) okCount++;
    check('first half of pieces 200', okCount === half, `${okCount}/${half}`);
    // connection killed halfway through a piece
    let dropped = 'no error';
    try {
      const part = piece(half);
      const stream = new ReadableStream({ start(c) { c.enqueue(part.subarray(0, part.length >> 1)); setTimeout(() => c.error(new Error('drop')), 300); } });
      const dr = await fetch(`${base}/analyze/api/uploads/${id}/pieces/${half}?sha256=${sha(part)}`, { method: 'PUT', body: stream, duplex: 'half', headers: { cookie: cookieHeader(), ...origin } });
      dropped = `status ${dr.status}`;
    } catch (e) { dropped = `fetch failed (${e.cause?.message || e.message})`; }
    r = await put(half, piece(half).subarray(0, 1000));
    const cut = r.status;
    r = await put(half, undefined, '0'.repeat(64));
    const bad = r.status;
    // "reload": ask the server which pieces it has
    r = await req(`/analyze/api/uploads/${id}`);
    const s1 = await r.json().catch(() => ({}));
    check('dropped, cut-off and damaged pieces not stored', r.status === 200 && Array.isArray(s1.have) && s1.have.length === half && !s1.have.includes(half) && cut === 400 && bad === 400,
      `drop: ${dropped}; cut ${cut}; bad checksum ${bad}; have ${JSON.stringify(s1.have)}`);
    r = await req(`/analyze/api/uploads/${id}/finish`, { method: 'POST', body: new FormData(), headers: origin });
    const early = await r.json().catch(() => ({}));
    check('finish with missing pieces is 409', r.status === 409 && early.missing?.length === n - half, `${r.status} missing ${early.missing?.length}`);
    let resumed = 0;
    for (let i = 0; i < n; i++) if (!s1.have.includes(i) && (await put(i)).status === 200) resumed++;
    check('resume sends only the missing pieces', resumed === n - half, `${resumed} of ${n} pieces after reload`);
    r = await put(0);
    check('duplicate piece accepted', r.status === 200, String(r.status));
    r = await req(`/analyze/api/uploads/${id}`);
    const s2 = await r.json().catch(() => ({}));
    check('status complete', s2.complete === true && s2.have.length === n, JSON.stringify(s2).slice(0, 160));
    const ff = new FormData();
    ff.append('rudiment', 'Single Paradiddle');
    ff.append('target_bpm', '100');
    r = await req(`/analyze/api/uploads/${id}/finish`, { method: 'POST', body: ff, headers: origin });
    up = await r.json().catch(() => ({}));
    check('finish 202 via proxy', r.status === 202 && up.job_id === id, `${r.status} ${JSON.stringify(up)}`);
    r = await req(`/analyze/api/uploads/${id}/finish`, { method: 'POST', body: ff, headers: origin });
    const again = await r.json().catch(() => ({}));
    check('finish again returns the same job', r.status === 202 && again.job_id === id, `${r.status} ${JSON.stringify(again)}`);
  } else {
    r = await req('/analyze/api/analyze', { method: 'POST', body: fd, headers: origin });
    const upText = await r.text();
    try { up = JSON.parse(upText); } catch { up = { raw: upText.slice(0, 200) }; }
    check('upload 202 via proxy', r.status === 202 && up.job_id, `${r.status} ${JSON.stringify(up)}`);
  }
  if (opt('--expect-fps')) check('saved fps as expected', Math.abs((up.fps || 0) - Number(opt('--expect-fps'))) < 2, `fps=${up.fps} slow_motion=${up.slow_motion}`);
  if (up.job_id) {
    let job;
    for (let i = 0; i < 900; i++) {
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
    const co = rep.coaching || {};
    check('results include coaching', co.version >= 1 && ['ok', 'not_enough_data'].includes(co.status) && Array.isArray(co.findings) && Array.isArray(co.strengths) && typeof (co.focus || co.message) === 'string',
      `status=${co.status} findings=${(co.findings || []).map((f) => f.severity + ':' + f.id).join(',')} strengths=${(co.strengths || []).map((x) => x.id).join(',')}`);
    check('coaching has no em dash', !JSON.stringify(co).includes('\u2014'));
    r = await req(`/analyze/api/jobs/${up.job_id}/video`, { headers: { range: 'bytes=0-1023' } });
    const vb = await r.arrayBuffer();
    check('video range 206 via proxy', r.status === 206 && vb.byteLength === 1024, `${r.status} ${r.headers.get('content-range')} ${r.headers.get('content-type')}`);
    r = await req(`/analyze/api/jobs/${up.job_id}/video`);
    const full = await r.arrayBuffer();
    check('video full via proxy', r.status === 200 && full.byteLength === buf.length, `${r.status} ${full.byteLength}`);
    r = await req(`/analyze/api/jobs/${up.job_id}/landmarks`);
    const lm = r.status === 200 ? await r.json() : null;
    check('per-frame landmarks via proxy', lm && lm.t.length === lm.pose.length && lm.t.length > 0 && lm.pts_source === 'packets',
      lm ? `${lm.t.length} frames, first pts ${lm.t[0]}, pose ${lm.stats.pose_rate}, two hands ${lm.stats.two_hands_rate}` : String(r.status));
    out.push({ name: 'job', ok: true, extra: `${up.job_id} in ${((Date.now() - t0) / 1000).toFixed(1)} s` });
  }
}
console.log(JSON.stringify(out, null, 1));
console.log(out.every((o) => o.ok) ? 'ALL OK' : 'FAILURES: ' + out.filter((o) => !o.ok).map((o) => o.name).join(', '));
