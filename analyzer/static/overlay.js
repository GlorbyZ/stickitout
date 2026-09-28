// Pure helpers for the skeleton overlays (no DOM), unit tested in tests/js/overlay.test.mjs.
//
// Playback: the server analyses every frame and stores its landmarks under the frame's
// presentation time (pts on the file's own timeline). Browsers report the same value as
// requestVideoFrameCallback metadata.mediaTime, so the overlay draws exactly the frame on
// screen. A frame without a detection draws nothing (never a stale pose). Interpolation is
// used only when the frame on screen is missing from the data.

/** Index of the entry in the sorted array `t` nearest to `x` (binary search). */
export function nearestIndex(t, x) {
  let lo = 0, hi = t.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid; else hi = mid;
  }
  return Math.abs(t[hi] - x) < Math.abs(t[lo] - x) ? hi : lo;
}

/** Median gap between consecutive timestamps (the nominal frame interval). */
export function frameInterval(t) {
  const gaps = [];
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) gaps.push(t[i] - t[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps.length ? gaps[gaps.length >> 1] : 1 / 30;
}

// Unpack one server frame into the shape drawSkeleton() takes.
function unpack(data, i) {
  const flat = data.pose[i];
  let pose = null;
  if (flat) {
    pose = [];
    data.points.forEach((id, k) => { pose[id] = { x: flat[3 * k], y: flat[3 * k + 1], visibility: flat[3 * k + 2] }; });
  }
  const hands = (data.hands[i] || []).map((h) => {
    const pts = [];
    for (let k = 0; k < h.length; k += 2) pts.push({ x: h[k], y: h[k + 1] });
    return pts;
  });
  return { pose: { landmarks: pose ? [pose] : [] }, hands: { landmarks: hands } };
}

const lerpPt = (a, b, f) => (a && b ? { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1) } : undefined);

/**
 * Landmarks for the frame shown at `mediaTime`.
 * Returns {result, index, exact, interpolated}. result is null when there is nothing to draw.
 * exact: the frame is in the data (within a third of a frame interval).
 * interpolated: the frame is missing from the data and both neighbours (at most 3 frame
 * intervals apart) have a pose, so the pose is blended between them.
 */
export function playbackFrame(data, mediaTime) {
  if (!data?.t?.length) return { result: null, index: -1, exact: false, interpolated: false };
  data._dt ??= frameInterval(data.t);
  const dt = data._dt;
  const i = nearestIndex(data.t, mediaTime);
  if (Math.abs(data.t[i] - mediaTime) <= dt / 3) {
    const result = unpack(data, i);
    const empty = !result.pose.landmarks.length && !result.hands.landmarks.length;
    return { result: empty ? null : result, index: i, exact: true, interpolated: false };
  }
  const a = data.t[i] <= mediaTime ? i : i - 1, b = a + 1;
  if (a < 0 || b >= data.t.length || data.t[b] - data.t[a] > 3.5 * dt || !data.pose[a] || !data.pose[b]) {
    return { result: null, index: i, exact: false, interpolated: false };
  }
  const f = (mediaTime - data.t[a]) / (data.t[b] - data.t[a]);
  const A = unpack(data, a), B = unpack(data, b);
  const pa = A.pose.landmarks[0], pb = B.pose.landmarks[0];
  const pose = pa.map((p, k) => lerpPt(p, pb[k], f));
  const hands = A.hands.landmarks.length === B.hands.landmarks.length
    ? A.hands.landmarks.map((h, j) => h.map((p, k) => lerpPt(p, B.hands.landmarks[j][k], f))) : [];
  return { result: { pose: { landmarks: [pose] }, hands: { landmarks: hands } }, index: a, exact: false, interpolated: true };
}

/** Inference input size: the frame scaled so its long side is at most `longSide` px (even numbers). */
export function inputSize(width, height, longSide = 640) {
  if (!width || !height) return { width: longSide, height: Math.round(longSide * 9 / 16) };
  const s = Math.min(1, longSide / Math.max(width, height));
  const even = (v) => Math.max(2, Math.round(v * s / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Canvas pixel size for drawing at display resolution with the video's aspect ratio. */
export function overlaySize(boxW, boxH, videoW, videoH, dpr = 1) {
  if (!videoW || !videoH || !boxW || !boxH) return { width: 0, height: 0 };
  const s = Math.min(boxW / videoW, boxH / videoH);
  return { width: Math.round(videoW * s * dpr), height: Math.round(videoH * s * dpr) };
}

/**
 * Rolling rate counter: add(timeMs) per event, rate(nowMs) returns events per second over
 * the last `windowMs`.
 */
export function rateMeter(windowMs = 1000) {
  const ts = [];
  return {
    add(t) { ts.push(t); while (ts.length && t - ts[0] > windowMs) ts.shift(); },
    rate(now) {
      while (ts.length && now - ts[0] > windowMs) ts.shift();
      if (ts.length < 2) return 0;
      return ((ts.length - 1) * 1000) / Math.max(1, ts[ts.length - 1] - ts[0]);
    },
  };
}
