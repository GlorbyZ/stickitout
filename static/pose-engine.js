// Live pose engine for Record mode. Prefers the pose Worker (pose-worker.js: MediaPipe on its own
// thread, GPU delegate on an OffscreenCanvas). Falls back to MediaPipe on the main thread (GPU
// delegate where available) when module workers, OffscreenCanvas WebGL or createImageBitmap
// are missing, e.g. older iOS Safari, or when the worker fails to start.
//
// Every camera frame is offered (requestVideoFrameCallback). At most one frame is in flight;
// if the worker is still busy, only the newest frame is kept and sent as soon as it is free.
import { loadLandmarkers } from "./skeleton.js";
import { inputSize } from "./overlay.js";

// Inference input, long side in px (?input=480 to try another size).
export const INPUT_LONG_SIDE = Math.min(1280, Math.max(256, +new URLSearchParams(location.search).get("input") || 640));

function workerSupported() {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function";
}

/**
 * createPoseEngine({onResult}) -> engine
 *   engine.ready   Promise<string> resolving to the mode: "worker GPU", "worker CPU", "main GPU" or "main CPU"
 *   engine.offer(video, meta)  offer the frame on screen (call from requestVideoFrameCallback)
 *   engine.stats() {inFlight, dropped, sent}
 * onResult({pose, hands, mediaTime, ms, latency, mode}) is called per processed frame.
 */
export function createPoseEngine({ onResult }) {
  let mode = "", workers = [], main = null, busy = false, pending = null, id = 0, sent = 0, dropped = 0;
  const inflight = new Map();   // frame id -> {t0, need, pose, hands, ms}
  const prefer = (() => {
    const d = new URLSearchParams(location.search).get("delegate")?.toUpperCase();
    return d === "GPU" || d === "CPU" ? d : undefined;   // ?delegate= forces one (testing)
  })();

  const tsOf = (meta) => (meta?.mediaTime ? meta.mediaTime * 1000 : meta?.presentationTime ?? performance.now());

  function spawn(tasks) {
    const w = new Worker(new URL("./pose-worker.js", import.meta.url), { type: "module" });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pose worker timed out")), 60000);
      w.onmessage = (e) => {
        if (e.data.type === "ready") { clearTimeout(timer); w.onmessage = onWorkerResult; resolve(e.data.delegate); }
        else if (e.data.type === "error") { clearTimeout(timer); reject(new Error(e.data.message)); }
      };
      w.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || "pose worker failed")); };
      w.postMessage({ type: "init", tasks, delegate: prefer });
    });
    return { w, ready };
  }

  function onWorkerResult(e) {
    const r = e.data;
    if (r.type !== "result") return;
    const f = inflight.get(r.id);
    if (!f) return;
    if ("pose" in r) { f.pose = r.pose; f.poseMs = r.ms; }
    if ("hands" in r) { f.hands = r.hands; f.handsMs = r.ms; }
    f.ms = Math.max(f.ms, r.ms);                 // the workers run in parallel
    if (r.error) f.error = r.error;
    if (--f.need > 0) return;
    inflight.delete(r.id);
    busy = false;
    onResult({ pose: f.pose ?? null, hands: f.hands ?? [], mediaTime: r.mediaTime, ms: f.ms, poseMs: f.poseMs, handsMs: f.handsMs,
      latency: performance.now() - f.t0, mode, error: f.error });
    if (pending) { const p = pending; pending = null; submit(p.video, p.meta); }
  }

  const ready = (async () => {
    if (workerSupported()) {
      // Two workers (pose, hands) in parallel; one combined worker if that fails.
      for (const layout of [[["pose"], ["hands"]], [["pose", "hands"]]]) {
        const spawned = layout.map(spawn);
        try {
          const delegates = await Promise.all(spawned.map((x) => x.ready));
          workers = spawned.map((x) => x.w);
          mode = `${workers.length} workers ${[...new Set(delegates)].join("+")}`;
          return mode;
        } catch (err) {
          spawned.forEach((x) => x.w.terminate());
          console.warn("Pose worker layout failed:", err);
        }
      }
    }
    main = await loadLandmarkers();
    mode = `main thread ${main.delegate}`;
    return mode;
  })();

  function submit(video, meta) {
    busy = true; sent++;
    const frameId = ++id, ts = tsOf(meta), mediaTime = meta?.mediaTime ?? video.currentTime;
    if (workers.length) {
      const size = inputSize(video.videoWidth, video.videoHeight, INPUT_LONG_SIDE);
      inflight.set(frameId, { t0: performance.now(), need: workers.length, ms: 0 });
      createImageBitmap(video, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "low" })
        .then(async (bitmap) => {
          const bitmaps = [bitmap];
          for (let i = 1; i < workers.length; i++) bitmaps.push(await createImageBitmap(bitmap));
          workers.forEach((w, i) => w.postMessage({ type: "frame", id: frameId, ts, mediaTime, bitmap: bitmaps[i] }, [bitmaps[i]]));
        })
        .catch(() => { busy = false; inflight.delete(frameId); });
      return;
    }
    // Main-thread fallback: synchronous, on every frame the thread can keep up with.
    const t0 = performance.now();
    let pose = null, hands = [], error;
    try {
      const r = main.detect(video, ts);
      pose = r.pose?.landmarks?.[0] ?? null; hands = r.hands?.landmarks ?? [];
    } catch (err) { error = String(err?.message || err); }
    const ms = performance.now() - t0;
    busy = false;
    onResult({ pose, hands, mediaTime, ms, latency: ms, mode, error });
  }

  return {
    ready,
    get mode() { return mode; },
    /** Offer the frame on screen. Keeps at most one frame in flight plus the newest waiting one. */
    offer(video, meta) {
      if (!mode || video.readyState < 2) return;
      if (busy) { if (pending) dropped++; pending = { video, meta }; return; }
      submit(video, meta);
    },
    stats: () => ({ inFlight: busy, dropped, sent }),
    stop() { workers.forEach((w) => w.terminate()); workers = []; pending = null; },
  };
}
