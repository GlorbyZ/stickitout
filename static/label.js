// Label page: pick a training clip, play it slowly, mark strokes (F = left, J = right), fix the
// analyzer's pre-filled strokes, fill in clip details, and save labels.json via the API.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtT = (t) => (t === null || t === undefined ? "" : Number(t).toFixed(3));
const COLORS = { L: "#2b7fd6", R: "#d64545", N: "#8a8a8a" };
const SNAP_S = 0.040, MERGE_S = 0.030, HIT_PX = 9, AUTOSAVE_MS = 20000;

const video = $("video"), tl = $("timeline"), ov = $("overview");
let clip = null;            // GET /api/dataset/{id}
let strokes = [];           // [{_id, t, hand, type, sticking_error, source, edited}]
let meta = {};
let labeler = "";
let docStatus = "draft";
let selectedId = null, nextId = 1;
let undoStack = [], redoStack = [];
let dirty = false, saving = false, lastSaved = null;
let wave = null, onsets = [], fps = 60, duration = 0;
let view = { start: 0, span: 4 };
let drag = null;
let clips = [];

// ---------- helpers ----------
function showError(msg) { $("error").hidden = !msg; $("error").textContent = msg || ""; }
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let body = {};
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
  return body;
}
const byId = (id) => strokes.find((s) => s._id === id);
const sortStrokes = () => strokes.sort((a, b) => a.t - b.t);
const withIds = (list) => list.map((s) => ({ ...s, _id: nextId++ }));
const plain = () => strokes.map(({ _id, ...s }) => s);
function snapshot() { return JSON.stringify({ s: strokes, c: meta.clap_t, a: meta.eval_start_s, b: meta.eval_end_s }); }
function restore(snap) {
  const o = JSON.parse(snap);
  strokes = o.s; meta.clap_t = o.c ?? null; meta.eval_start_s = o.a ?? null; meta.eval_end_s = o.b ?? null;
  if (selectedId && !byId(selectedId)) selectedId = null;
}
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 300) undoStack.shift(); redoStack = []; }
function changed() { markDirty(); renderAll(); }
function markDirty() { dirty = true; setSaveState(); }
function setSaveState(text, cls) {
  const el = $("save-state");
  if (text) { el.textContent = text; el.className = `pill-l ${cls || ""}`; return; }
  if (dirty) { el.textContent = "Unsaved changes"; el.className = "pill-l dirty"; }
  else if (lastSaved) { el.textContent = `Saved ${lastSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`; el.className = "pill-l saved"; }
  else { el.textContent = ""; el.className = "pill-l"; }
}

// ---------- clip list and upload ----------
function statusBadge(c) {
  if (c.intake === "processing" || c.intake === "queued") return `<span class="st processing">analyzing ${Math.round((c.intake_progress || 0) * 100)}%</span>`;
  if (c.intake === "error") return '<span class="st error">error</span>';
  return `<span class="st ${c.status}">${c.status}</span>`;
}
async function loadClips() {
  try {
    const body = await api("/api/dataset");
    clips = body.clips;
    renderClipList();
    if (clips.some((c) => c.intake === "processing" || c.intake === "queued")) setTimeout(loadClips, 3000);
  } catch (e) { $("clip-list").innerHTML = `<p class="notice bad">${esc(e.message)}</p>`; }
}
function renderClipList() {
  const cur = clip?.labels.clip_id;
  $("clip-list").innerHTML = clips.length ? clips.map((c) => `<button type="button" class="clip ${c.clip_id === cur ? "active" : ""}" data-id="${c.clip_id}">
      <div class="name">${esc(c.original_filename || c.clip_id)}</div>
      <div class="sub">${statusBadge(c)}${esc([c.player, c.rudiment, c.click_bpm ? `${c.click_bpm} BPM` : "", c.surface].filter(Boolean).join(", "))}</div>
      <div class="sub">${c.stroke_count} strokes${c.duration_s ? `, ${Number(c.duration_s).toFixed(0)} s` : ""}${c.form_grade ? `, form ${c.form_grade}/10` : ""}</div>
    </button>`).join("") : '<p class="muted small">No clips yet. Add one below.</p>';
  $("clip-list").querySelectorAll(".clip").forEach((b) => b.addEventListener("click", () => openClip(b.dataset.id)));
}
$("refresh").addEventListener("click", loadClips);

