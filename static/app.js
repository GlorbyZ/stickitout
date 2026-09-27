// Analyze page: Upload and Record modes, job progress polling, and the results
// dashboard (Verified score, score dials, sticking, charts, stroke table, playback).
import { initRecord } from "./record.js";
import { drawSkeleton } from "./skeleton.js";
import { playbackFrame, overlaySize } from "./overlay.js";

// Charts (audio waveform, wrist height, timing error spread, tempo over time) are hidden for now
// so the playback video sits near the top. Set SHOW_CHARTS = true to bring them back.
const SHOW_CHARTS = false;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v, d = 1, unit = "") => (v === null || v === undefined ? "n/a" : `${Number(v).toFixed(d)}${unit}`);
const errColor = (e) => (e === null ? "#999" : Math.abs(e) < 10 ? "#1f9d55" : Math.abs(e) < 25 ? "#d69e00" : "#d64545");
let recorder = null, report = null, maxUploadMb = null, minFps = 23.5, fullFps = 50, slowFps = 100;
fetch("/api/config").then((r) => r.json()).then((c) => {
  maxUploadMb = c.max_upload_mb;
  if (c.min_fps) minFps = c.min_fps;
  if (c.full_accuracy_fps) fullFps = c.full_accuracy_fps;
  if (c.slow_motion_fps) slowFps = c.slow_motion_fps;
}).catch(() => {});

// ---------- modes ----------
function setMode(mode) {
  document.querySelectorAll(".mode").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-selected", b.dataset.mode === mode);
  });
  $("record-pane").hidden = mode !== "record";
  $("upload-pane").hidden = mode !== "upload";
  if (mode !== "record") recorder?.stop();
}
document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
recorder = initRecord({
  onTake: (blob, name) => submit(blob, name),
  maxBytes: () => (maxUploadMb ? maxUploadMb * 1048576 : null),
  fpsLimits: () => ({ min: minFps, full: fullFps }),
});

// ---------- upload ----------
let chosen = null;
function choose(file) {
  chosen = file;
  const resume = file && localStorage.getItem(fingerprint(file, file.name)) ? "<br><span class=\"muted\">Unfinished upload found. It will continue where it stopped.</span>" : "";
  $("drop-text").innerHTML = file ? `<strong>${esc(file.name)}</strong><br><span class="muted">${(file.size / 1e6).toFixed(1)} MB</span>${resume}` : "";
  $("upload-btn").disabled = !file;
}
$("file").addEventListener("change", (e) => choose(e.target.files[0]));
const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && choose(e.dataTransfer.files[0]));
$("upload-btn").addEventListener("click", () => chosen && submit(chosen, chosen.name));

// ---------- submit + poll ----------
function setProgress(frac, text) {
  $("progress").hidden = false;
  $("bar-fill").style.width = `${Math.round(frac * 100)}%`;
  $("progress-text").textContent = text;
}
function showError(msg) {
  $("error").hidden = !msg;
  $("error").textContent = msg || "";
  if (msg) $("progress").hidden = true;
}

// ---------- resumable upload ----------
// Every upload goes up in pieces (the server says how big, 8 MB), each with its index and SHA-256.
// A failed piece is retried with backoff (1, 2, 4 ... 30 s) for as long as the device is online;
// going offline pauses the upload and coming back online resumes it. The upload id is kept in
// localStorage under the file's name, size and date, so picking the same file again after a
// reload continues with only the missing pieces.
const ANALYZING_SLOW = "Analyzing, this can take a few minutes for slow motion";
const MSG_LOST = "Connection lost, retrying...";
const MSG_BACK = "Back online, resuming upload";
const PIECE_TIMEOUT_MS = 120000;
const STORE = "sio-upload:";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const mb = (n) => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0);
const fingerprint = (blob, name) => `${STORE}${name}|${blob.size}|${blob.lastModified || 0}`;

function uploadProgress(loaded, total, note = "") {
  const pct = Math.min(100, Math.floor((100 * loaded) / total));
  setProgress((0.1 * loaded) / total, note || `Uploading ${pct}% (${mb(loaded)} of ${mb(total)} MB)`);
}

function send(method, url, body, onProgress, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    if (timeoutMs) xhr.timeout = timeoutMs;
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
    xhr.onload = () => {
      let b = {};
      try { b = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      resolve({ status: xhr.status, body: b });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(body);
  });
}

// Screen wake lock while uploading (where supported), taken again when the page comes back.
let wakeLock = null, uploading = false;
async function keepAwake(on) {
  uploading = on;
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed right now (battery saver, hidden tab) */ }
}
document.addEventListener("visibilitychange", () => { if (uploading && document.visibilityState === "visible") keepAwake(true); });

