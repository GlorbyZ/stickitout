// Record mode: opens the camera at 60 fps (camera.js constraint ladder, then
// applyConstraints when the camera can do 60), shows the live fps in a badge, draws the
// MediaPipe skeleton over the preview, gives framing guidance, and records the raw camera
// stream plus microphone with MediaRecorder. The overlay lives on a separate canvas, so it
// is never baked into the recorded file.
import { drawSkeleton, framingAdvice } from "./skeleton.js";
import { createPoseEngine } from "./pose-engine.js";
import { overlaySize, rateMeter } from "./overlay.js";
import {
  constraintLadder, retryable, boostConstraints, fpsBadge, liveFps, lowFpsTip, isPhone,
  friendlyCameras, bestCamera, pickMimeType, videoBitrate, skeletonPlan,
} from "./camera.js";

// Defaults until /api/config answers (server values: MIN_FPS env var and media.LOW_FPS_BELOW).
export const DEFAULT_MIN_FPS = 23.5;   // below this the server rejects the take
export const FULL_ACCURACY_FPS = 50;   // below this the take is analysed with a low frame rate disclaimer
const MAX_SECONDS = 300;
const CAM_KEY = "sio.camera";   // label of the camera the member picked last (deviceIds can rotate)
const TIP_AFTER_S = 2;          // seconds of measurement before the low fps tip shows

const $ = (id) => document.getElementById(id);