let chosen = null;
function choose(file) {
  chosen = file || null;
  $("drop-text").innerHTML = file ? `<strong>${esc(file.name)}</strong><br><span class="muted">${(file.size / 1e6).toFixed(1)} MB</span>`
    : '<strong>Choose a video</strong> or drop it here';
  $("upload-btn").disabled = !file;
}
$("file").addEventListener("change", (e) => choose(e.target.files[0]));
const drop = $("drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && choose(e.dataTransfer.files[0]));
$("upload-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!chosen) return;
  const fd = new FormData($("upload-form"));
  fd.delete("video");
  for (const [k, v] of [...fd.entries()]) if (v === "") fd.delete(k);
  if (labeler || localStorage.getItem("sio_labeler")) fd.append("labeler", labeler || localStorage.getItem("sio_labeler"));
  fd.append("video", chosen, chosen.name);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/dataset");
  const prog = (f, text) => { $("upload-progress").hidden = false; $("upload-fill").style.width = `${Math.round(f * 100)}%`; $("upload-text").textContent = text; };
  xhr.upload.onprogress = (ev) => ev.lengthComputable && prog(ev.loaded / ev.total, `Uploading ${Math.round(100 * ev.loaded / ev.total)}%`);
  xhr.onload = () => {
    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
    if (xhr.status === 202 && body.clip_id) {
      prog(1, "Uploaded. The analyzer is pre-filling strokes; the clip opens now.");
      choose(null); $("file").value = "";
      loadClips().then(() => openClip(body.clip_id));
    } else { $("upload-progress").hidden = true; showError(body.error || `Upload failed (HTTP ${xhr.status}).`); }
  };
  xhr.onerror = () => { $("upload-progress").hidden = true; showError("Upload failed. Check your connection and try again."); };
  showError(null);
  prog(0, "Uploading...");
  xhr.send(fd);
});

// ---------- open a clip ----------
async function openClip(id, { keepView = false } = {}) {
  if (dirty && clip && clip.labels.clip_id !== id && !confirm("You have unsaved changes on this clip. Leave without saving?")) return;
  showError(null);
  let d;
  try { d = await api(`/api/dataset/${id}`); } catch (e) { return showError(e.message); }
  const sameClip = clip && clip.labels.clip_id === id;
  clip = d;
  const L = d.labels;
  strokes = withIds(L.strokes);
  meta = { ...L.meta };
  labeler = L.labeler || localStorage.getItem("sio_labeler") || "";
  docStatus = L.status;
  onsets = d.onsets || [];
  fps = d.video.fps || meta.fps || 60;
  duration = d.video.duration_s || 0;
  selectedId = null; undoStack = []; redoStack = []; dirty = false; lastSaved = null;
  $("empty-state").hidden = true; $("workspace").hidden = false;
  $("clip-title").textContent = L.original_filename || L.clip_id;
  $("clip-sub").textContent = `${L.clip_id}${fps ? `, ${Number(fps).toFixed(1)} fps` : ""}${d.video.preview ? ", browser copy" : ""}`;
  if (!sameClip) {
    video.src = d.video.url;
    if (!keepView) view = { start: 0, span: Number($("zoom").value) };
  }
  history.replaceState(null, "", `#clip=${id}`);
  fillMeta();
  setSaveState();
  intakeNote(d.status);
  wave = null;
  api(`/api/dataset/${id}/waveform`).then((w) => { wave = w; drawTimeline(); }).catch(() => {});
  renderClipList();
  renderAll();
}
function intakeNote(st) {
  const el = $("intake-note");
  if (st.state === "processing" || st.state === "queued") {
    el.hidden = false; el.className = "notice warn";
    el.textContent = `The analyzer is still working on this clip (${st.stage || "queued"}, ${Math.round((st.progress || 0) * 100)}%). ` +
      "Its strokes appear here when it finishes, as long as you have not added any yourself.";
    setTimeout(pollIntake, 3000);
  } else if (st.state === "error") {
    el.hidden = false; el.className = "notice bad";
    el.textContent = `The analyzer could not process this clip: ${st.error || "unknown error"}. You can still label it by hand.`;
  } else el.hidden = true;
}
async function pollIntake() {
  if (!clip) return;
  const id = clip.labels.clip_id;
  let d;
  try { d = await api(`/api/dataset/${id}`); } catch { return; }
  if (!clip || clip.labels.clip_id !== id) return;
  if (d.status.state === "ready" && !dirty && !strokes.length) return openClip(id, { keepView: true });
  if (d.status.state === "ready" || d.status.state === "error") {
    clip.detections = d.detections; clip.status = d.status; onsets = d.onsets || [];
    duration = d.video.duration_s || duration; fps = d.video.fps || fps;
    intakeNote(d.status); renderAll(); loadClips(); return;
  }
  intakeNote(d.status);
}