function waitOnline() {
  return navigator.onLine ? Promise.resolve(false) : new Promise((ok) => window.addEventListener("online", () => ok(true), { once: true }));
}

// Retry fn until it gives a final answer. fn returns {status, body}; network errors, timeouts,
// 5xx, 408 and 429 are retried, everything else is final.
async function withRetry(fn, onRetryNote) {
  let delay = 1000;
  for (;;) {
    let r;
    try { r = await fn(); } catch { r = { status: 0, body: {} }; }
    const transient = r.status === 0 || r.status >= 500 || r.status === 408 || r.status === 429;
    if (!transient) return r;
    onRetryNote(MSG_LOST);
    if (await waitOnline()) { onRetryNote(MSG_BACK); delay = 1000; continue; }
    await sleep(delay);
    delay = Math.min(30000, delay * 2);
  }
}

async function sha256Hex(blob) {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function resumableUpload(blob, filename, params, depth = 0) {
  const key = fingerprint(blob, filename);
  const note = (m) => { $("progress-text").textContent = m; };
  let st = null, id = null;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } })();
  if (saved?.id) {
    const r = await withRetry(() => send("GET", `/api/uploads/${saved.id}`, null, null, 30000), note);
    if (r.status === 200 && r.body.size === blob.size) { st = r.body; id = saved.id; }
    else localStorage.removeItem(key);
  }
  if (!st) {
    const start = new FormData();
    start.append("filename", filename);
    start.append("size", String(blob.size));
    if (blob.type) start.append("content_type", blob.type);
    const r = await withRetry(() => send("POST", "/api/uploads", start, null, 30000), note);
    if (r.status !== 201 || !r.body.upload_id) throw new Error(r.body.error || `Upload failed (HTTP ${r.status}).`);
    id = r.body.upload_id;
    st = { ...r.body, have: [], job_id: null };
    try { localStorage.setItem(key, JSON.stringify({ id, t: Date.now() })); } catch { /* storage full or blocked */ }
  }
  if (!st.job_id) {
    const size = st.piece_bytes, have = new Set(st.have);
    const pieceLen = (i) => Math.min(size, blob.size - i * size);
    let done = [...have].reduce((n, i) => n + pieceLen(i), 0), damaged = 0;
    for (let i = 0; i < st.pieces; i++) {
      if (have.has(i)) continue;
      const piece = blob.slice(i * size, i * size + pieceLen(i));
      const sum = await sha256Hex(piece);
      const r = await withRetry(() => send("PUT", `/api/uploads/${id}/pieces/${i}?sha256=${sum}`, piece,
        (n) => uploadProgress(done + n, blob.size), PIECE_TIMEOUT_MS), note);
      if (r.status === 400 && ++damaged <= 5) { i--; await sleep(1000); continue; }   // damaged in transit: send it again
      if (r.status !== 200) throw new Error(r.body.error || `Upload failed (HTTP ${r.status}).`);
      done += pieceLen(i);
      damaged = 0;
      uploadProgress(done, blob.size);
    }
  }
  const r = await withRetry(() => send("POST", `/api/uploads/${id}/finish`, params, null, 120000), note);
  if (r.status === 409 && Array.isArray(r.body.missing) && depth < 3) {   // a piece went missing: fill the gaps
    return resumableUpload(blob, filename, params, depth + 1);
  }
  if (r.status !== 202 || !r.body.job_id) throw new Error(r.body.error || `Upload failed (HTTP ${r.status}).`);
  localStorage.removeItem(key);
  return r.body;
}

async function submit(blob, filename) {
  showError(null);
  if (maxUploadMb && blob.size > maxUploadMb * 1024 * 1024) {
    return showError(`This video is ${(blob.size / 1048576).toFixed(0)} MB and this analyzer accepts up to ${maxUploadMb} MB. ` +
      "Trim it or record a shorter take (about 30 to 60 seconds is plenty).");
  }
  $("results").hidden = true;
  const fd = new FormData($("params"));
  for (const [k, v] of [...fd.entries()]) if (v === "") fd.delete(k);
  setProgress(0, "Uploading...");
  $("upload-keep").hidden = false;
  keepAwake(true);
  let started;
  try {
    started = await resumableUpload(blob, filename, fd);
  } catch (e) {
    return showError(e.message || "Upload failed. Check your connection and try again.");
  } finally {
    $("upload-keep").hidden = true;
    keepAwake(false);
  }
  poll(started.job_id, Boolean(started.slow_motion) || (started.fps || 0) >= slowFps);
}

