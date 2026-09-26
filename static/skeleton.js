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

/** Draw pose + hands on a canvas the same pixel size as the video frame. */
export function drawSkeleton(ctx, result, w, h) {
  ctx.clearRect(0, 0, w, h);
  const lw = Math.max(2, w / 320);
  const pose = result?.pose?.landmarks?.[0];
  const line = (a, b, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
  };
  const dot = (p, r, color) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2); ctx.fill();
  };
  ctx.lineCap = "round";
  if (pose) {
    for (const [a, b] of BODY_LINKS) if (visible(pose[a]) && visible(pose[b])) line(pose[a], pose[b], "rgba(255,255,255,0.45)", lw);
    for (const [a, b] of ARM_LINKS) if (visible(pose[a]) && visible(pose[b])) line(pose[a], pose[b], GOLD, lw * 2.2);
    for (const i of ARM_JOINTS) {
      if (!visible(pose[i])) continue;
      dot(pose[i], lw * (i >= 15 ? 4.5 : 3.2), "#111");
      dot(pose[i], lw * (i >= 15 ? 3.4 : 2.4), i >= 15 ? "#ffffff" : GOLD);
    }
  }
  for (const hand of result?.hands?.landmarks ?? []) {
    for (const [a, b] of HAND_LINKS) line(hand[a], hand[b], "#4fd1ff", lw * 1.2);
    for (const p of hand) dot(p, lw * 1.3, "#ffffff");
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