// ---------- metadata form ----------
const metaForm = $("meta-form");
function fillMeta() {
  for (const el of metaForm.elements) {
    if (!el.name) continue;
    if (el.name === "labeler") el.value = labeler;
    else if (el.type === "checkbox") el.checked = !!meta[el.name];
    else el.value = meta[el.name] ?? "";
  }
  $("status-pill").textContent = docStatus === "done" ? "Marked done" : "Draft";
  $("status-pill").className = `pill-l ${docStatus === "done" ? "saved" : ""}`;
}
metaForm.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.name) return;
  if (el.name === "labeler") { labeler = el.value; localStorage.setItem("sio_labeler", labeler); }
  else if (el.type === "checkbox") meta[el.name] = el.checked;
  else if (el.type === "number" || el.name === "form_grade" || el.name === "notes_per_beat") meta[el.name] = el.value === "" ? null : Number(el.value);
  else if (el.tagName === "SELECT") meta[el.name] = el.value || null;
  else meta[el.name] = el.value;
  markDirty();
});
metaForm.addEventListener("submit", (e) => e.preventDefault());

// ---------- save ----------
async function save(status) {
  if (!clip || saving) return;
  saving = true;
  setSaveState("Saving...", "");
  const body = { status: status || docStatus, labeler, meta, strokes: plain() };
  try {
    const res = await api(`/api/dataset/${clip.labels.clip_id}/labels`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    docStatus = res.labels.status; clip.labels = res.labels;
    dirty = false; lastSaved = new Date(); showError(null);
    fillMeta(); setSaveState();
    const c = clips.find((x) => x.clip_id === clip.labels.clip_id);
    if (c) { c.status = docStatus; c.stroke_count = strokes.length; c.player = meta.player; c.rudiment = meta.rudiment;
      c.click_bpm = meta.click_bpm; c.surface = meta.surface; c.form_grade = meta.form_grade; renderClipList(); }
  } catch (e) { setSaveState("Not saved", "err"); showError(e.message); }
  finally { saving = false; }
}
$("save-btn").addEventListener("click", () => save());
$("draft-btn").addEventListener("click", () => save("draft"));
$("done-btn").addEventListener("click", () => {
  const unknown = strokes.filter((s) => !s.hand).length;
  if (unknown && !confirm(`${unknown} stroke(s) have no hand yet. Mark done anyway?`)) return;
  save("done");
});
setInterval(() => { if (dirty && !drag && clip) save(); }, AUTOSAVE_MS);
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- editing ----------
function tapTime() {
  let t = video.currentTime;
  if (!video.paused) t -= (Number($("latency").value) || 0) / 1000 * video.playbackRate;
  if ($("snap").checked && onsets.length) {
    let best = null;
    for (const o of onsets) if (Math.abs(o - t) <= SNAP_S && (best === null || Math.abs(o - t) < Math.abs(best - t))) best = o;
    if (best !== null) t = best;
  }
  return Math.max(0, t);
}
function nearestStroke(t, within) {
  let best = null;
  for (const s of strokes) if (Math.abs(s.t - t) <= within && (!best || Math.abs(s.t - t) < Math.abs(best.t - t))) best = s;
  return best;
}
function addStroke(hand, type = "normal") {
  if (!clip) return;
  const t = tapTime();
  pushUndo();
  const hit = nearestStroke(t, MERGE_S);
  if (hit) {                                   // tap on an existing stroke: set its hand (and type if given)
    if (hit.hand !== hand || (type !== "normal" && hit.type !== type)) {
      hit.hand = hand; if (type !== "normal") hit.type = type;
      if (hit.source === "analyzer") hit.edited = true;
    }
    selectedId = hit._id;
  } else {
    const s = { _id: nextId++, t: Math.round(t * 10000) / 10000, hand, type, sticking_error: false, source: "manual", edited: false };
    strokes.push(s); sortStrokes(); selectedId = s._id;
  }
  changed();
}
function editSelected(fn) {
  const s = byId(selectedId);
  if (!s) return;
  pushUndo(); fn(s);
  if (s.source === "analyzer") s.edited = true;
  sortStrokes(); changed();
}
function deleteSelected() {
  const s = byId(selectedId);
  if (!s) return;
  pushUndo();
  const i = strokes.indexOf(s);
  strokes.splice(i, 1);
  selectedId = strokes[Math.min(i, strokes.length - 1)]?._id ?? null;
  changed();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); changed(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); changed(); }