async function poll(jobId, slow = false) {
  if (slow) setProgress(0.1, `${ANALYZING_SLOW}...`);
  for (;;) {
    const res = await fetch(`/api/jobs/${jobId}`);
    const job = await res.json();
    if (!res.ok) return showError(job.error || "Job lookup failed.");
    if (job.status === "error") return showError(job.error);
    const pct = Math.round((job.progress || 0) * 100);
    setProgress(0.1 + 0.9 * (job.progress || 0), slow ? `${ANALYZING_SLOW}. ${job.stage || job.status}, ${pct}%` : `${job.stage || job.status}... ${pct}%`);
    if (job.status === "done") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const res = await fetch(`/api/results/${jobId}`);
  const body = await res.json();
  if (!res.ok) return showError(body.error);
  $("progress").hidden = true;
  render(body);
  history.replaceState(null, "", `#job=${jobId}`);
}

// ---------- results ----------
function dial(name, value, why, cls = "") {
  const r = 44, c = 2 * Math.PI * r, v = value ?? 0;
  const color = value === null ? "#ccc" : v >= 80 ? "#1f9d55" : v >= 50 ? "#d69e00" : "#d64545";
  return `<div class="dial ${cls}"><svg viewBox="0 0 110 110" role="img" aria-label="${name} ${fmt(value, 0)}">
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="#eee6cf" stroke-width="10"/>
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${(c * v) / 100} ${c}" transform="rotate(-90 55 55)"/>
    <text x="55" y="62" text-anchor="middle" font-size="24" font-weight="700">${value === null ? "n/a" : Math.round(v)}</text></svg>
    <div class="name">${name}</div>${why ? `<div class="why">${esc(why)}</div>` : ""}</div>`;
}
const stat = (label, value) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

// Low frame rate disclaimer (quality.low_fps). Reports made before the flag existed
// fall back to the measured fps so an old 30 fps report still gets the warning.
function lowFpsNotice(r) {
  const q = r.quality;
  const low = q ? q.low_fps : r.source.fps < 50;
  if (!low) return "";
  const msg = q?.message || `Recorded at ${Math.round(r.source.fps)} fps. Fast strokes can fall between frames, ` +
    "so Verified, sticking and form scores are estimates. For the most accurate results, record at 60 fps.";
  return `<div class="lowfps-notice" id="lowfps-notice" role="note"><b>Low frame rate</b><span>${esc(msg)}</span></div>`;
}

function render(r) {
  report = r;
  $("add-training").disabled = false; $("add-training-msg").hidden = true;
  const { audio, video, verification: v, sticking: st, scores: s } = r;
  $("results").hidden = false;
  $("json-link").href = `/api/results/${r.job_id}`;
  renderCoaching(r.coaching);

  const widened = v.window_widened ? ` <span class="small">(widened for ${Math.round(r.source.fps)} fps)</span>` : "";
  $("verified-card").innerHTML = `${lowFpsNotice(r)}<div><div class="label">Verified</div><div class="big">${fmt(s.verified, 0, "%")}</div>
    ${r.quality?.low_fps ? '<div class="est">estimate</div>' : ""}</div>
    <div><div class="saved-fps ${r.source.fps >= fullFps ? "good" : "warn"}" id="saved-fps">Saved video: <b>${r.source.fps >= slowFps ? `${fmt(r.source.fps, 0)} fps (slow motion)` : `${fmt(r.source.fps, 1)} fps`}</b>, measured by the server from the file</div>
      <div class="vcounts"><span><b>${v.verified_stroke_count}</b> verified hits</span>
      <span><b>${v.unverified_onsets}</b> heard, not seen</span><span><b>${v.video_only_strikes}</b> seen, not heard</span>
      <span>window plus or minus <b>${v.window_ms}</b> ms${widened}</span></div>
      <div>Verified-only tempo <b>${fmt(v.verified_tempo_bpm, 1, " BPM")}</b>, timing error <b>${fmt(v.verified_timing.mean_abs_error_ms, 1, " ms")}</b>${v.median_av_delta_ms !== null ? `, median audio-to-video gap <b>${fmt(v.median_av_delta_ms, 1, " ms")}</b>` : ""}</div>
      <div class="small" style="color:#bbb;margin-top:6px">A hit counts as verified when a wrist strike in the video lands within the window of the sound.
      ${esc(v.note || "")}</div></div>`;

  $("dials").innerHTML = [
    dial("Timing", s.timing), dial("Consistency", s.consistency), dial("Dynamics", s.dynamics),
    dial("Form", s.form, s.form === null ? s.form_null_reason : ""), dial("Overall", s.overall, "", "overall"),
  ].join("");
  const target = audio.target_bpm ? ` (target ${fmt(audio.target_bpm, 0)})` : "";
  $("stats").innerHTML = [
    stat(`Tempo${target}`, fmt(audio.tempo_bpm, 1, " BPM")), stat("Top sustained (10 s)", fmt(audio.top_sustained_bpm, 0, " BPM")),
    stat("Hits detected", audio.onset_count), stat("Mean timing error", fmt(audio.timing.mean_abs_error_ms, 1, " ms")),
    stat("Pattern guess", esc(audio.pattern_guess)), stat("Grid", `1/${audio.grid.subdivision} beat, ${fmt(audio.grid.step_ms, 0, " ms")}`),
    stat("Tracked frames", fmt(video.landmark_coverage * 100, 0, "%")), stat("Video (server measured)", `${fmt(r.source.fps, 1)} fps, ${r.source.width}x${r.source.height}`),
  ].join("");

  const breaks = st.breaks.slice(0, 40).map((b) => `<li>${fmt(b.t, 2)} s, stroke ${b.stroke_index + 1}: ${esc(b.note)}</li>`).join("");
  $("sticking-card").innerHTML = `<h2>Sticking: ${esc(st.rudiment)}</h2>` + (st.checked
    ? `<div class="stats">${stat("Sticking accuracy", fmt(st.sticking_accuracy_pct, 1, "%"))}${stat("Lead hand", st.leading_hand)}
        ${stat("Wrong hand", st.wrong_hand)}${stat("Lost place", st.resyncs)}</div>
       <p class="small muted">Expected ${esc(st.pattern)} (either hand may lead), checked over ${st.strokes_checked} strokes.</p>
       ${breaks ? `<b>Where it breaks</b><ol class="breaks">${breaks}</ol>` : "<p>No breaks. Clean sticking.</p>"}`
    : `<p class="muted">${esc(st.reason)}</p><p class="small muted">Expected pattern ${esc(st.pattern || "")}</p>`);

  const ph = s.per_hand, f = video.form;
  $("hands-card").innerHTML = `<h2>Left vs right</h2><div class="table-wrap"><table>
    <tr><th></th><th>Left</th><th>Right</th></tr>
    <tr><td>Strokes</td><td>${ph.L.strokes}</td><td>${ph.R.strokes}</td></tr>
    <tr><td>Timing score</td><td>${fmt(ph.L.timing, 0)}</td><td>${fmt(ph.R.timing, 0)}</td></tr>
    <tr><td>Mean error</td><td>${fmt(ph.L.mean_abs_error_ms, 1, " ms")}</td><td>${fmt(ph.R.mean_abs_error_ms, 1, " ms")}</td></tr>
    <tr><td>Stroke height</td><td>${fmt(ph.L.stroke_height_mean, 2)}</td><td>${fmt(ph.R.stroke_height_mean, 2)}</td></tr>
    <tr><td>Height consistency</td><td>${fmt(ph.L.stroke_height_consistency, 0)}</td><td>${fmt(ph.R.stroke_height_consistency, 0)}</td></tr>
    <tr><td>Arm vs wrist index</td><td>${fmt(f.arm_vs_wrist_index.L, 2)}</td><td>${fmt(f.arm_vs_wrist_index.R, 2)}</td></tr>
    </table></div><p class="small muted">Symmetry ${fmt(f.symmetry, 2)}, posture drift ${fmt(f.posture_drift_per_min, 3)} per min,
    shoulder tilt ${fmt(f.shoulder_line_angle_deg, 1)} deg. Heights are in ${esc((video.normalization || "body").replace(/_/g, " "))} units.
    Arm vs wrist: higher means more arm.</p>`;

  $("results").classList.toggle("no-charts", !SHOW_CHARTS);
  if (SHOW_CHARTS) drawCharts(r);
  renderStrokes(r.strokes, 60);
  setupPlayback(r);
  renderHow();
  $("results").scrollIntoView({ behavior: "smooth" });
}

function drawCharts(r) {
  drawWave(r); drawTraj(r); drawHist(r.audio.timing.histogram); drawTempo(r.audio.rolling_bpm, r.audio.target_bpm);
}

function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = Number(cv.getAttribute("height"));
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = `${h}px`;
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, w, h];
}