export function initRecord({ onTake, maxBytes = () => null, fpsLimits = () => ({}) }) {
  const limits = () => ({ min: DEFAULT_MIN_FPS, full: FULL_ACCURACY_FPS, ...fpsLimits() });
  const stage = $("stage"), video = $("preview"), canvas = $("overlay"), ctx = canvas.getContext("2d");
  const hudFps = $("hud-fps"), hudRes = $("hud-res"), hudRec = $("hud-rec"), framing = $("framing");
  const recBtn = $("rec-btn"), camSelect = $("cam-select"), camFlip = $("cam-flip"), mirror = $("mirror"), showSkel = $("show-skel");
  const fpsTip = $("fps-tip"), camBar = $("cam-bar"), phone = isPhone(navigator.userAgent, navigator.maxTouchPoints || 0);
  let stream = null, engine = null, lastResult = null, running = false, cameras = [], autoPicked = false, startSeq = 0;
  let settingsFps = 0, measuredFps = 0, measureSince = 0, badgeAt = 0;
  let recorder = null, chunks = [], recBytes = 0, recFrames = [], recStart = 0, recTimer = null, take = null, capped = false, recBitrate = 0;
  let fpsWindow = [], adviceAt = 0, paused = false, heldForTake = false;
  // Live skeleton stats: results per second, inference time in the worker, round trip.
  const skelMeter = rateMeter(1000);
  let inferMs = 0, poseMs = 0, handsMs = 0, latencyMs = 0, statsAt = 0, slowSeconds = 0, lastSkelCheck = 0;
  const debugBox = $("show-stats"), hudDebug = $("hud-debug"), skelNote = $("skel-note");
  if (new URLSearchParams(location.search).has("debug") && debugBox) debugBox.checked = true;

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const w = $("secure-warning");
    w.hidden = false;
    w.innerHTML = "The camera only works on a secure page. On this computer open <b>http://localhost:8800</b> " +
      "(or 127.0.0.1). To record on a phone, open the analyzer through an HTTPS tunnel (see the README). " +
      "You can still use <b>Upload a video</b>.";
    $("cam-start").disabled = true;
  }

  // Try the constraint ladder: 60 fps with a 50 fps floor at 720p then 1080p, then 60 ideal
  // with no floor, then whatever the camera gives. Permission errors stop at once.
  async function openStream(deviceId) {
    // Drum hits are transients: turn off voice processing so they are not squashed.
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
    let lastErr = null;
    for (const video of constraintLadder({ deviceId, facingMode: "environment" })) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video, audio });
      } catch (err) {
        lastErr = err;
        if (!retryable(err)) break;
      }
    }
    throw lastErr;
  }

  // Ask a running track for 60 fps when its capabilities say it can.
  async function boost60(track) {
    const want = boostConstraints(track.getCapabilities?.(), track.getSettings());
    if (!want) return;
    try { await track.applyConstraints(want); } catch { /* keep what we have */ }
  }

  async function startCamera(deviceId, { auto = false } = {}) {
    const seq = ++startSeq;
    stopCamera();
    try {
      stream = await openStream(deviceId);
    } catch (err) {
      if (deviceId && err?.name !== "NotAllowedError") return startCamera(null, { auto: true });
      showFraming("bad", cameraError(err));
      return;
    }
    if (seq !== startSeq) { stream.getTracks().forEach((t) => t.stop()); return; }
    const track = stream.getVideoTracks()[0];
    await boost60(track);
    video.srcObject = stream;
    await video.play().catch(() => {});
    $("stage-empty").hidden = true;
    const s = track.getSettings();
    settingsFps = s.frameRate || 0;
    measuredFps = 0; measureSince = performance.now(); fpsTip.hidden = true;
    showFps();
    hudRes.textContent = `${s.width}x${s.height}${s.frameRate ? `, camera set to ${Math.round(s.frameRate)} fps` : ""}`;
    // Mirror only a camera that faces the member (front camera or webcam), never the back camera.
    const facing = s.facingMode || cameras.find((c) => c.deviceId === s.deviceId)?.kind;
    mirror.checked = facing === "user" || facing === "front" || (!facing && !phone);
    // Labels are only readable after permission, so the list is refreshed now.
    await listCameras(s.deviceId, s.facingMode);
    applyMirror();
    // First start: switch once to the camera the member picked before, or else to the best
    // camera for drumming (the main back camera on phones) when the browser opened another.
    if (!autoPicked) {
      autoPicked = true;
      const active = cameras.find((c) => c.deviceId === s.deviceId);
      const target = cameras.find((c) => c.deviceId === rememberedCamera()) || bestCamera(cameras);
      const better = target && active && target.deviceId !== active.deviceId &&
        (target.deviceId === rememberedCamera() || target.rank < active.rank);
      if (better) return startCamera(target.deviceId, { auto: true });
    }
    recBtn.disabled = false;
    running = true;
    fpsWindow = [];
    loop();
    if (!engine) {
      showFraming("warn", "Loading the skeleton model...");
      engine = createPoseEngine({ onResult: onPose });
      try {
        await engine.ready;
      } catch (err) {
        engine = null;
        showFraming("warn", "Could not load the live skeleton (needs internet for the MediaPipe files). You can still record.");
      }
    }
  }

  function stopCamera() {
    running = false;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function rememberedCamera() {
    const label = localStorage.getItem(CAM_KEY);
    return label ? cameras.find((c) => c.title === label)?.deviceId || null : null;
  }

  async function listCameras(activeId, activeFacing) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    cameras = friendlyCameras(devices, activeId && activeFacing ? { [activeId]: activeFacing } : {});
    camBar.hidden = cameras.length === 0;
    camSelect.disabled = cameras.length < 2;
    camFlip.hidden = cameras.length < 2;
    camSelect.replaceChildren(...cameras.map((c) => {
      const o = document.createElement("option");
      o.value = c.deviceId;
      o.textContent = c.name;
      o.title = c.title;            // raw device label for the curious
      o.selected = c.deviceId === activeId;
      return o;
    }));
    const active = cameras.find((c) => c.deviceId === activeId);
    camSelect.title = active ? active.title : "";
  }

  function pickCamera(deviceId) {
    const cam = cameras.find((c) => c.deviceId === deviceId);
    if (cam) localStorage.setItem(CAM_KEY, cam.title);
    startCamera(deviceId);
  }

  // Switch camera: front and back on phones, next camera elsewhere.
  function flipCamera() {
    if (cameras.length < 2) return;
    const i = cameras.findIndex((c) => c.deviceId === camSelect.value);
    const cur = cameras[i];
    const other = cur && (cur.kind === "back" || cur.kind === "front")
      ? bestCamera(cameras.filter((c) => c.kind === (cur.kind === "back" ? "front" : "back")))
      : null;
    pickCamera((other || cameras[(i + 1) % cameras.length]).deviceId);
  }

  // The badge shows the measured rate once there is one, else what the camera reports.
  function showFps() {
    const fps = liveFps(measuredFps, settingsFps);
    const { min, full } = limits();
    const b = fpsBadge(fps, { min, full });
    hudFps.textContent = b.text;
    hudFps.className = `pill fps-badge ${b.level}`;
    hudFps.title = `Camera set to ${settingsFps ? Math.round(settingsFps) : "?"} fps, measured ${measuredFps ? measuredFps.toFixed(1) : "?"} fps`;
    if (fps && fps < full && measuredFps && performance.now() - measureSince > TIP_AFTER_S * 1000) {
      fpsTip.textContent = lowFpsTip(fps, phone);
      fpsTip.hidden = false;
    } else if (fps >= full) {
      fpsTip.hidden = true;
    }
  }

  function cameraError(err) {
    if (err.name === "NotAllowedError") return "Camera or microphone permission was blocked. Allow both in your browser settings and try again.";
    if (err.name === "NotFoundError") return "No camera or microphone found on this device.";
    if (err.name === "OverconstrainedError") return "This camera cannot do the requested format. Try another camera.";
    if (err.name === "NotReadableError") return "The camera is busy in another app or tab. Close it there and try again.";
    return `Could not open the camera: ${err.message || err.name}`;
  }

  // One tick per presented camera frame (requestVideoFrameCallback), falling back to rAF.
  function loop() {
    if (!running) return;
    const hasRVFC = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
    let n = 0, lastT = -1;
    const fallbackCount = () => { if (video.currentTime !== lastT) { lastT = video.currentTime; n++; } return n; };
    const tick = (now, meta) => {
      if (!running) return;
      // presentedFrames counts every frame the camera delivered, even ones whose
      // callback we skipped while busy, so the fps reading is not dragged down
      // by skeleton detection on slow devices.
      onFrame(meta ? meta.mediaTime : video.currentTime, meta ? meta.presentedFrames : fallbackCount(), now, meta);
      hasRVFC ? video.requestVideoFrameCallback(tick) : requestAnimationFrame((t) => tick(t));
    };
    hasRVFC ? video.requestVideoFrameCallback(tick) : requestAnimationFrame((t) => tick(t));
  }

  const rate = (a, b) => (b && a && b.t > a.t ? (b.n - a.n) / (b.t - a.t) : 0);

  function onFrame(mediaTime, presented, now, meta) {
    const sample = { t: mediaTime, n: presented };
    fpsWindow.push(sample);
    while (fpsWindow.length > 2 && mediaTime - fpsWindow[0].t > 1.5) fpsWindow.shift();
    if (recorder?.state === "recording") { recFrames[0] ??= sample; recFrames[1] = sample; }
    if (fpsWindow.length > 2 && fpsWindow.at(-1).t - fpsWindow[0].t > 0.5) {
      const fps = rate(fpsWindow[0], fpsWindow.at(-1));
      if (fps > 0 && (!measuredFps || now - badgeAt > 500)) {
        measuredFps = fps; badgeAt = now; showFps();
      }
    }
    sizeOverlay();
    // The skeleton runs on every camera frame, in preview and while recording: MediaPipe works
    // in a Worker (pose-engine.js) and the recording is the raw camera track, so the overlay
    // cannot lower the file's frame rate. While recording it stops only when switched off or
    // when a 60 fps camera really drops under 55 fps (camera.js skeletonPlan).
    const recording = recorder?.state === "recording";
    const plan = skeletonPlan({ recording, skeletonOn: showSkel.checked, fps: measuredFps, cameraFps: settingsFps, held: heldForTake });
    if (recording && !plan.run) heldForTake = true;
    if (!plan.run !== paused) {
      paused = !plan.run;
      if (paused) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (plan.reason === "fps") showFraming("warn", `Skeleton paused for this take: the camera dropped to ${Math.round(measuredFps)} fps. Keep playing.`);
        else if (plan.reason === "off") framing.hidden = true;
      }
    }
    if (engine && plan.run) engine.offer(video, meta);
    if (now - statsAt > 500) { statsAt = now; showStats(now); }
  }

  // Draw at display resolution with the video's aspect ratio (the canvas is object-fit: contain like the video).
  function sizeOverlay() {
    const box = stage.getBoundingClientRect();
    const size = overlaySize(box.width, box.height, video.videoWidth, video.videoHeight, Math.min(3, window.devicePixelRatio || 1));
    if (size.width && (canvas.width !== size.width || canvas.height !== size.height)) { canvas.width = size.width; canvas.height = size.height; }
  }

  // One pose result per processed camera frame. Drawn as soon as it arrives, for the frame it
  // belongs to; a frame without a pose clears the overlay (no stale skeleton, no smoothing lag).
  function onPose(r) {
    const now = performance.now();
    if (!running) return;
    skelMeter.add(now);
    inferMs = inferMs ? 0.85 * inferMs + 0.15 * r.ms : r.ms;
    latencyMs = latencyMs ? 0.85 * latencyMs + 0.15 * r.latency : r.latency;
    if (r.poseMs != null) poseMs = poseMs ? 0.85 * poseMs + 0.15 * r.poseMs : r.poseMs;
    if (r.handsMs != null) handsMs = handsMs ? 0.85 * handsMs + 0.15 * r.handsMs : r.handsMs;
    lastResult = { pose: { landmarks: r.pose ? [r.pose] : [] }, hands: { landmarks: r.hands || [] } };
    if (showSkel.checked && !paused) drawSkeleton(ctx, lastResult, canvas.width, canvas.height);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (now - adviceAt > 400 && !paused) {
      adviceAt = now;
      const a = framingAdvice(lastResult);
      showFraming(a.level, a.text);
    }
  }

  // Debug stats (Stats box or ?debug=1) and an honest note when the skeleton cannot keep up.
  function showStats(now) {
    const skelFps = skelMeter.rate(now);
    const mode = engine?.mode || "loading";
    if (debugBox?.checked) {
      hudDebug.hidden = false;
      hudDebug.textContent = `camera ${measuredFps ? measuredFps.toFixed(1) : "?"} fps | skeleton ${skelFps.toFixed(1)} fps | ` +
        `inference ${inferMs.toFixed(1)} ms${poseMs ? ` (pose ${poseMs.toFixed(1)}, hands ${handsMs.toFixed(1)})` : ""} | ` +
        `round trip ${latencyMs.toFixed(1)} ms | ${mode}`;
    } else {
      hudDebug.hidden = true;
    }
    if (now - lastSkelCheck < 1000) return;
    lastSkelCheck = now;
    const behind = engine?.mode && showSkel.checked && !paused && measuredFps > 1 && skelFps > 0 && skelFps < 0.9 * measuredFps;
    slowSeconds = behind ? slowSeconds + 1 : 0;
    if (slowSeconds >= 2) { skelNote.hidden = false; skelNote.textContent = `Skeleton running at ${Math.round(skelFps)} fps on this device`; }
    else if (!behind) skelNote.hidden = true;
  }

  function showFraming(level, text) {
    framing.hidden = false;
    framing.className = `notice ${level}`;
    framing.textContent = text;
  }

  function applyMirror() { stage.classList.toggle("mirrored", mirror.checked); }

  async function countdown(n) {
    const el = $("countdown");
    el.hidden = false;
    for (let i = n; i > 0; i--) { el.textContent = i; await new Promise((r) => setTimeout(r, 1000)); }
    el.hidden = true;
  }

  async function startRecording() {
    if (!stream) return;
    if (!window.MediaRecorder) { showFraming("bad", "This browser cannot record video. Record with your camera app and use Upload."); return; }
    $("take").hidden = true;
    recBtn.disabled = true;
    await countdown(3);
    chunks = []; recFrames = []; recBytes = 0; capped = false; heldForTake = false;
    // Record the raw camera + mic stream (not the canvas), so the skeleton is not in the file.
    // H.264 MP4 first (hardware encoders keep 60 fps), bitrate sized for the capture so fast
    // stick motion is not smeared into dropped frames.
    const s = stream.getVideoTracks()[0].getSettings();
    const mimeType = pickMimeType((m) => MediaRecorder.isTypeSupported(m));
    const videoBitsPerSecond = videoBitrate(s.width, s.height, Math.max(s.frameRate || 0, measuredFps || 0) || 60);
    recBitrate = videoBitsPerSecond;
    try {
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond, audioBitsPerSecond: 192_000 });
    } catch {
      recorder = new MediaRecorder(stream, { videoBitsPerSecond });
    }
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      recBytes += e.data.size;
      // Stop before the file outgrows the server's upload cap (100 MB behind a Cloudflare tunnel).
      const cap = maxBytes();
      if (cap && recBytes > 0.95 * cap && recorder.state === "recording") { capped = true; stopRecording(); }
    };
    recorder.onstop = finishTake;
    recorder.start(1000);
    recStart = performance.now();
    recBtn.textContent = "Stop"; recBtn.classList.replace("primary", "danger"); recBtn.disabled = false;
    hudRec.hidden = false;
    recTimer = setInterval(() => {
      const s = (performance.now() - recStart) / 1000;
      hudRec.textContent = `REC ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
      if (s >= MAX_SECONDS) stopRecording();
    }, 250);
  }

  function stopRecording() {
    if (recorder?.state === "recording") recorder.stop();
    heldForTake = false;
    clearInterval(recTimer);
    hudRec.hidden = true;
    recBtn.textContent = "Record"; recBtn.classList.replace("danger", "primary");
  }

  function finishTake() {
    const type = recorder.mimeType || chunks[0]?.type || "video/webm";
    const blob = new Blob(chunks, { type });
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const seconds = (performance.now() - recStart) / 1000;
    // Real frame rate from the camera frames presented while recording. MediaRecorder
    // files can be variable frame rate, so the server measures again from the file.
    const fps = rate(recFrames[0], recFrames[1]);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    take = { blob, filename: `take-${stamp}.${ext}`, fps, seconds };
    $("take-video").src = URL.createObjectURL(blob);
    $("take-info").innerHTML = `<b>${seconds.toFixed(1)} s</b> recorded, about <b>${fps ? fps.toFixed(1) : "?"} fps</b> measured, ` +
      `${ext.toUpperCase()} (${type.split(";")[0]}), ${(blob.size / 1e6).toFixed(1)} MB, encoder asked for ${(recBitrate / 1e6).toFixed(1)} Mbps. ` +
      "The server measures the saved file again after upload.";
    const warn = $("take-warning"), { min, full } = limits();
    warn.hidden = !(fps && fps < full);
    if (fps && fps < min) {
      warn.className = "notice bad";
      warn.textContent = `This take came out at about ${Math.round(fps)} fps. The analyzer needs at least ${Math.round(min)} fps, ` +
        "so it will reject it. Add light (cameras lower the frame rate in dim rooms), close other apps, or pick another camera, then record again.";
    } else {
      warn.className = "notice warn";
      warn.textContent = `This take came out at about ${Math.round(fps)} fps. It will be analysed, but fast strokes can fall between ` +
        "frames, so Verified, sticking and form scores will be estimates. For the most accurate results, record at 60 fps " +
        "(more light and closing other apps help).";
    }
    if (capped) $("take-info").innerHTML += " Recording stopped automatically at the upload size limit.";
    $("take").hidden = false;
    recBtn.disabled = false;
  }

  $("cam-start").addEventListener("click", () => startCamera());
  camSelect.addEventListener("change", () => pickCamera(camSelect.value));
  camFlip.addEventListener("click", flipCamera);
  mirror.addEventListener("change", applyMirror);
  recBtn.addEventListener("click", () => (recorder?.state === "recording" ? stopRecording() : startRecording()));
  $("take-discard").addEventListener("click", () => { $("take").hidden = true; take = null; });
  $("take-analyze").addEventListener("click", () => take && onTake(take.blob, take.filename));
  return { stop: () => { if (recorder?.state === "recording") stopRecording(); stopCamera(); } };
}