function selectStep(dir) {
  if (!strokes.length) return;
  const t = video.currentTime, cur = byId(selectedId);
  let s;
  if (cur) s = strokes[Math.max(0, Math.min(strokes.length - 1, strokes.indexOf(cur) + dir))];
  else s = dir > 0 ? strokes.find((x) => x.t > t + 1e-3) || strokes.at(-1) : [...strokes].reverse().find((x) => x.t < t - 1e-3) || strokes[0];
  selectedId = s._id; seek(s.t); renderAll();
}
function setMarker(key) { pushUndo(); meta[key] = Math.round(video.currentTime * 1000) / 1000; changed(); }

const actions = {
  addL: () => addStroke("L"), addR: () => addStroke("R"),
  accent: () => editSelected((s) => { s.type = s.type === "accent" ? "normal" : "accent"; }),
  ghost: () => editSelected((s) => { s.type = s.type === "ghost" ? "normal" : "ghost"; }),
  error: () => editSelected((s) => { s.sticking_error = !s.sticking_error; }),
  flip: () => editSelected((s) => { s.hand = s.hand === "L" ? "R" : "L"; }),
  delete: deleteSelected, undo, redo,
  play: () => (video.paused ? video.play() : video.pause()),
  prevframe: () => stepFrame(-1), nextframe: () => stepFrame(1),
  back1s: () => seek(video.currentTime - 1), fwd1s: () => seek(video.currentTime + 1),
};
document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => { actions[b.dataset.act](); b.blur(); }));
$("reset-det").addEventListener("click", () => {
  if (!clip?.detections?.length) return showError("There are no analyzer detections for this clip yet.");
  if (!confirm("Replace every stroke with the analyzer's detections? (Undo can bring yours back.)")) return;
  pushUndo(); strokes = withIds(clip.detections); selectedId = null; changed();
});
$("clear-all").addEventListener("click", () => {
  if (!strokes.length || !confirm("Remove all strokes? (Undo can bring them back.)")) return;
  pushUndo(); strokes = []; selectedId = null; changed();
});
$("reanalyze").addEventListener("click", async () => {
  if (!clip || !confirm("Run the analyzer on this clip again? Your labels stay as they are; only the analyzer detections are refreshed.")) return;
  try { await api(`/api/dataset/${clip.labels.clip_id}/reanalyze`, { method: "POST" }); intakeNote({ state: "queued", progress: 0 }); loadClips(); }
  catch (e) { showError(e.message); }
});