function drawWave(r) {
  const cv = $("wave"), [ctx, w, h] = sizeCanvas(cv), peaks = r.audio.waveform.peaks, dur = r.audio.waveform.duration_s;
  ctx.fillStyle = "#faf7ee"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#b9b09a";
  const mid = h / 2;
  peaks.forEach((p, i) => { const x = (i / peaks.length) * w; ctx.fillRect(x, mid - p * mid * 0.9, Math.max(1, w / peaks.length), p * mid * 1.8); });
  for (const s of r.strokes) {
    const x = (s.t / dur) * w;
    ctx.strokeStyle = errColor(s.timing_error_ms); ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (s.verification === "verified") { ctx.moveTo(x, 4); ctx.lineTo(x, h - 4); } else { ctx.moveTo(x, 4); ctx.lineTo(x, 22); }
    ctx.stroke();
  }
  ctx.fillStyle = "#5a2b8a";
  for (const vo of r.verification.video_only) { const x = (vo.t / dur) * w; ctx.beginPath(); ctx.arc(x, h - 8, 3, 0, 7); ctx.fill(); }
  cv.onclick = (e) => { const t = (e.offsetX / w) * dur; const pb = $("playback"); pb.currentTime = t; pb.scrollIntoView({ behavior: "smooth", block: "center" }); };
}

