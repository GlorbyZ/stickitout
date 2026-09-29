// Browser-side MediaPipe (Tasks Vision JS, loaded from CDN) and skeleton drawing.
// Used for the live Record preview and the optional overlay on result playback.
// This is a framing aid only: scoring always runs on the server from the uploaded file.

export const VERSION = "1.0.1";
export const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODELS = "https://storage.googleapis.com/mediapipe-models";
// The lite pose model keeps the live preview at full frame rate on phones; the server uses the full model.
export const POSE_MODEL = `${MODELS}/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`;
export const HAND_MODEL = `${MODELS}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`;

export const GOLD = "#f5c518";
const ARM_LINKS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];
const BODY_LINKS = [[11, 23], [12, 24], [23, 24], [0, 11], [0, 12]];
const ARM_JOINTS = [11, 12, 13, 14, 15, 16];
const HAND_LINKS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10],
  [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

let loading = null;

/** Load PoseLandmarker + HandLandmarker once on this thread (GPU, falling back to CPU).
 * Used where the pose Worker is not available (see pose-engine.js). */
export function loadLandmarkers() {
  if (!loading) {
    loading = (async () => {
      const { FilesetResolver, PoseLandmarker, HandLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
      const make = (delegate) => Promise.all([
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate }, runningMode: "VIDEO", numPoses: 1,
        }),
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: "VIDEO", numHands: 2,
        }),
      ]);
      let pose, hands;
      let delegate = "GPU";
      try { [pose, hands] = await make("GPU"); } catch { delegate = "CPU"; [pose, hands] = await make("CPU"); }
      let last = 0;
      return {
        delegate,
        /** Detect on a frame (video, canvas, ImageBitmap). VIDEO mode timestamps must strictly increase:
         * pass the frame's own time in ms (requestVideoFrameCallback mediaTime) when there is one. */
        detect(source, tsMs) {
          const ts = Math.max(last + 1, Math.round(tsMs ?? performance.now()));
          last = ts;
          return { pose: pose.detectForVideo(source, ts), hands: hands.detectForVideo(source, ts) };
        },
      };
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

const visible = (p) => p && (p.visibility === undefined || p.visibility >= 0.5);

/** Interior angle at b, in degrees, for three normalized points. */
export function jointAngle(a, b, c) {
  if (!a || !b || !c) return null;
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (d < 1e-8) return null;
  return Math.round(Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * 180 / Math.PI);
}

/** Elbow sits further from the body midline than its shoulder. */
export function elbowFlared(pose, elbowId, shoulderId) {
  const left = pose?.[11], right = pose?.[12];
  const elbow = pose?.[elbowId], shoulder = pose?.[shoulderId];
  if (!left || !right || !elbow || !shoulder) return false;
  const mid = (left.x + right.x) / 2;
  return Math.abs(elbow.x - mid) > Math.abs(shoulder.x - mid) + 0.06;
}

/** Draw pose + hands. opts.sticks draws the estimated stick. opts.joints labels the elbow angle. */
export function drawSkeleton(ctx, result, w, h, opts = {}) {
  if (opts.clear !== false) ctx.clearRect(0, 0, w, h);
  const lw = Math.max(2, w / 320);
  const pose = result?.pose?.landmarks?.[0];
  const line = (a, b, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
  };
  const dot = (p, r, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2); ctx.fill();
  };

  if (opts.pad && result?.drum_pad) {
    const pad = result.drum_pad;
    ctx.strokeStyle = "rgba(245,197,24,0.55)";
    ctx.lineWidth = lw * 1.2;
    ctx.beginPath(); ctx.arc(pad.x * w, pad.y * h, pad.r * w, 0, Math.PI * 2); ctx.stroke();
  }

  ctx.lineCap = "round";
  const showBody = pose && opts.skeleton !== false;
  const showJoints = pose && opts.joints;
  if (showBody || showJoints) {
    if (showBody) {
      for (const [a, b] of BODY_LINKS) if (visible(pose[a]) && visible(pose[b])) line(pose[a], pose[b], "rgba(255,255,255,0.45)", lw);
    }
    const arms = [[[11, 13], [13, 15], 13, 11], [[12, 14], [14, 16], 14, 12]];
    for (const [up, fore, elbow, shoulder] of arms) {
      const flared = showJoints && elbowFlared(pose, elbow, shoulder);
      const color = flared ? "#ff5a4a" : GOLD;
      if (showBody && visible(pose[up[0]]) && visible(pose[up[1]])) line(pose[up[0]], pose[up[1]], color, lw * 2.2);
      if (showBody && visible(pose[fore[0]]) && visible(pose[fore[1]])) line(pose[fore[0]], pose[fore[1]], color, lw * 2.2);
      if (showJoints && pose[shoulder] && pose[elbow] && pose[fore[1]]) {
        const deg = jointAngle(pose[shoulder], pose[elbow], pose[fore[1]]);
        if (deg != null) {
          const x = pose[elbow].x * w, y = pose[elbow].y * h - lw * 6;
          const label = `${deg}°`;
          ctx.font = `700 ${Math.round(lw * 11)}px system-ui, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(0,0,0,0.72)";
          ctx.fillRect(x - tw / 2 - 6, y - Math.round(lw * 14), tw + 12, Math.round(lw * 16));
          ctx.fillStyle = "#fff4d2";
          ctx.fillText(label, x, y);
        }
      }
    }
    for (const i of ARM_JOINTS) {
      if (!visible(pose[i])) continue;
      dot(pose[i], lw * (i >= 15 ? 4.5 : 3.2), "#111");
      dot(pose[i], lw * (i >= 15 ? 3.4 : 2.4), i >= 15 ? "#ffffff" : GOLD);
    }
  }
  if (opts.skeleton !== false) {
    for (const hand of result?.hands?.landmarks ?? []) {
      for (const [a, b] of HAND_LINKS) if (hand[a] && hand[b]) line(hand[a], hand[b], "#4fd1ff", lw * 1.2);
      for (const p of hand) if (p) dot(p, lw * 1.3, "#ffffff");
    }
  }

  if (opts.sticks && result?.sticks) {
    result.sticks.forEach((s, i) => {
      const hand = result.hands?.landmarks?.[i];
      if (!s || !hand?.[0]) return;
      const grip = hand[9] || hand[0];
      line(grip, s, "#e8a317", lw * 3.2);
      dot(s, lw * 3.4, "#fff4d2");
    });
  }
}

let motionCanvas = null;
let motionCtx = null;
let prevGray = null;
let tipState = [null, null];

function grayOf(data, i) {
  return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
}

function sampleAt(gray, w, h, x, y) {
  const xi = x | 0, yi = y | 0;
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return -1;
  return gray[yi * w + xi];
}

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function oneEuroAlpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Low lag on a fast stroke, steady when the stick is sitting still. */
function smoothTip(side, raw, t) {
  const s = tipState[side];
  if (!s || !(t > s.t) || t - s.t > 0.25) {
    tipState[side] = { x: raw.x, y: raw.y, dx: 0, dy: 0, t, angle: raw.angle, length: raw.length };
    return { x: raw.x, y: raw.y };
  }
  const dt = t - s.t;
  const ad = oneEuroAlpha(1, dt);
  s.dx += ad * ((raw.x - s.x) / dt - s.dx);
  s.dy += ad * ((raw.y - s.y) / dt - s.dy);
  const speed = Math.hypot(s.dx, s.dy);
  const a = oneEuroAlpha(1.15 + speed * 7, dt);
  s.x += a * (raw.x - s.x);
  s.y += a * (raw.y - s.y);
  s.t = t;
  s.angle += angleDelta(raw.angle, s.angle) * 0.55;
  s.length += (raw.length - s.length) * 0.45;
  return { x: s.x, y: s.y };
}

function scoreRay(gray, previous, w, h, ox, oy, ang, handLen, prior) {
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const px = -uy, py = ux;
  const start = handLen * 0.4;
  const max = handLen * 4.4;
  let score = 0;
  let tipDist = 0;
  let gap = 0;
  let seen = 0;
  for (let dist = start; dist <= max; dist += 2) {
    const x = ox + ux * dist, y = oy + uy * dist;
    const c = sampleAt(gray, w, h, x, y);
    const left = sampleAt(gray, w, h, x + px * 3, y + py * 3);
    const right = sampleAt(gray, w, h, x - px * 3, y - py * 3);
    if (c < 0 || left < 0 || right < 0) break;
    const contrast = Math.abs(c - (left + right) * 0.5);
    let motion = 0;
    if (previous) {
      const prev = sampleAt(previous, w, h, x, y);
      if (prev >= 0) motion = Math.abs(c - prev);
    }
    if (contrast > 10 || motion > 18) {
      const reach = (dist - start) / handLen;
      score += (contrast + motion * 0.4) * (0.4 + reach);
      tipDist = dist;
      gap = 0;
      seen++;
    } else if (seen) {
      gap++;
      if (gap > 3) break;
    }
  }
  if (seen < 4 || tipDist < handLen * 0.9) return null;
  if (prior && prior.length > 0) {
    const dAng = Math.abs(angleDelta(ang, prior.angle));
    const dLen = Math.abs(tipDist - prior.length) / prior.length;
    score += Math.max(0, 160 - dAng * 210);
    score -= Math.min(140, dLen * 160);
  }
  return { score, tipDist, ang };
}

function rayTip(gray, previous, w, h, wrist, grip, prior) {
  const wx = wrist.x * w, wy = wrist.y * h;
  const gx = grip.x * w, gy = grip.y * h;
  let hx = gx - wx, hy = gy - wy;
  const handLen = Math.hypot(hx, hy);
  if (handLen < 4) return null;
  const base = Math.atan2(hy, hx);
  let best = null;
  const consider = (ang) => {
    const hit = scoreRay(gray, previous, w, h, gx, gy, ang, handLen, prior);
    if (hit && (!best || hit.score > best.score)) best = hit;
  };
  for (let deg = -56; deg <= 56; deg += 4) consider(base + deg * Math.PI / 180);
  if (best) {
    for (let deg = -8; deg <= 8; deg += 1.5) consider(best.ang + deg * Math.PI / 180);
  }
  if (prior) {
    for (let deg = -14; deg <= 14; deg += 1.5) consider(prior.angle + deg * Math.PI / 180);
  }
  if (!best || best.score < 70) return null;
  const ux = Math.cos(best.ang), uy = Math.sin(best.ang);
  return {
    x: (gx + ux * best.tipDist) / w,
    y: (gy + uy * best.tipDist) / h,
    angle: best.ang,
    length: best.tipDist,
  };
}

export function resetStickTrack() {
  prevGray = null;
  tipState = [null, null];
}

/**
 * Stick tips from the shaft in the picture. Each hand searches a fan of lines.
 * The line is the thin edge that also moves, kept near last frame's angle.
 * Returns [left, right] in normalized coordinates. `time` is the video clock.
 */
export function motionTips(video, hands, pose, time = 0) {
  const empty = [null, null];
  try {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2 || !pose?.[15] || !pose?.[16]) {
      return [tipState[0] && { x: tipState[0].x, y: tipState[0].y }, tipState[1] && { x: tipState[1].x, y: tipState[1].y }];
    }
    const w = Math.min(vw, 480);
    const h = Math.max(2, Math.round(vh * (w / vw)));
    if (!motionCanvas) {
      motionCanvas = document.createElement("canvas");
      motionCtx = motionCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (motionCanvas.width !== w || motionCanvas.height !== h) {
      motionCanvas.width = w;
      motionCanvas.height = h;
      prevGray = null;
      tipState = [null, null];
    }
    motionCtx.drawImage(video, 0, 0, w, h);
    const pix = motionCtx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) gray[p] = grayOf(pix, i);
    const previous = prevGray;
    prevGray = gray;
    if (!previous || previous.length !== gray.length) {
      return [tipState[0] && { x: tipState[0].x, y: tipState[0].y }, tipState[1] && { x: tipState[1].x, y: tipState[1].y }];
    }
    const ranked = [];
    (hands || []).forEach((hand) => {
      const wrist = hand?.[0];
      const index = hand?.[5], middle = hand?.[9];
      const grip = index && middle
        ? { x: index.x * 0.45 + middle.x * 0.55, y: index.y * 0.45 + middle.y * 0.55 }
        : (middle || index || wrist);
      if (!wrist || !grip) return;
      const dl = Math.hypot(wrist.x - pose[15].x, wrist.y - pose[15].y);
      const dr = Math.hypot(wrist.x - pose[16].x, wrist.y - pose[16].y);
      ranked.push({ wrist, grip, side: dl <= dr ? 0 : 1, dist: Math.min(dl, dr) });
    });
    ranked.sort((a, b) => a.dist - b.dist);
    const used = new Set();
    const out = [null, null];
    for (const item of ranked) {
      let side = item.side;
      if (used.has(side)) side = side === 0 ? 1 : 0;
      if (used.has(side)) continue;
      used.add(side);
      const measured = rayTip(gray, previous, w, h, item.wrist, item.grip, tipState[side]);
      if (measured) out[side] = smoothTip(side, measured, time);
      else if (tipState[side] && time - tipState[side].t < 0.07) {
        const dt = Math.max(0, time - tipState[side].t);
        out[side] = { x: tipState[side].x + tipState[side].dx * dt * 0.35, y: tipState[side].y + tipState[side].dy * dt * 0.35 };
      }
    }
    return out;
  } catch {
    return empty;
  }
}

/** Framing guidance from one detection result. Returns {level: ok|warn|bad, text}. */
export function framingAdvice(result) {
  const pose = result?.pose?.landmarks?.[0];
  if (!pose) return { level: "bad", text: "No one in frame. Sit at your pad or kit so your whole upper body is in view." };
  const lwOk = visible(pose[15]), rwOk = visible(pose[16]);
  if (!lwOk && !rwOk) return { level: "bad", text: "Step back: both arms not visible. Show your full torso, both arms and the playing surface." };
  if (!lwOk || !rwOk) return { level: "bad", text: `Step back or re-center: ${!lwOk ? "left" : "right"} wrist not visible.` };
  if (!visible(pose[11]) || !visible(pose[12])) return { level: "bad", text: "Tilt or raise the camera so both shoulders are in frame." };
  const pts = [11, 12, 13, 14, 15, 16].map((i) => pose[i]);
  if (pts.some((p) => p.x < 0.03 || p.x > 0.97 || p.y < 0.03 || p.y > 0.97)) {
    return { level: "warn", text: "Too close to the edge. Step back a little so your arms have room while you play." };
  }
  const shoulderW = Math.hypot(pose[11].x - pose[12].x, pose[11].y - pose[12].y);
  const upperArm = Math.hypot(pose[11].x - pose[13].x, pose[11].y - pose[13].y);
  if (Math.max(shoulderW, upperArm) < 0.08) return { level: "warn", text: "You are small in the frame. Move the camera closer." };
  const nHands = result?.hands?.landmarks?.length ?? 0;
  if (nHands < 2) return { level: "warn", text: "Arms look good. Hands are not both tracked yet: add light or turn a little toward the camera." };
  return { level: "ok", text: "Good framing: shoulders, elbows, wrists and both hands are visible." };
}