// ---------- playback ----------
function seek(t) { video.currentTime = Math.max(0, Math.min(duration || video.duration || 1e9, t)); }
function stepFrame(dir) {
  video.pause();
  const frame = Math.round(video.currentTime * fps);
  seek((frame + dir) / fps + 0.0005);
}
function setRate(r) {
  video.playbackRate = r;
  document.querySelectorAll(".spd").forEach((b) => b.classList.toggle("active", Number(b.dataset.rate) === r));
  updateHud();
}
document.querySelectorAll(".spd").forEach((b) => b.addEventListener("click", () => { setRate(Number(b.dataset.rate)); b.blur(); }));
video.addEventListener("play", () => { $("play-btn").textContent = "Pause"; loop(); });
video.addEventListener("pause", () => { $("play-btn").textContent = "Play"; renderAll(); });
video.addEventListener("seeked", () => { followPlayhead(true); renderAll(); });
video.addEventListener("loadedmetadata", () => { if (!duration) duration = video.duration; renderAll(); });
video.addEventListener("click", () => actions.play());
function loop() {
  if (video.paused) return;
  followPlayhead(false); drawTimeline(); drawOverview(); updateHud();
  requestAnimationFrame(loop);
}
function followPlayhead(center) {
  const t = video.currentTime;
  if (center && (t < view.start || t > view.start + view.span)) view.start = Math.max(0, t - view.span * 0.3);
  else if (!center && (t > view.start + view.span * 0.8 || t < view.start)) view.start = Math.max(0, t - view.span * 0.2);
}
function updateHud() {
  const t = video.currentTime;
  $("hud-time").textContent = `${t.toFixed(3)} s, frame ${Math.round(t * fps)}`;
  $("hud-rate").textContent = video.playbackRate === 1 ? "" : `${video.playbackRate}x`;
  const s = nearestStroke(t, video.paused ? 0.5 / fps + 0.004 : 0.06);
  const hs = $("hud-stroke");
  hs.hidden = !s;
  if (s) { hs.className = `hud-stroke ${s.hand || ""}`; hs.textContent = `${s.hand || "?"}${s.type !== "normal" ? ` ${s.type}` : ""}${s.sticking_error ? " mistake" : ""}`; }
}