function axes(ctx, w, h, pad, xmax, ymin, ymax, xlabel, ylabel) {
  ctx.fillStyle = "#faf7ee"; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#ddd5bf"; ctx.fillStyle = "#6b6b6b"; ctx.font = "11px system-ui"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + ((h - 2 * pad) * i) / 4; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - 6, y); ctx.stroke();
    ctx.fillText((ymax - ((ymax - ymin) * i) / 4).toFixed(ymax - ymin < 5 ? 2 : 0), 2, y + 4);
  }
  ctx.fillText(xlabel, w - 60, h - 4); ctx.fillText(ylabel, pad, 11);
  return { X: (x) => pad + (x / xmax) * (w - pad - 6), Y: (y) => pad + (1 - (y - ymin) / (ymax - ymin || 1)) * (h - 2 * pad) };
}

function drawTraj(r) {
  const cv = $("traj"), [ctx, w, h] = sizeCanvas(cv), tr = r.video.trajectories;
  if (!tr.t.length) {
    ctx.fillStyle = "#faf7ee"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#6b6b6b"; ctx.font = "14px system-ui";
    ctx.fillText("No wrist tracking for this video.", 20, h / 2);
    $("traj-note").textContent = r.video.degraded_reason || ""; return;
  }
  const all = [...tr.left_wrist_height, ...tr.right_wrist_height].filter((v) => v !== null);
  const { X, Y } = axes(ctx, w, h, 28, tr.t.at(-1), Math.min(...all), Math.max(...all), "time (s)", "wrist height (higher is up)");
  for (const [key, color] of [["left_wrist_height", "#2b7fd6"], ["right_wrist_height", "#d64545"]]) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath();
    let pen = false;
    tr[key].forEach((v, i) => { if (v === null) { pen = false; return; } pen ? ctx.lineTo(X(tr.t[i]), Y(v)) : ctx.moveTo(X(tr.t[i]), Y(v)); pen = true; });
    ctx.stroke();
  }
  $("traj-note").innerHTML = '<span style="color:#2b7fd6">Left wrist</span> and <span style="color:#d64545">right wrist</span>, in body units.';
}

function drawHist(hist) {
  const cv = $("hist"), [ctx, w, h] = sizeCanvas(cv), n = hist.counts.length, max = Math.max(1, ...hist.counts);
  ctx.fillStyle = "#faf7ee"; ctx.fillRect(0, 0, w, h);
  const bw = (w - 20) / n;
  hist.counts.forEach((c, i) => {
    const lo = hist.bin_edges_ms[i], bh = (c / max) * (h - 34);
    ctx.fillStyle = errColor(lo + 2.5); ctx.fillRect(10 + i * bw + 1, h - 20 - bh, bw - 2, bh);
  });
  ctx.fillStyle = "#6b6b6b"; ctx.font = "11px system-ui";
  ctx.fillText("-50 ms (early)", 8, h - 5); ctx.fillText("0", w / 2 - 3, h - 5); ctx.fillText("+50 ms (late)", w - 82, h - 5);
  if (hist.below || hist.above) ctx.fillText(`outside range: ${hist.below} early, ${hist.above} late`, 10, 12);
}

