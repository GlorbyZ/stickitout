// Camera helpers for Record mode: the 60 fps constraint ladder, the fps badge, friendly
// camera names, and MediaRecorder settings. Pure functions (no DOM), so they are unit
// tested with `node --test tests/js` (see tests/test_frontend_js.py).

export const TARGET_FPS = 60;
export const FPS_FLOOR = 50;   // asked as frameRate.min on the first tries

/**
 * getUserMedia video constraints to try in order. First 1280x720 and 1920x1080 with
 * frameRate {ideal: 60, min: 50}; then ideal 60 with no min; then anything the camera gives.
 * Without a deviceId, phones get the back camera (facingMode ideal "environment");
 * laptops without one still open their webcam because it is only "ideal".
 */
export function constraintLadder({ deviceId = null, facingMode = "environment" } = {}) {
  const who = deviceId ? { deviceId: { exact: deviceId } } : facingMode ? { facingMode: { ideal: facingMode } } : {};
  const hd = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const fhd = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  return [
    { ...who, ...hd, frameRate: { ideal: TARGET_FPS, min: FPS_FLOOR } },
    { ...who, ...fhd, frameRate: { ideal: TARGET_FPS, min: FPS_FLOOR } },
    { ...who, ...hd, frameRate: { ideal: TARGET_FPS } },
    { ...who, frameRate: { ideal: TARGET_FPS } },
    deviceId ? { ...who } : true,
  ];
}

/** Errors worth retrying with looser constraints (anything else, e.g. permission, stops the ladder). */
export function retryable(err) {
  return ["OverconstrainedError", "ConstraintNotSatisfiedError", "NotReadableError", "AbortError", "TypeError"].includes(err?.name);
}

/**
 * Constraints for track.applyConstraints() that push a running track to 60 fps, or null when
 * the camera cannot do it or already does. Width and height are repeated because
 * applyConstraints replaces the whole constraint set.
 */
export function boostConstraints(capabilities, settings) {
  const max = capabilities?.frameRate?.max;
  if (!max || max < TARGET_FPS) return null;
  if (settings?.frameRate && settings.frameRate >= TARGET_FPS - 0.5) return null;
  const size = settings?.width && settings?.height ? { width: { ideal: settings.width }, height: { ideal: settings.height } } : {};
  return { ...size, frameRate: TARGET_FPS };
}

/** Live fps: the measured rate once there is one, else what the camera reports. */
export function liveFps(measured, settingsFps) {
  return measured && measured > 1 ? measured : settingsFps || 0;
}

/** Badge text and level for the live fps. level: good (green), warn (brand accent), bad, idle. */
export function fpsBadge(fps, { min = 23.5, full = FPS_FLOOR } = {}) {
  if (!fps) return { text: "camera starting", level: "idle" };
  const n = Math.round(fps);
  if (fps >= full) return { text: `${n} fps`, level: "good" };
  if (fps >= min) return { text: `${n} fps, results will be estimates`, level: "warn" };
  return { text: `${n} fps, too low, add light`, level: "bad" };
}

export function isPhone(ua = "", maxTouchPoints = 0) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/** Tip shown when capture comes back under the full-accuracy rate. */
export function lowFpsTip(fps, phone) {
  const n = Math.round(fps);
  return phone
    ? "Your phone's browser is limited to 30 fps. For 60 fps, record in your Camera app at 60 fps and use Upload."
    : `This camera is giving about ${n} fps. More light or another camera may reach 60 fps. ` +
      "You can also record at 60 fps in a camera app and use Upload.";
}

const has = (s, re) => re.test(s);

/**
 * Friendly name, kind and preference rank for one camera. `facing` is an optional
 * facingMode ("user" / "environment") from the track settings or capabilities.
 * Lower rank is better for drumming: main back camera first, front camera last.
 */
export function describeCamera(label = "", facing = "") {
  const l = String(label).toLowerCase();
  const front = facing === "user" || has(l, /\bfront\b|facing front|selfie|user facing/);
  const back = !front && (facing === "environment" || has(l, /\bback\b|\brear\b|facing back|environment|world/));
  if (back || front) {
    let lens = "", rank = front ? 90 : 10;
    if (back) {
      if (has(l, /ultra ?wide|0\.5x|ultrawide/)) { lens = "ultra wide"; rank = 16; }
      else if (has(l, /tele(photo)?|zoom|[23]x\b|periscope/)) { lens = "telephoto"; rank = 18; }
      else if (has(l, /dual wide/)) { lens = "dual wide"; rank = 12; }
      else if (has(l, /triple/)) { lens = "triple"; rank = 13; }
      else if (has(l, /\bdual\b/)) { lens = "dual"; rank = 12; }
      else if (has(l, /\bwide\b/)) { lens = "wide"; rank = 14; }
      else if (has(l, /depth|macro|mono/)) { lens = has(l, /macro/) ? "macro" : "depth"; rank = 40; }
    }
    // Android "camera2 N, facing back": the lowest index is the main camera.
    const idx = l.match(/camera2? ?(\d+)/);
    if (idx && !lens) rank += Math.min(Number(idx[1]), 9) / 10;
    const base = front ? "Front camera" : "Back camera";
    return { name: lens ? `${base} (${lens})` : base, kind: front ? "front" : "back", rank };
  }
  if (has(l, /virtual|obs|snap camera|manycam|xsplit|nvidia broadcast|mmhmm/)) return { name: "Virtual camera", kind: "virtual", rank: 80 };
  if (has(l, /iphone|continuity|droidcam|iriun|epoccam|camo\b/)) return { name: "Phone camera", kind: "phone", rank: 20 };
  if (has(l, /integrated|built-?in|facetime|internal|laptop|\bhd webcam\b|hd camera|hp truevision|ir camera/)) return { name: "Laptop webcam", kind: "laptop", rank: 40 };
  if (has(l, /usb|logitech|brio|\bc9\d\d\b|razer|elgato|facecam|microsoft lifecam|anker|insta360|obsbot|webcam|\([0-9a-f]{4}:[0-9a-f]{4}\)/)) {
    return { name: "USB camera", kind: "usb", rank: 30 };
  }
  return { name: "Camera", kind: "other", rank: 60 };
}