// ---------- timeline ----------
function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = Number(cv.dataset.h);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = `${h}px`; }
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, w, h];
}
const laneY = (hand, h) => (hand === "L" ? h * 0.3 : hand === "R" ? h * 0.78 : h * 0.54);
const xOf = (t, w) => ((t - view.start) / view.span) * w;
const tOf = (x, w) => view.start + (x / w) * view.span;
function drawTimeline() {
  if ($("workspace").hidden) return;
  const [ctx, w, h] = sizeCanvas(tl);
  ctx.fillStyle = "#15130f"; ctx.fillRect(0, 0, w, h);
  // lanes
  ctx.fillStyle = "rgba(43,127,214,.10)"; ctx.fillRect(0, h * 0.16, w, h * 0.28);
  ctx.fillStyle = "rgba(214,69,69,.10)"; ctx.fillRect(0, h * 0.64, w, h * 0.28);
  // waveform
  if (wave?.peaks?.length) {
    const r = wave.rate, i0 = Math.max(0, Math.floor(view.start * r)), i1 = Math.min(wave.peaks.length, Math.ceil((view.start + view.span) * r));
    ctx.fillStyle = "rgba(245,197,24,.45)";
    const mid = h * 0.54, amp = h * 0.42;
    const step = Math.max(1, Math.floor((i1 - i0) / w));
    for (let i = i0; i < i1; i += step) {
      let p = 0; for (let k = i; k < Math.min(i + step, i1); k++) p = Math.max(p, wave.peaks[k]);
      const x = xOf(i / r, w);
      ctx.fillRect(x, mid - p * amp, Math.max(1, (step / r / view.span) * w), p * amp * 2);
    }
  }
  // eval region shading
  const a = meta.eval_start_s, b = meta.eval_end_s;
  ctx.fillStyle = "rgba(0,0,0,.55)";
  if (a !== null && a !== undefined) ctx.fillRect(0, 0, Math.max(0, xOf(a, w)), h);
  if (b !== null && b !== undefined) ctx.fillRect(Math.min(w, xOf(b, w)), 0, w, h);
  // time ticks
  const tick = view.span <= 2 ? 0.1 : view.span <= 6 ? 0.25 : view.span <= 12 ? 1 : 2;
  ctx.fillStyle = "#9a9384"; ctx.font = "10px system-ui"; ctx.strokeStyle = "rgba(255,255,255,.08)";
  for (let t = Math.ceil(view.start / tick) * tick; t <= view.start + view.span; t += tick) {
    const x = xOf(t, w); ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, h); ctx.stroke();
    if (Math.abs(t / (tick * 2) - Math.round(t / (tick * 2))) < 1e-6 || tick >= 1) ctx.fillText(`${t.toFixed(tick < 1 ? 2 : 0)}s`, x + 2, 10);
  }
  ctx.fillStyle = "#cfc6ae"; ctx.font = "bold 11px system-ui";
  ctx.fillText("L", 4, h * 0.3 + 4); ctx.fillText("R", 4, h * 0.78 + 4);
  // analyzer detections (reference)
  if ($("show-det").checked && clip?.detections) {
    ctx.fillStyle = "rgba(255,255,255,.55)";
    for (const d of clip.detections) {
      if (d.t < view.start - 0.05 || d.t > view.start + view.span + 0.05) continue;
      const x = xOf(d.t, w); ctx.beginPath(); ctx.moveTo(x - 4, 13); ctx.lineTo(x + 4, 13); ctx.lineTo(x, 19); ctx.fill();
    }
  }
  // clap
  if (meta.clap_t !== null && meta.clap_t !== undefined) {
    const x = xOf(meta.clap_t, w); ctx.strokeStyle = "#b07cff"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#b07cff"; ctx.fillText("clap", x + 3, h - 4);
  }
  // strokes
  for (const s of strokes) {
    if (s.t < view.start - 0.05 || s.t > view.start + view.span + 0.05) continue;
    const x = xOf(s.t, w), y = laneY(s.hand, h), col = COLORS[s.hand || "N"], sel = s._id === selectedId;
    ctx.strokeStyle = col; ctx.lineWidth = sel ? 2 : 1; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, h); ctx.stroke(); ctx.globalAlpha = 1;
    const r = s.type === "accent" ? 9 : s.type === "ghost" ? 5 : 7;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (s.type === "ghost") { ctx.fillStyle = "#15130f"; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); }
    else { ctx.fillStyle = col; ctx.fill(); }
    if (s.type === "accent") { ctx.fillStyle = "#fff"; ctx.font = "bold 11px system-ui"; ctx.fillText(">", x - 3, y + 4); }
    if (s.sticking_error) { ctx.strokeStyle = "#ffd400"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 6, y - 16); ctx.lineTo(x + 6, y - 4);
      ctx.moveTo(x + 6, y - 16); ctx.lineTo(x - 6, y - 4); ctx.stroke(); }
    if (sel) { ctx.strokeStyle = "#f5c518"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke(); }
    if (s.source === "manual" || s.edited) { ctx.fillStyle = "#f5c518"; ctx.fillRect(x - 2, y + r + 3, 4, 3); }
  }
  // playhead
  const px = xOf(video.currentTime, w);
  ctx.strokeStyle = "#f5c518"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
}
function drawOverview() {
  if ($("workspace").hidden) return;
  const [ctx, w, h] = sizeCanvas(ov), dur = duration || video.duration || 1;
  ctx.fillStyle = "#2a2620"; ctx.fillRect(0, 0, w, h);
  for (const s of strokes) { ctx.fillStyle = COLORS[s.hand || "N"]; ctx.fillRect((s.t / dur) * w, s.hand === "L" ? 3 : s.hand === "R" ? h / 2 + 1 : h / 4, 1, h / 2 - 4); }
  ctx.strokeStyle = "#f5c518"; ctx.lineWidth = 2;
  ctx.strokeRect((view.start / dur) * w, 1, Math.max(3, (view.span / dur) * w), h - 2);
  ctx.fillStyle = "#fff"; ctx.fillRect((video.currentTime / dur) * w - 1, 0, 2, h);
}
function hitTest(x, y, w, h) {
  let best = null, bestD = HIT_PX + 1;
  for (const s of strokes) {
    const dx = Math.abs(xOf(s.t, w) - x);
    if (dx > HIT_PX) continue;
    const d = dx + Math.abs(laneY(s.hand, h) - y) * 0.15;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
function laneAt(y, h) { return y < h * 0.44 ? "L" : y > h * 0.64 ? "R" : null; }
tl.addEventListener("pointerdown", (e) => {
  const w = tl.clientWidth, h = Number(tl.dataset.h), x = e.offsetX, y = e.offsetY;
  tl.setPointerCapture(e.pointerId);
  const s = hitTest(x, y, w, h);
  if (s) { selectedId = s._id; drag = { kind: "stroke", id: s._id, x0: x, y0: y, t0: s.t, hand0: s.hand, moved: false }; video.pause(); }
  else { selectedId = null; drag = { kind: "scrub" }; seek(tOf(x, w)); }
  renderAll();
});
tl.addEventListener("pointermove", (e) => {
  if (!drag) { tl.style.cursor = hitTest(e.offsetX, e.offsetY, tl.clientWidth, Number(tl.dataset.h)) ? "grab" : "crosshair"; return; }
  const w = tl.clientWidth, h = Number(tl.dataset.h);
  if (drag.kind === "scrub") { seek(tOf(e.offsetX, w)); return; }
  const s = byId(drag.id);
  if (!s) return;
  if (!drag.moved && Math.abs(e.offsetX - drag.x0) < 3 && Math.abs(e.offsetY - drag.y0) < 6) return;
  if (!drag.moved) { undoStack.push(JSON.stringify({ s: strokes.map((x) => ({ ...x, t: x._id === s._id ? drag.t0 : x.t, hand: x._id === s._id ? drag.hand0 : x.hand })), c: meta.clap_t, a: meta.eval_start_s, b: meta.eval_end_s })); redoStack = []; drag.moved = true; }
  s.t = Math.max(0, Math.round((drag.t0 + ((e.offsetX - drag.x0) / w) * view.span) * 10000) / 10000);
  const lane = laneAt(e.offsetY, h);
  if (Math.abs(e.offsetY - drag.y0) > 18 && lane) s.hand = lane;
  if (s.source === "analyzer") s.edited = true;
  tl.style.cursor = "grabbing";
  drawTimeline();
});
function endDrag() {
  if (drag?.kind === "stroke" && drag.moved) { sortStrokes(); const s = byId(drag.id); if (s) seek(s.t); markDirty(); }
  drag = null; tl.style.cursor = "crosshair"; renderAll();
}
tl.addEventListener("pointerup", endDrag);
tl.addEventListener("pointercancel", endDrag);
tl.addEventListener("wheel", (e) => {
  e.preventDefault();
  const w = tl.clientWidth, tAt = tOf(e.offsetX, w);
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { view.start = Math.max(0, view.start + ((e.deltaX || e.deltaY) / w) * view.span); }
  else { setZoom(view.span * (e.deltaY > 0 ? 1.2 : 1 / 1.2), tAt, e.offsetX / w); }
  renderAll();
}, { passive: false });
function setZoom(span, anchorT = video.currentTime, frac = 0.3) {
  view.span = Math.max(0.5, Math.min(60, span));
  view.start = Math.max(0, anchorT - frac * view.span);
  $("zoom").value = Math.min(20, view.span); $("zoom-val").textContent = `${view.span.toFixed(1)} s`;
}
$("zoom").addEventListener("input", (e) => { setZoom(Number(e.target.value)); renderAll(); });
ov.addEventListener("pointerdown", (e) => {
  ov.setPointerCapture(e.pointerId);
  const go = (ev) => { const dur = duration || video.duration || 1; const t = (ev.offsetX / ov.clientWidth) * dur; view.start = Math.max(0, t - view.span / 2); seek(t); };
  go(e);
  ov.onpointermove = (ev) => ev.buttons && go(ev);
  ov.onpointerup = () => { ov.onpointermove = null; };
});
$("show-det").addEventListener("change", () => drawTimeline());

// ---------- stroke table ----------
function renderTable() {
  const counts = { L: 0, R: 0, N: 0, accent: 0, ghost: 0, err: 0, edited: 0 };
  for (const s of strokes) { counts[s.hand || "N"]++; if (s.type !== "normal") counts[s.type]++; if (s.sticking_error) counts.err++; if (s.source === "manual" || s.edited) counts.edited++; }
  $("stroke-counts").textContent = `${strokes.length} total: ${counts.L} L, ${counts.R} R${counts.N ? `, ${counts.N} unknown` : ""}, ` +
    `${counts.accent} accent, ${counts.ghost} ghost, ${counts.err} mistakes; ${counts.edited} added or fixed by hand`;
  const rows = strokes.map((s, i) => `<tr data-id="${s._id}" class="${s._id === selectedId ? "sel" : ""} ${s.sticking_error ? "err" : ""}">
    <td>${i + 1}</td><td>${fmtT(s.t)}</td><td class="h${s.hand || "N"}">${s.hand || "?"}</td><td>${s.type === "normal" ? "" : s.type}</td>
    <td>${s.sticking_error ? "mistake" : ""}</td><td class="muted">${s.source === "manual" ? "added" : s.edited ? "fixed" : "analyzer"}</td></tr>`).join("");
  $("stroke-table").innerHTML = `<tr><th>#</th><th>Time (s)</th><th>Hand</th><th>Type</th><th>Sticking</th><th>Source</th></tr>${rows}`;
  const sel = $("stroke-table").querySelector("tr.sel");
  if (sel) { const wrap = sel.closest(".stroke-table-wrap"); const top = sel.offsetTop - wrap.clientHeight / 2; if (Math.abs(wrap.scrollTop - top) > wrap.clientHeight / 2) wrap.scrollTop = top; }
  const parts = [];
  if (meta.clap_t !== null && meta.clap_t !== undefined) parts.push(`Clap at ${meta.clap_t.toFixed(3)} s (strokes before it and the clap itself are not scored).`);
  if (meta.eval_start_s !== null && meta.eval_start_s !== undefined) parts.push(`Scored from ${meta.eval_start_s.toFixed(2)} s.`);
  if (meta.eval_end_s !== null && meta.eval_end_s !== undefined) parts.push(`Scored until ${meta.eval_end_s.toFixed(2)} s.`);
  $("region-note").textContent = parts.join(" ") || "Press C at the clap. I and O limit scoring to part of the clip (optional).";
}
$("stroke-table").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const s = byId(Number(tr.dataset.id));
  if (s) { selectedId = s._id; video.pause(); seek(s.t); renderAll(); }
});

