// Analyze page: Upload and Record modes, job progress polling, and the results
// dashboard (Verified score, score dials, sticking, charts, stroke table, playback).
import { initRecord } from "./record.js";
import { drawSkeleton, jointAngle, motionTips, resetStickTrack } from "./skeleton.js";
import { playbackFrame, overlaySize } from "./overlay.js";
import { DiagnosticTimeline } from "./timeline.js";

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
const fingerprint = (blob, name) => `${STORE}v3:${name}|${blob.size}|${blob.lastModified || 0}`;

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
      ${r.time_remap?.message ? `<div class="saved-fps good" id="slowmo-line">${esc(r.time_remap.message)}${r.time_remap.remapped && r.audio?.tempo_bpm ? `. Real-time tempo: <b>${fmt(r.audio.tempo_bpm, 0)} BPM</b>` : ""}</div>` : ""}
      <div class="vcounts"><span><b>${v.verified_stroke_count}</b> verified hits</span>
      <span><b>${v.unverified_onsets}</b> heard, not seen</span><span><b>${v.video_only_strikes}</b> seen, not heard</span>
      ${(v.video_only_no_sound || []).length ? `<span><b>${v.video_only_no_sound.length}</b> video only (slow motion section, no usable sound)</span>` : ""}
      <span>window plus or minus <b>${v.window_ms}</b> ms${widened}</span></div>
      <div>Played ${r.audio?.grid?.metronome ? "with the click" : "to your own pulse"} at about <b>${fmt(audio.tempo_bpm, 0, " BPM")}</b>.</div>
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
  drawTimeline(r);
  renderHow();
  $("playback-card").scrollIntoView({ behavior: "smooth", block: "start" });
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
let playHighlight = null, playbackApi = null, problemCursor = -1, exportingClip = false;
const stickTrails = [[], []];
let prevWrists = null, shoulderBase = null;

function problemMarks(r) {
  const marks = [];
  for (const s of r?.strokes || []) {
    const ms = s.timing_error_ms;
    if (ms == null) continue;
    if (Math.abs(ms) < 25 && s.verification === "verified") continue;
    marks.push({ t: s.t, ms, hand: s.hand, label: feel(ms) });
  }
  for (const f of r?.coaching?.findings || []) {
    for (const e of f.examples || []) {
      if (!marks.some((m) => Math.abs(m.t - Number(e.t)) < 0.05)) {
        marks.push({ t: Number(e.t), ms: 25, hand: e.hand || f.hand, label: e.label || f.title });
      }
    }
  }
  marks.sort((a, b) => a.t - b.t);
  return marks;
}

function drawTrails(ctx, w, h, now) {
  const ink = ["232,163,23", "79,209,255"];
  const life = 0.42;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  stickTrails.forEach((arr, side) => {
    const pts = arr.filter((p) => now - p.t <= life);
    if (pts.length < 2) return;
    const samples = [];
    for (let t = pts[0].t; t <= pts[pts.length - 1].t + 0.0001; t += 0.012) {
      let i = 1;
      while (i < pts.length - 1 && pts[i].t < t) i++;
      const a = pts[i - 1], b = pts[i];
      const span = b.t - a.t;
      const u = span > 1e-4 ? Math.min(1, (t - a.t) / span) : 0;
      samples.push({ x: (a.x + (b.x - a.x) * u) * w, y: (a.y + (b.y - a.y) * u) * h, t });
    }
    for (let i = 1; i < samples.length; i++) {
      const fade = Math.max(0, Math.min(1, (samples[i].t - (now - life)) / life));
      const prev = samples[i - 1], cur = samples[i];
      const fromX = i === 1 ? prev.x : (samples[i - 2].x + prev.x) / 2;
      const fromY = i === 1 ? prev.y : (samples[i - 2].y + prev.y) / 2;
      ctx.strokeStyle = `rgba(${ink[side]},${0.08 + fade * 0.88})`;
      ctx.lineWidth = 1.4 + 8 * fade * fade;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2);
      ctx.stroke();
    }
  });
  ctx.restore();
}

