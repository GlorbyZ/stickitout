// Pose Worker: MediaPipe PoseLandmarker (lite) + HandLandmarker (2 hands) in VIDEO mode, off the
// main thread, on the GPU (WebGL2 on an OffscreenCanvas) with a CPU fallback.
// Protocol: {type:"init", tasks:["pose","hands"], delegate?} -> {type:"ready", delegate} | {type:"error", message}
// pose-engine.js normally starts two of these, one for pose and one for hands, so the two
// models run in parallel.
//           {type:"frame", id, ts, mediaTime, bitmap} (bitmap transferred) -> {type:"result", ...}
import { CDN, POSE_MODEL, HAND_MODEL } from "./skeleton.js?v=20";

// Module workers have no working importScripts(), which the MediaPipe loader uses inside
// workers to load its wasm glue script. Load it with a synchronous request and evaluate it in
// global scope so its `var ModuleFactory` becomes a global, as importScripts would.
self.importScripts = (...urls) => {
  for (const url of urls) {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", String(url), false);
    xhr.send();
    if (xhr.status !== 200) throw new Error(`Could not load ${url} (HTTP ${xhr.status})`);
    (0, eval)(`${xhr.responseText}\n//# sourceURL=${url}`);
  }
};

let pose = null, hands = null, delegate = "", last = 0;

// A software WebGL (SwiftShader, llvmpipe) is much slower than MediaPipe's CPU path, so treat it as no GPU.
function hardwareWebGL2() {
  if (typeof OffscreenCanvas === "undefined") return false;
  const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
  if (!gl) return false;
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
  return !/swiftshader|llvmpipe|softpipe|software/i.test(renderer);
}

async function init(prefer, tasks = ["pose", "hands"]) {
  const { FilesetResolver, PoseLandmarker, HandLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const make = (d) => {
    const gpu = d === "GPU";
    const canvas = () => (gpu ? { canvas: new OffscreenCanvas(1, 1) } : {});
    return Promise.all([
      tasks.includes("pose") ? PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: d }, runningMode: "VIDEO", numPoses: 1, ...canvas(),
      }) : null,
      tasks.includes("hands") ? HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: d }, runningMode: "VIDEO", numHands: 2, ...canvas(),
      }) : null,
    ]);
  };
  const gpuOk = prefer === "GPU" ? typeof OffscreenCanvas !== "undefined" : prefer === "CPU" ? false : hardwareWebGL2();
  if (gpuOk) {
    try { [pose, hands] = await make("GPU"); delegate = "GPU"; } catch { pose = hands = null; }
  }
  if (!delegate) { [pose, hands] = await make("CPU"); delegate = "CPU"; }
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "init") {
    try { await init(m.delegate, m.tasks); self.postMessage({ type: "ready", delegate }); }
    catch (err) { self.postMessage({ type: "error", message: String(err?.message || err) }); }
    return;
  }
  if (m.type === "frame") {
    const t0 = performance.now();
    const out = { type: "result", id: m.id, mediaTime: m.mediaTime, ms: 0 };
    try {
      // VIDEO mode needs strictly increasing timestamps: the frame's own time in ms.
      const ts = Math.max(last + 1, Math.round(m.ts));
      last = ts;
      if (pose) out.pose = pose.detectForVideo(m.bitmap, ts).landmarks?.[0] ?? null;
      if (hands) out.hands = hands.detectForVideo(m.bitmap, ts).landmarks ?? [];
    } catch (err) {
      out.error = String(err?.message || err);
    } finally {
      m.bitmap?.close?.();
    }
    out.ms = performance.now() - t0;
    self.postMessage(out);
  }
};
