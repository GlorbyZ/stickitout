const jar = new Map();

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() || [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

async function req(url, opts = {}) {
  const { headers: extra = {}, ...rest } = opts;
  const res = await fetch(url, {
    redirect: 'manual',
    ...rest,
    headers: { cookie: cookieHeader(), ...extra },
  });
  storeCookies(res);
  const text = await res.text();
  return { status: res.status, location: res.headers.get('location'), text };
}

const base = 'http://127.0.0.1:8787';
const out = [];

const login = await req(`${base}/login`);
out.push(['GET /login', login.status, /Log in/.test(login.text)]);

const sent = await req(`${base}/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'email=waitlist%40example.com',
});
const memberLink = sent.text.match(/Local link: (http[^\s<]+)/)?.[1] || sent.text.match(/token=([a-f0-9]+)/)?.[0];
out.push(['POST /login member', sent.status, Boolean(memberLink), memberLink?.slice(0, 60)]);

const cb = await req(memberLink.includes('http') ? memberLink : `${base}/auth/callback?${memberLink}`);
out.push(['member callback', cb.status, cb.location]);

const home = await req(`${base}/`);
out.push(['GET /', home.status, /founding waitlist/.test(home.text), /No lesson published yet/.test(home.text)]);

const lib = await req(`${base}/library`);
out.push(['GET /library', lib.status, /founding waitlist/.test(lib.text)]);

const prof = await req(`${base}/profile`);
out.push(['GET /profile', prof.status, /waitlist/.test(prof.text), /Billing portal coming soon/.test(prof.text)]);

jar.clear();
const adminDeny = await req(`${base}/_admin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'email=random%40example.com',
});
out.push(['admin deny', adminDeny.status, /not on the admin allowlist/.test(adminDeny.text)]);

const adminSent = await req(`${base}/_admin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'email=zaylynbyoung%40gmail.com',
});
const adminLink = adminSent.text.match(/Local link: (http[^\s<]+)/)?.[1];
out.push(['admin login mail', adminSent.status, Boolean(adminLink)]);

const adminCb = await req(adminLink);
out.push(['admin callback', adminCb.status, adminCb.location]);

const dash = await req(`${base}/_admin/`);
out.push(['admin dash', dash.status, /Waitlist/.test(dash.text), /Unpublished lessons/.test(dash.text)]);

const members = await req(`${base}/_admin/members`);
out.push(['admin members', members.status, /waitlist@example.com/.test(members.text)]);

const lessons = await req(`${base}/_admin/lessons`);
out.push(['admin lessons', lessons.status, /No lessons yet/.test(lessons.text)]);

const created = await req(`${base}/_admin/lessons`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'title=Paradiddle+warmup&week_index=1&video_url=',
});
out.push(['create lesson', created.status, created.location]);

const list2 = await req(`${base}/_admin/lessons`);
const lessonId = list2.text.match(/action="[^"]*\/lessons\/([0-9a-f-]+)"/)?.[1];
out.push(['lesson id', Boolean(lessonId), lessonId]);

const pub = await req(`${base}/_admin/lessons/${lessonId}`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'action=toggle',
});
out.push(['publish lesson', pub.status, pub.location]);

const ch = await req(`${base}/_admin/challenges`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'title=Stick+control&prompt=Play+slow',
});
out.push(['create challenge', ch.status, ch.location]);

const fin = await req(`${base}/_admin/financials`);
out.push(['financials', fin.status, /Stripe not connected/.test(fin.text)]);

const personId = members.text.match(/action="[^"]*\/members\/([0-9a-f-]+)"/)?.[1];
if (personId) {
  const mark = await req(`${base}/_admin/members/${personId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'status=founding&plan=monthly',
  });
  out.push(['mark founding', mark.status, mark.location]);
}

jar.clear();
const sent2 = await req(`${base}/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'email=waitlist%40example.com',
});
const memberLink2 = sent2.text.match(/Local link: (http[^\s<]+)/)?.[1];
await req(memberLink2);
const home2 = await req(`${base}/`);
const lib2 = await req(`${base}/library`);
out.push(['founding home', home2.status, /Paradiddle/.test(home2.text), /founding waitlist/.test(home2.text)]);
out.push(['founding library', lib2.status, /Paradiddle/.test(lib2.text), /founding waitlist/.test(lib2.text)]);

console.log(JSON.stringify(out, null, 2));