function renderAll() { drawTimeline(); drawOverview(); renderTable(); updateHud(); }
window.addEventListener("resize", () => { drawTimeline(); drawOverview(); });

// ---------- keyboard ----------
document.addEventListener("keydown", (e) => {
  if (!clip || $("workspace").hidden) return;
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "textarea" || tag === "select" || (tag === "input" && !["checkbox", "range", "button"].includes(e.target.type));
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
  if (typing) return;
  const k = e.key;
  const handled = () => e.preventDefault();
  if (ctrl && k.toLowerCase() === "z") { handled(); return e.shiftKey ? redo() : undo(); }
  if (ctrl && k.toLowerCase() === "y") { handled(); return redo(); }
  if (ctrl || (e.altKey && !["ArrowLeft", "ArrowRight"].includes(k))) return;
  switch (k) {
    case " ": handled(); actions.play(); break;
    case "f": case "F": handled(); addStroke("L", e.shiftKey ? "accent" : "normal"); break;
    case "j": case "J": handled(); addStroke("R", e.shiftKey ? "accent" : "normal"); break;
    case "d": case "D": handled(); addStroke("L", "ghost"); break;
    case "k": case "K": handled(); addStroke("R", "ghost"); break;
    case "a": case "A": handled(); actions.accent(); break;
    case "g": case "G": handled(); actions.ghost(); break;
    case "x": case "X": handled(); actions.error(); break;
    case "h": case "H": handled(); actions.flip(); break;
    case "m": case "M": handled(); editSelected((s) => { s.t = Math.round(video.currentTime * 10000) / 10000; }); break;
    case "c": case "C": handled(); setMarker("clap_t"); break;
    case "i": case "I": handled(); setMarker("eval_start_s"); break;
    case "o": case "O": handled(); setMarker("eval_end_s"); break;
    case "z": case "Z": handled(); e.shiftKey ? redo() : undo(); break;
    case "Delete": case "Backspace": handled(); deleteSelected(); break;
    case "Escape": selectedId = null; renderAll(); break;
    case "1": setRate(0.25); break;
    case "2": setRate(0.5); break;
    case "3": setRate(1); break;
    case ",": handled(); stepFrame(-1); break;
    case ".": handled(); stepFrame(1); break;
    case "ArrowLeft": case "ArrowRight": {
      handled();
      const dir = k === "ArrowLeft" ? -1 : 1;
      if (e.altKey) editSelected((s) => { s.t = Math.max(0, Math.round((s.t + dir * 0.005) * 10000) / 10000); });
      else if (e.shiftKey) seek(video.currentTime + dir);
      else stepFrame(dir);
      break;
    }
    case "ArrowUp": handled(); selectStep(-1); break;
    case "ArrowDown": handled(); selectStep(1); break;
    default: break;
  }
});

// ---------- start ----------
setZoom(window.innerWidth < 640 ? 2 : 4, 0, 0);
loadClips().then(() => {
  const m = location.hash.match(/clip=([a-z0-9-]+)/);
  if (m) openClip(m[1]);
});