function feel(ms) {
  const a = Math.abs(ms);
  if (a < 18) return "with the click";
  if (a < 40) return ms < 0 ? "a little ahead" : "a little behind";
  return ms < 0 ? "rushing" : "dragging";
}

function sticksByHand(result) {
  const sticks = result.sticks || [];
  const pose = result.pose?.landmarks?.[0];
  const out = { L: null, R: null };
  (result.hands?.landmarks || []).forEach((hand, i) => {
    const tip = sticks[i];
    if (!tip || !hand?.[0] || !pose?.[15] || !pose?.[16]) return;
    const dl = Math.hypot(hand[0].x - pose[15].x, hand[0].y - pose[15].y);
    const dr = Math.hypot(hand[0].x - pose[16].x, hand[0].y - pose[16].y);
    out[dl <= dr ? "L" : "R"] = tip;
  });
  return out;
}

function estimatedSticks(result) {
  if (result.sticks?.some((s) => s && Number.isFinite(s.x))) return result.sticks;
  return (result.hands?.landmarks || []).map((hand) => {
    const wrist = hand[0], mid = hand[9];
    if (!wrist || !mid) return null;
    return { x: mid.x + (mid.x - wrist.x) * 2.5, y: mid.y + (mid.y - wrist.y) * 2.5 };
  });
}

function stickInches(tip, pad, data) {
  if (!tip || !pad?.r || !data?.width || !data?.height) return null;
  const inchesPerX = pad.diameter_in / (2 * pad.r);
  const aspect = data.height / data.width;
  return (pad.y - tip.y) * aspect * inchesPerX;
}

async function jumpTo(t, hand) {
  const pb = $("playback");
  pb.pause();
  playHighlight = hand === "L" || hand === "R" ? hand : null;
  if (playbackApi) await playbackApi.showSkeleton();
  pb.currentTime = Math.max(0, t);
  $("playback-card").scrollIntoView({ behavior: "smooth", block: "center" });
  if (playbackApi && pb.readyState >= 2) playbackApi.redraw();
  drawTimeline(report);
}