function drawTempo(rolling, target) {
  const cv = $("tempo"), [ctx, w, h] = sizeCanvas(cv);
  const pts = rolling.filter((p) => p.bpm !== null);
  if (!pts.length) { ctx.fillStyle = "#faf7ee"; ctx.fillRect(0, 0, w, h); return; }
  const vals = pts.map((p) => p.bpm).concat(target ? [target] : []);
  const lo = Math.floor(Math.min(...vals) - 3), hi = Math.ceil(Math.max(...vals) + 3);
  const { X, Y } = axes(ctx, w, h, 28, rolling.at(-1).t_end, lo, hi, "time (s)", "BPM (4 s windows)");
  if (target) { ctx.strokeStyle = "#c99a00"; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(0), Y(target)); ctx.lineTo(w - 6, Y(target)); ctx.stroke(); ctx.setLineDash([]); }
  ctx.strokeStyle = "#111"; ctx.lineWidth = 2; ctx.beginPath();
  pts.forEach((p, i) => { const x = X((p.t_start + p.t_end) / 2), y = Y(p.bpm); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
}

function renderStrokes(strokes, limit) {
  const rows = strokes.slice(0, limit).map((s, i) => {
    const wrong = s.expected_hand && s.hand && s.expected_hand !== s.hand;
    return `<tr class="${wrong ? "wrong" : ""}"><td>${i + 1}</td><td>${fmt(s.t, 3)}</td><td>${s.hand ?? "?"}</td><td>${s.expected_hand ?? ""}</td>
      <td style="color:${errColor(s.timing_error_ms)}">${fmt(s.timing_error_ms, 1)}</td><td>${fmt(s.velocity, 2)}</td>
      <td>${fmt(s.stroke_height, 2)}</td><td><span class="tag ${s.verification}">${s.verification}</span></td><td>${fmt(s.av_delta_ms, 0)}</td></tr>`;
  }).join("");
  $("strokes").innerHTML = `<tr><th>#</th><th>Time (s)</th><th>Hand</th><th>Expected</th><th>Error (ms)</th><th>Velocity</th>
    <th>Height</th><th>Check</th><th>A/V gap (ms)</th></tr>${rows}`;
  const more = $("more-strokes");
  more.hidden = strokes.length <= limit;
  more.textContent = `Show all ${strokes.length} strokes`;
  more.onclick = () => renderStrokes(strokes, strokes.length);
}

// Optional: skeleton over playback, from the server's analysis of every frame. Landmarks are
// stored under each frame's presentation time, which the browser reports as
// requestVideoFrameCallback mediaTime, so each drawn skeleton belongs to the frame on screen.
// Frames without a detection draw nothing (never a frozen, stale pose).
const HAND_NAME = { L: "Left hand", R: "Right hand" };

// Coaching (app/coaching.py): focus line, ranked findings with "how to fix", strengths, and honesty notes.
function renderCoaching(c) {
  const box = $("coaching");
  const ok = c && c.status === "ok";
  $("results").classList.toggle("has-coaching", !!ok);
  if (!c) { box.hidden = true; return; }
  box.hidden = false;
  const focus = ok ? c.focus : c.message || "We could not build coaching for this take.";
  $("coach-focus").innerHTML = `<div class="coach-kicker">Focus for your next take</div>
    <p class="coach-focus-text">${esc(focus)}</p>
    ${ok && c.tempo_bpm ? `<div class="coach-meta">Measured tempo about ${Math.round(c.tempo_bpm)} BPM${c.low_fps ? ", filmed under 50 fps" : ""}</div>` : ""}`;
  const findings = ok ? c.findings || [] : [];
  $("coach-findings").innerHTML = findings.map((f) => `<article class="card coach-card sev-${esc(f.severity)}" data-id="${esc(f.id)}">
      <div class="coach-top"><span class="sev-chip ${esc(f.severity)}">${esc(f.severity_label)}</span>${f.hand ? `<span class="hand-chip">${HAND_NAME[f.hand] || ""}</span>` : ""}</div>
      <h3 class="coach-title">${esc(f.title)}</h3>
      <p class="coach-saw"><b>What we saw:</b> ${esc(f.saw)}</p>
      <p class="coach-why"><b>Why it matters:</b> ${esc(f.why)}</p>
      ${f.examples && f.examples.length ? `<div class="coach-examples"><span class="ex-label">Watch it</span>${f.examples.map((e) =>
        `<button type="button" class="ts-chip" data-t="${Number(e.t)}" data-hand="${esc(e.hand || f.hand || "")}" aria-label="Jump the video to ${esc(e.label)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>${esc(e.label)}</button>`).join("")}</div>` : ""}
      <details class="coach-fix"><summary>How to fix it</summary>
        <ol>${(f.fix || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
        ${f.drill ? `<div class="drill"><div class="drill-head"><span class="drill-name">Drill: ${esc(f.drill.name)}</span><span class="drill-tempo">${esc(f.drill.tempo_bpm)} BPM</span></div>
          <p>${esc(f.drill.text)}</p></div>` : ""}
      </details>
      ${f.caveat ? `<p class="coach-caveat">${esc(f.caveat)}</p>` : ""}
    </article>`).join("") || (ok ? `<div class="card coach-card sev-none"><h3 class="coach-title">Nothing worth flagging</h3>
      <p class="coach-saw">No timing, tempo, sticking or dynamics measurement crossed our thresholds on this take.</p></div>` : "");
  const strengths = ok ? c.strengths || [] : [];
  $("coach-strengths").hidden = !strengths.length;
  $("coach-strengths").innerHTML = `<h3 class="coach-title">What you did well</h3><ul>${strengths.map((x) =>
    `<li><b>${esc(x.title)}.</b> ${esc(x.saw)}</li>`).join("")}</ul>`;
  const notes = c.notes || [];
  $("coach-notes-wrap").hidden = !notes.length;
  $("coach-notes").innerHTML = notes.map((n) => `<li>${esc(n)}</li>`).join("");
  box.querySelectorAll(".ts-chip").forEach((b) => { b.onclick = () => jumpTo(Number(b.dataset.t), b.dataset.hand || null); });
}

// Timestamp chip: pause the video on that moment with the skeleton drawn and the hand ringed.
let playHighlight = null, playbackApi = null;
async function jumpTo(t, hand) {
  const pb = $("playback");
  pb.pause();
  playHighlight = hand === "L" || hand === "R" ? hand : null;
  if (playbackApi) await playbackApi.showSkeleton();
  pb.currentTime = Math.max(0, t);
  $("playback-card").scrollIntoView({ behavior: "smooth", block: "center" });
  if (playbackApi && pb.readyState >= 2) playbackApi.redraw();
}

let playLoop = false, playData = null, playDataJob = null;
function setupPlayback(r) {
  const pb = $("playback"), cv = $("play-overlay"), ctx = cv.getContext("2d"), box = $("play-skel"), dbg = $("play-debug");
  const debug = new URLSearchParams(location.search).has("debug") || $("show-stats")?.checked;
  pb.src = `/api/jobs/${r.job_id}/video`;
  box.checked = false; playLoop = false; ctx.clearRect(0, 0, cv.width, cv.height); dbg.hidden = true;
  if (playDataJob !== r.job_id) { playData = null; playDataJob = r.job_id; }
  let drawn = 0, empty = 0, interp = 0;
  const draw = (mediaTime) => {
    const rect = pb.getBoundingClientRect();
    const size = overlaySize(rect.width, rect.height, pb.videoWidth, pb.videoHeight, Math.min(3, window.devicePixelRatio || 1));
    if (size.width && (cv.width !== size.width || cv.height !== size.height)) { cv.width = size.width; cv.height = size.height; }
    const f = playbackFrame(playData, mediaTime);
    if (f.result) { drawSkeleton(ctx, f.result, cv.width, cv.height); drawHighlight(f.result); drawn++; if (f.interpolated) interp++; }
    else { ctx.clearRect(0, 0, cv.width, cv.height); empty++; }
    if (debug) {
      dbg.hidden = false;
      const st = playData.stats || {};
      dbg.textContent = `frame ${f.index + 1} of ${playData.t.length} at ${mediaTime.toFixed(3)} s, ${f.exact ? "exact" : f.interpolated ? "interpolated" : "no data"} | ` +
        `pose found on ${Math.round((st.pose_rate || 0) * 100)}% of frames, both hands ${Math.round((st.two_hands_rate || 0) * 100)}% | ` +
        `drawn ${drawn}, empty ${empty}, interpolated ${interp}`;
    }
  };
  // Ring the wrist a coaching finding is about (pose landmark 15 is the player's left wrist, 16 the right).
  const drawHighlight = (result) => {
    const pose = result?.pose?.landmarks?.[0];
    const p = playHighlight && pose ? pose[playHighlight === "L" ? 15 : 16] : null;
    if (!p) return;
    const x = p.x * cv.width, y = p.y * cv.height, rad = Math.max(16, cv.width * 0.055), lw = Math.max(3, cv.width / 160);
    ctx.save();
    ctx.lineWidth = lw * 2.2; ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = lw; ctx.strokeStyle = "#ff6b4a";
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
    const label = playHighlight === "L" ? "Left" : "Right";
    ctx.font = `700 ${Math.round(rad * 0.75)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.lineWidth = lw * 1.5; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.strokeText(label, x, y - rad - lw);
    ctx.fillStyle = "#ff6b4a"; ctx.fillText(label, x, y - rad - lw);
    ctx.restore();
  };
  pb.onplay = () => { playHighlight = null; };
  pb.onseeked = () => { if (playLoop && playData && pb.paused && pb.readyState >= 2) draw(pb.currentTime); };
  playbackApi = {
    showSkeleton: async () => { if (!box.checked) { box.checked = true; await box.onchange(); } },
    redraw: () => { if (playLoop && playData) draw(pb.currentTime); },
  };
  box.onchange = async () => {
    playLoop = box.checked;
    if (!playLoop) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
    if (!playData) {
      try {
        const res = await fetch(`/api/jobs/${r.job_id}/landmarks`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        playData = body;
      } catch (e) {
        box.checked = false; playLoop = false;
        showError(`Could not load the skeleton for this video: ${e.message}`);
        return;
      }
    }
    if ("requestVideoFrameCallback" in pb) {
      const tick = (now, meta) => {
        if (!playLoop) return;
        draw(meta.mediaTime);
        pb.requestVideoFrameCallback(tick);
      };
      pb.requestVideoFrameCallback(tick);
      if (pb.readyState >= 2) draw(pb.currentTime);   // paused: draw the frame on screen now
    } else {
      // No requestVideoFrameCallback (older browsers): follow currentTime every animation frame.
      const tick = () => { if (!playLoop) return; if (pb.readyState >= 2) draw(pb.currentTime); requestAnimationFrame(tick); };
      tick();
    }
  };
}

function renderHow() {
  $("how").innerHTML = `<p>Every score runs from 0 to 100. The audio comes from your video's soundtrack.</p><ul>
    <li><b>Timing</b> = <code>max(0, 100 - mean_abs_error_ms * 2)</code>. Each hit is compared with the nearest line of a grid
      built from your tempo (16ths, or 6 per beat for sextuplet feels). 10 ms average error gives 80, 25 ms gives 50, 50 ms gives 0.</li>
    <li><b>Consistency</b> = <code>max(0, 100 - (std(ioi) / mean(ioi)) * 100)</code>, where ioi is the gap between hits.</li>
    <li><b>Dynamics</b> = <code>max(0, dynamics_evenness * 100)</code>, with
      <code>dynamics_evenness = 1 - std(velocity) / mean(velocity)</code> and velocity the loudness in the 30 ms after each hit.
      Accents lower this on purpose, so compare takes of the same exercise.</li>
    <li><b>Form</b> = mean of stroke-height consistency <code>max(0, 100 - (std(stroke_height) / mean(stroke_height)) * 100)</code>,
      symmetry <code>symmetry * 100</code> and posture <code>max(0, 100 - abs(posture_drift_per_min) * 500)</code>.
      Heights use shoulder width as the unit (upper-arm length from a side view). Form is n/a when fewer than half the frames show both wrists.</li>
    <li><b>Overall</b> = mean of the scores above that are not n/a.</li>
    <li><b>Verified</b> = <code>verified / (verified + heard_not_seen + seen_not_heard) * 100</code>. A hit is verified when the video shows a wrist
      strike (a low point of the wrist) within plus or minus the verify window of the sound. It is shown on its own and is not part of Overall.
      For videos under 50 fps the window is widened to at least 60 ms (and 1.75 frame intervals), because the wrist low point can fall between frames.</li>
    <li><b>Sticking accuracy</b> = share of strokes whose hand matches single paradiddle sticking <code>RLRR LRLL</code> (either hand leading),
      lining up with your playing even if you drop or add a stroke. Each break lists where it happened.</li>
    <li><b>Top sustained</b> = the highest tempo you held across 10 seconds of 4 second windows.</li></ul>`;
}

$("again").addEventListener("click", () => { $("results").hidden = true; window.scrollTo({ top: 0, behavior: "smooth" }); });

// Copy this analysis (original video + report) into the training dataset for labeling.
$("add-training").addEventListener("click", async () => {
  if (!report) return;
  const btn = $("add-training"), msg = $("add-training-msg");
  btn.disabled = true; msg.hidden = false; msg.textContent = "Adding to the training set...";
  try {
    const res = await fetch(`/api/dataset/from-job/${report.job_id}`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    msg.innerHTML = `Added to the training set. <a href="/label#clip=${esc(body.clip_id)}">Open it on the Label page</a>.`;
  } catch (e) {
    msg.textContent = `Could not add it: ${e.message}`; btn.disabled = false;
  }
});
window.addEventListener("resize", () => { if (SHOW_CHARTS && report && !$("results").hidden) drawCharts(report); });
// Deep link for reviewing a finished job: /#job=<id> (set automatically when a job finishes).
function openFromHash() {
  const m = location.hash.match(/job=([0-9a-f]{32})/);
  if (!m || report?.job_id === m[1]) return;
  fetch(`/api/results/${m[1]}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(render)
    .catch(() => showError("That report is not available (reports are deleted after a few days)."));
}
openFromHash();
window.addEventListener("hashchange", openFromHash);
