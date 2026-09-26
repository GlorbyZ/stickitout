// Record mode: opens the camera (preferring 1080p at 60 fps), draws the MediaPipe
// skeleton live over the preview, gives framing guidance, and records the raw
// camera stream plus microphone with MediaRecorder. The overlay lives on a
// separate canvas, so it is never baked into the recorded file.
import { loadLandmarkers, drawSkeleton, framingAdvice } from "./skeleton.js";

export const MIN_FPS = 50; // must match app/media.py MIN_FPS
const MAX_SECONDS = 300;
const MIME_TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4",
  "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm",
];

const $ = (id) => document.getElementById(id);

export function initRecord({ onTake, maxBytes = () => null }) {
  const stage = $("stage"), video = $("preview"), canvas = $("overlay"), ctx = canvas.getContext("2d");
  const hudFps = $("hud-fps"), hudRes = $("hud-res"), hudRec = $("hud-rec"), framing = $("framing");
  const recBtn = $("rec-btn"), camSelect = $("cam-select"), mirror = $("mirror"), showSkel = $("show-skel");
  let stream = null, landmarkers = null, lastResult = null, running = false;
  let recorder = null, chunks = [], recBytes = 0, recFrames = [], recStart = 0, recTimer = null, take = null, capped = false;
  let fpsWindow = [], adviceAt = 0, detectAt = 0, detectCost = 0, paused = false;
  const CHEAP_DETECT_MS = 12;

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    const w = $("secure-warning");
    w.hidden = false;
    w.innerHTML = "The camera only works on a secure page. On this computer open <b>http://localhost:8800</b> " +
      "(or 127.0.0.1). To record on a phone, open the analyzer through an HTTPS tunnel (see the README). " +
      "You can still use <b>Upload a video</b>.";
    $("cam-start").disabled = true;
  }

  async function startCamera(deviceId) {
    stopCamera();
    const video_c = {
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, min: 24 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
    };
    // Drum hits are transients: turn off voice processing so they are not squashed.
    const audio_c = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: video_c, audio: audio_c });
    } catch (err) {
      showFraming("bad", cameraError(err));
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    $("stage-empty").hidden = true;
    const s = stream.getVideoTracks()[0].getSettings();
    hudRes.textContent = `${s.width}x${s.height}${s.frameRate ? ` @ ${Math.round(s.frameRate)} fps asked` : ""}`;
    mirror.checked = s.facingMode ? s.facingMode === "user" : !deviceId || mirror.checked;
    applyMirror();
    await listCameras(s.deviceId);
    recBtn.disabled = false;
    running = true;
    fpsWindow = [];
    loop();
    showFraming("warn", "Loading the skeleton model...");
    try {
      landmarkers = await loadLandmarkers();
    } catch (err) {
      showFraming("warn", "Could not load the live skeleton (needs internet for the MediaPipe files). You can still record.");
    }
  }

  function stopCamera() {
    running = false;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  async function listCameras(activeId) {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    camSelect.hidden = cams.length < 2;
    camSelect.innerHTML = cams.map((c, i) =>
      `<option value="${c.deviceId}" ${c.deviceId === activeId ? "selected" : ""}>${c.label || `Camera ${i + 1}`}</option>`).join("");
  }

  function cameraError(err) {
    if (err.name === "NotAllowedError") return "Camera or microphone permission was blocked. Allow both in your browser settings and try again.";
    if (err.name === "NotFoundError") return "No camera or microphone found on this device.";
    if (err.name === "OverconstrainedError") return "This camera cannot do the requested format. Try another camera.";
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
      onFrame(meta ? meta.mediaTime : video.currentTime, meta ? meta.presentedFrames : fallbackCount(), now);
      hasRVFC ? video.requestVideoFrameCallback(tick) : requestAnimationFrame((t) => tick(t));
    };
    hasRVFC ? video.requestVideoFrameCallback(tick) : requestAnimationFrame((t) => tick(t));
  }

  const rate = (a, b) => (b && a && b.t > a.t ? (b.n - a.n) / (b.t - a.t) : 0);

  function onFrame(mediaTime, presented, now) {
    const sample = { t: mediaTime, n: presented };
    fpsWindow.push(sample);
    while (fpsWindow.length > 2 && mediaTime - fpsWindow[0].t > 1.5) fpsWindow.shift();
    if (recorder?.state === "recording") { recFrames[0] ??= sample; recFrames[1] = sample; }
    if (fpsWindow.length > 2 && fpsWindow.at(-1).t - fpsWindow[0].t > 0.5) {
      const fps = rate(fpsWindow[0], fpsWindow.at(-1));
      hudFps.textContent = `camera ${fps.toFixed(1)} fps${fps < MIN_FPS ? ": needs 60" : ""}`;
      hudFps.className = `pill ${fps < MIN_FPS ? "warn" : "good"}`;
    }
    if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
    // Throttle detection (about 30 Hz preview, 10 Hz while recording). If detection
    // is expensive on this device (no GPU), pause it while recording so the encoder
    // keeps the CPU it needs for a full 60 fps file.
    const recording = recorder?.state === "recording";
    const pause = recording && detectCost > CHEAP_DETECT_MS;
    if (pause !== paused) {
      paused = pause;
      if (pause) { ctx.clearRect(0, 0, canvas.width, canvas.height); showFraming("warn", "Skeleton paused while recording so this device can keep 60 fps. Keep playing."); }
    }
    if (landmarkers && !pause && video.readyState >= 2 && now - detectAt >= (recording ? 100 : 33)) {
      detectAt = now;
      const t0 = performance.now();
      try { lastResult = landmarkers.detect(video); } catch { lastResult = null; }
      detectCost = detectCost ? 0.8 * detectCost + 0.2 * (performance.now() - t0) : performance.now() - t0;
      if (showSkel.checked) drawSkeleton(ctx, lastResult, canvas.width, canvas.height);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (now - adviceAt > 400) {
        adviceAt = now;
        const a = framingAdvice(lastResult);
        showFraming(a.level, a.text);
      }
    }
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
    const mimeType = MIME_TYPES.find((m) => window.MediaRecorder?.isTypeSupported?.(m));
    if (!window.MediaRecorder) { showFraming("bad", "This browser cannot record video. Record with your camera app and use Upload."); return; }
    $("take").hidden = true;
    recBtn.disabled = true;
    await countdown(3);
    chunks = []; recFrames = []; recBytes = 0; capped = false;
    // Record the raw camera + mic stream (not the canvas), so the skeleton is not in the file.
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
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
      `${ext.toUpperCase()} (${type.split(";")[0]}), ${(blob.size / 1e6).toFixed(1)} MB.`;
    const warn = $("take-warning");
    warn.hidden = !(fps && fps < MIN_FPS);
    warn.textContent = `This take came out at about ${Math.round(fps)} fps. Form analysis needs 60 fps, so the analyzer will ` +
      "reject it. Add light (cameras drop to 30 fps in dim rooms), close other apps, or pick another camera, then record again.";
    if (capped) $("take-info").innerHTML += " Recording stopped automatically at the upload size limit.";
    $("take").hidden = false;
    recBtn.disabled = false;
  }

  $("cam-start").addEventListener("click", () => startCamera());
  camSelect.addEventListener("change", () => startCamera(camSelect.value));
  mirror.addEventListener("change", applyMirror);
  recBtn.addEventListener("click", () => (recorder?.state === "recording" ? stopRecording() : startRecording()));
  $("take-discard").addEventListener("click", () => { $("take").hidden = true; take = null; });
  $("take-analyze").addEventListener("click", () => take && onTake(take.blob, take.filename));
  return { stop: () => { if (recorder?.state === "recording") stopRecording(); stopCamera(); } };
}