let playLoop = false, playData = null, playDataJob = null;
function setupPlayback(r) {
  const pb = $("playback"), cv = $("play-overlay"), ctx = cv.getContext("2d"), dbg = $("play-debug");
  const debug = new URLSearchParams(location.search).has("debug") || $("show-stats")?.checked;
  pb.preservesPitch = true;
  const fitStage = () => {
    const stage = pb.closest(".stage");
    if (!stage || !pb.videoWidth || !pb.videoHeight) return;
    const ratio = pb.videoWidth / pb.videoHeight;
    stage.style.aspectRatio = `${pb.videoWidth} / ${pb.videoHeight}`;
    stage.style.width = `min(100%, calc(72svh * ${ratio}))`;
    stage.style.maxWidth = "100%";
    stage.style.height = "auto";
    stage.style.maxHeight = "none";
  };
  pb.onloadedmetadata = fitStage;
  pb.src = `/api/jobs/${r.job_id}/video`;
  const click = r.audio?.grid?.metronome;
  $("tele-bpm").textContent = r.audio?.tempo_bpm ? `${Number(r.audio.tempo_bpm).toFixed(0)} BPM${click ? " click" : ""}` : "â€”";
  playLoop = false; ctx.clearRect(0, 0, cv.width, cv.height); dbg.hidden = true;
  stickTrails[0] = []; stickTrails[1] = []; resetStickTrack(); prevWrists = null; shoulderBase = null; problemCursor = -1;
  if (playDataJob !== r.job_id) { playData = null; playDataJob = r.job_id; }
  let drawn = 0, empty = 0, interp = 0;
  const overlaysOn = () => $("ov-skel").checked || $("ov-sticks").checked || $("ov-joints").checked;
  const draw = (mediaTime) => {
    fitStage();
    const rect = pb.getBoundingClientRect();
    const size = overlaySize(rect.width, rect.height, pb.videoWidth, pb.videoHeight, Math.min(3, window.devicePixelRatio || 1));
    if (size.width && (cv.width !== size.width || cv.height !== size.height)) { cv.width = size.width; cv.height = size.height; }
    const f = playbackFrame(playData, mediaTime);
    if (f.result) {
      drawSkeleton(ctx, f.result, cv.width, cv.height, {
        skeleton: $("ov-skel").checked, sticks: false, joints: $("ov-joints").checked, pad: false,
      });
      if ($("ov-sticks")?.checked) {
        const pose = f.result.pose?.landmarks?.[0];
        const headT = Math.max(
          stickTrails[0].length ? stickTrails[0][stickTrails[0].length - 1].t : -1,
          stickTrails[1].length ? stickTrails[1][stickTrails[1].length - 1].t : -1,
        );
        if (headT >= 0 && (mediaTime < headT - 0.04 || mediaTime > headT + 0.22)) {
          stickTrails[0] = []; stickTrails[1] = []; resetStickTrack();
        }
        const tips = motionTips(pb, f.result.hands?.landmarks, pose, mediaTime);
        tips.forEach((tip, side) => {
          if (!tip) return;
          const trail = stickTrails[side];
          const prev = trail[trail.length - 1];
          if (prev && Math.abs(mediaTime - prev.t) < 0.0001) { prev.x = tip.x; prev.y = tip.y; return; }
          if (!prev || mediaTime > prev.t) trail.push({ x: tip.x, y: tip.y, t: mediaTime });
          while (trail.length && mediaTime - trail[0].t > 0.45) trail.shift();
        });
        f.result.sticks = (f.result.hands?.landmarks || []).map((hand) => {
          if (!hand?.[0] || !pose?.[15] || !pose?.[16]) return null;
          const dl = Math.hypot(hand[0].x - pose[15].x, hand[0].y - pose[15].y);
          const dr = Math.hypot(hand[0].x - pose[16].x, hand[0].y - pose[16].y);
          return tips[dl <= dr ? 0 : 1];
        });
        drawTrails(ctx, cv.width, cv.height, mediaTime);
        drawSkeleton(ctx, f.result, cv.width, cv.height, {
          skeleton: false, sticks: true, joints: false, pad: false, clear: false,
        });
      }
      drawHighlight(f.result);
      updateTelemetry(f.result, mediaTime);
      drawn++; if (f.interpolated) interp++;
    } else { ctx.clearRect(0, 0, cv.width, cv.height); empty++; }
    if (debug && playData) {
      dbg.hidden = false;
      const st = playData.stats || {};
      dbg.textContent = `frame ${f.index + 1} of ${playData.t.length} at ${mediaTime.toFixed(3)} s, ${f.exact ? "exact" : f.interpolated ? "interpolated" : "no data"} | ` +
        `pose found on ${Math.round((st.pose_rate || 0) * 100)}% of frames, both hands ${Math.round((st.two_hands_rate || 0) * 100)}% | ` +
        `drawn ${drawn}, empty ${empty}, interpolated ${interp}`;
    }
  };
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
  const ensure = async () => {
    if (playData) return true;
    try {
      const res = await fetch(`/api/jobs/${r.job_id}/landmarks`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      playData = body;
      const ys = [];
      for (const flat of playData.pose || []) {
        if (!flat) continue;
        const lsv = flat[5], rsv = flat[8];
        if (lsv >= 0.5 && rsv >= 0.5) ys.push((flat[4] + flat[7]) / 2);
      }
      ys.sort((a, b) => a - b);
      shoulderBase = ys.length ? ys[ys.length >> 1] : null;
      return true;
    } catch (e) {
      showError(`Could not load the skeleton for this video: ${e.message}`);
      return false;
    }
  };
  const startLoop = () => {
    if (playLoop) return;
    playLoop = true;
    if ("requestVideoFrameCallback" in pb) {
      const tick = (_now, meta) => {
        if (!playLoop) return;
        try { draw(meta.mediaTime); } catch { /* keep the next frame coming */ }
        pb.requestVideoFrameCallback(tick);
      };
      pb.requestVideoFrameCallback(tick);
      if (pb.readyState >= 2) draw(pb.currentTime);
    } else {
      const tick = () => { if (!playLoop) return; if (pb.readyState >= 2) draw(pb.currentTime); requestAnimationFrame(tick); };
      tick();
    }
  };
  playbackApi = {
    showSkeleton: async () => { if (!(await ensure())) return; startLoop(); if (pb.readyState >= 2) draw(pb.currentTime); },
    redraw: () => { if (playData && pb.readyState >= 2) draw(pb.currentTime); },
  };
  for (const id of ["ov-skel", "ov-sticks", "ov-joints"]) {
    $(id).onchange = async () => {
      if (!overlaysOn()) { playLoop = false; ctx.clearRect(0, 0, cv.width, cv.height); return; }
      if (await ensure()) { startLoop(); if (pb.readyState >= 2) draw(pb.currentTime); }
    };
  }
  pb.onplay = () => { playHighlight = null; };
  pb.onseeked = () => { if (playData && pb.readyState >= 2 && overlaysOn()) draw(pb.currentTime); drawTimeline(r); };
  pb.ontimeupdate = () => {
    drawTimeline(r);
    const pbSpeed = document.getElementById("playback-speed");
  if (pbSpeed) {
    pbSpeed.onchange = () => {
      if (pb) pb.playbackRate = parseFloat(pbSpeed.value);
    };
  }
  };
  $("next-problem").onclick = () => {
    const marks = problemMarks(r);
    if (!marks.length) return;
    problemCursor = (problemCursor + 1) % marks.length;
    jumpTo(marks[problemCursor].t, marks[problemCursor].hand);
  };
  $("coach-clip").onclick = () => saveCoachClip(r);
  $("timeline").onclick = (e) => {
    const dur = r.audio?.waveform?.duration_s || pb.duration;
    if (!dur) return;
    const rect = $("timeline").getBoundingClientRect();
    pb.currentTime = Math.max(0, Math.min(dur, ((e.clientX - rect.left) / rect.width) * dur));
  };
  if (overlaysOn()) playbackApi.showSkeleton();
}

function updateTelemetry(result, t) {
  const pose = result?.pose?.landmarks?.[0];
  const set = (id, text) => { const n = $(id); if (n) n.textContent = text; };
  const wristPct = (id) => (pose && visiblePose(pose[id]) ? `${Math.round((1 - pose[id].y) * 100)}%` : "-");
  set("tele-hl", wristPct(15));
  set("tele-hr", wristPct(16));
  const elbowText = (shoulder, elbow, wrist) => {
    if (!pose) return "-";
    const deg = jointAngle(pose[shoulder], pose[elbow], pose[wrist]);
    return deg == null ? "-" : deg + "°";
  };
  set("tele-el", elbowText(11, 13, 15));
  set("tele-er", elbowText(12, 14, 16));
  const strokes = report?.strokes || [];
  let nearest = null;
  for (const s of strokes) {
    if (nearest == null || Math.abs(s.t - t) < Math.abs(nearest.t - t)) nearest = s;
  }
  if (nearest && Math.abs(nearest.t - t) < 0.08 && nearest.timing_error_ms != null) {
    const ms = nearest.timing_error_ms;
    set("tele-hit", feel(ms));
  } else set("tele-hit", "-");
  if (report?.audio?.target_bpm) set("tele-bpm", report.audio.target_bpm + " BPM");
}

function visiblePose(p) { return p && (p.visibility === undefined || p.visibility >= 0.5); }

function drawFulcrum(result) {
  const pip = $("fulcrum"), pb = $("playback");
  const on = $("ov-fulcrum").checked;
  pip.hidden = !on;
  if (!on || !pb.videoWidth) return;
  const pts = (result.hands?.landmarks || []).flat().filter(Boolean);
  if (pts.length < 4) { pip.hidden = true; return; }
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  minX = Math.max(0, minX - 0.06); minY = Math.max(0, minY - 0.06);
  maxX = Math.min(1, maxX + 0.06); maxY = Math.min(1, maxY + 0.06);
  pip.width = 320; pip.height = 200;
  const c = pip.getContext("2d");
  c.drawImage(pb, minX * pb.videoWidth, minY * pb.videoHeight, (maxX - minX) * pb.videoWidth, (maxY - minY) * pb.videoHeight, 0, 0, pip.width, pip.height);
}

let diagTimeline = null;
function drawTimeline(r) {
  const cv = $("timeline");
  if (!cv || !r?.audio?.waveform) return;
  if (!diagTimeline) {
    diagTimeline = new DiagnosticTimeline(cv);
    diagTimeline.onSeek = (t) => {
      const pb = $("playback");
      pb.currentTime = t;
    };
  }
  if (diagTimeline.report !== r) diagTimeline.setReport(r);
  diagTimeline.updatePlayhead($("playback")?.currentTime || 0);
}

async function saveCoachClip(r) {
  const marks = problemMarks(r);
  const worst = marks.slice().sort((a, b) => Math.abs(b.ms) - Math.abs(a.ms))[0];
  const btn = $("coach-clip");
  if (!worst) { btn.textContent = "No problem to clip"; return; }
  const pb = $("playback");
  if (typeof pb.captureStream !== "function" || typeof MediaRecorder === "undefined") {
    btn.textContent = "This browser cannot record the clip";
    return;
  }
  btn.disabled = true; btn.textContent = "Recordingâ€¦";
  exportingClip = true; pb.preservesPitch = true;
  if (playbackApi) await playbackApi.showSkeleton();
  const start = Math.max(0, worst.t - 1), end = Math.min(pb.duration || start + 8, start + 8);
  pb.pause();
  if (Math.abs(pb.currentTime - start) > 0.05) {
    await new Promise((res) => {
      const done = () => { pb.removeEventListener("seeked", done); res(); };
      pb.addEventListener("seeked", done);
      pb.currentTime = start;
    });
  }
  if (playbackApi) playbackApi.redraw();
  const vw = pb.videoWidth || 1280, vh = pb.videoHeight || 720;
  const fit = Math.min(1, 1280 / Math.max(vw, vh));
  const out = document.createElement("canvas");
  out.width = Math.max(2, Math.round(vw * fit / 2) * 2);
  out.height = Math.max(2, Math.round(vh * fit / 2) * 2);
  const octx = out.getContext("2d");
  const stream = out.captureStream(30);
  let audio;
  try { audio = pb.captureStream().getAudioTracks()[0]; } catch { audio = null; }
  if (audio) stream.addTrack(audio);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start();
  await pb.play();
  await new Promise((res) => {
    const tick = () => {
      octx.drawImage(pb, 0, 0, out.width, out.height);
      const ov = $("play-overlay");
      if (ov.width) octx.drawImage(ov, 0, 0, out.width, out.height);
      const labelW = Math.min(420, out.width - 32);
      octx.fillStyle = "rgba(0,0,0,0.55)"; octx.fillRect(16, 16, labelW, 44);
      octx.fillStyle = "#fff"; octx.font = "700 22px system-ui, sans-serif";
      octx.fillText(worst.label, 28, 46);
      if (pb.currentTime < end && !pb.paused) requestAnimationFrame(tick);
      else res();
    };
    tick();
  });
  pb.pause(); rec.stop(); await stopped;
  exportingClip = false;
  const blob = new Blob(chunks, { type: "video/webm" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "coach-clip.webm"; a.click();
  btn.disabled = false; btn.textContent = "Save coach clip";
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