/**
 * Turn enumerateDevices() video inputs into picker entries:
 * [{deviceId, name, title, kind, rank}], duplicates numbered ("Back camera 2"), raw label kept
 * as title. `facingById` optionally maps deviceId to a known facingMode.
 */
export function friendlyCameras(devices, facingById = {}) {
  const cams = devices.filter((d) => d.kind === "videoinput");
  const described = cams.map((d, i) => {
    const info = d.label ? describeCamera(d.label, facingById[d.deviceId]) : { name: "Camera", kind: "other", rank: 60 };
    return { deviceId: d.deviceId, title: d.label || `Camera ${i + 1}`, ...info };
  });
  const seen = {};
  const counts = described.reduce((m, c) => ((m[c.name] = (m[c.name] || 0) + 1), m), {});
  for (const c of described) {
    seen[c.name] = (seen[c.name] || 0) + 1;
    if (counts[c.name] > 1 && seen[c.name] > 1) c.name = `${c.name} ${seen[c.name]}`;
  }
  return described;
}

/** Best camera for drumming (main back camera on phones, then USB, then laptop webcam, front last). */
export function bestCamera(cameras) {
  return cameras.reduce((best, c) => (!best || c.rank < best.rank ? c : best), null);
}

/** MediaRecorder types in order: H.264 MP4 first (hardware encoders keep 60 fps), then VP8, VP9. */
export const MIME_TYPES = [
  "video/mp4;codecs=avc1.64002A,mp4a.40.2", "video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a",
  "video/mp4", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm",
];

export function pickMimeType(isTypeSupported) {
  return MIME_TYPES.find((m) => { try { return isTypeSupported(m); } catch { return false; } }) || "";
}

/** Video bitrate that keeps fast motion sharp at the captured size and rate (720p60 about 8.3 Mbps, 1080p60 12 Mbps). */
export function videoBitrate(width = 1280, height = 720, fps = TARGET_FPS) {
  const bits = Math.round((width || 1280) * (height || 720) * (fps || 30) * 0.15);
  return Math.max(4_000_000, Math.min(12_000_000, bits));
}

export const PAUSE_BELOW_FPS = 55;   // skeleton pauses for the rest of a take when a 60 fps camera drops under this
export const CHEAP_DETECT_MS = 8;    // detection slower than this per frame is paused while recording

/**
 * How often MediaPipe runs, counted in presented camera frames, and whether it pauses.
 * Pose tracking runs on the main thread, so while recording it is cut to about 10 Hz and
 * paused completely when the member turned the skeleton off, when detection is slow on this
 * device, or when the live rate of a 60 fps camera drops under 55. A pause holds until the
 * take ends. In preview it runs at about 30 Hz (every 2nd frame at 60 fps), backing off when
 * frames drop, and at about 10 Hz with the skeleton off (framing tips only).
 * Returns {every, pause, reason} with reason one of "", "off", "slow", "fps", "held".
 */
export function detectPlan({ recording = false, skeletonOn = true, detectCost = 0, fps = 0, cameraFps = 60, held = false } = {}) {
  const cam = cameraFps > 1 ? cameraFps : 30;
  const every = (hz) => Math.max(1, Math.round(cam / hz));
  const dropping = cam >= 58 && fps > 1 && fps < PAUSE_BELOW_FPS;
  if (recording) {
    if (held) return { every: 0, pause: true, reason: "held" };
    if (!skeletonOn) return { every: 0, pause: true, reason: "off" };
    if (detectCost > CHEAP_DETECT_MS) return { every: 0, pause: true, reason: "slow" };
    if (dropping) return { every: 0, pause: true, reason: "fps" };
    return { every: every(10), pause: false, reason: "" };
  }
  if (!skeletonOn) return { every: every(10), pause: false, reason: "" };
  if (detectCost > 16) return { every: every(15), pause: false, reason: "slow" };
  if (dropping) return { every: every(20), pause: false, reason: "fps" };
  return { every: every(30), pause: false, reason: "" };
}
