# 60 fps capture in Record mode

Written 2026-09-26 after a report that Record mode, which used to hold a steady 60 fps on a
phone, had become "a lil wonky" since the member portal Analyze tab went live.

## What the regression was

**The analyzer's Record code did not change.** `static/record.js` and `static/skeleton.js` are
byte-for-byte the same at 14d1262 (the last pre-portal Record change) and 565aa0d (portal launch).
The later commits (793e253, 26e4256, b6de155, 59bd4bf) only touched charts, the label page,
training copy and cache headers. What did change is the page around the camera: since
2026-09-26 members open Record inside the portal shell, not the analyzer's own page.

1. **Blur layers over the live preview (most likely cause).** The portal shell has
   `backdrop-filter: blur(12px)` on the sticky top bar and `blur(14px)` on the fixed bottom dock.
   At phone width the 3:4 preview is about 64% of the screen high, so part of it is almost always
   under one of the two bars, and any scroll puts it there. A backdrop blur has to be recomputed
   for every new frame of the video behind it. That means 60 GPU blur passes a second on top of
   the camera, the video compositor and MediaPipe's WebGL work, and it can keep the video off the
   cheaper hardware overlay path. The analyzer's own page has no blur (its top bar is a plain
   sticky bar), which matches "it used to be steady".
2. **Pose tracking on the main thread during takes (contributing, older).** MediaPipe pose and
   hands ran at about 10 Hz while recording. They only paused when a detection averaged over
   12 ms, and they kept running even with the Skeleton box unchecked (for framing tips). A phone
   at 9 to 12 ms per detection kept stealing main-thread and GPU time for the whole take. On this
   GPU-less test box, forcing MediaPipe to keep running (about 380 ms per call) dropped a take
   to about 14.6 fps, so this path can ruin a recording.
3. **Constraints that allowed 1080p at 30 (weakness, older).** The old request was 1920x1080 with
   `frameRate {ideal: 60, min: 24}`. The spec's fitness distance weighs the ideal size and ideal
   rate alike, so a phone without 1080p60 in the browser could settle on 1080p30 instead of 720p60.

The box could not reproduce the phone symptom itself. A desktop Chrome with a fake camera kept
60 fps with or without the blur, even at 6x CPU throttle, because `presentedFrames` is counted by
the compositor and a desktop GPU does the blur easily. Cause 1 is the best explanation from the
diff, but it needs a real-phone confirmation (see the end).

## What changed (analyzer and portal, 2026-09-26)

- **No blur over the camera.** On the Analyze page the portal's top bar and dock are solid
  (`backdrop-filter: none`), and the stage uses `contain: paint`. Nothing with a filter, shadow or
  transform sits over the video. The only transform is `scaleX(-1)` for mirroring, which is now
  applied only to a camera facing the member.
- **Raw track, never a canvas.** MediaRecorder still records `getUserMedia`'s camera and mic
  track. The skeleton canvas is on-screen only.
- **Skeleton on every camera frame, off the main thread.** See the next section. (The first
  60 fps round throttled it to every 2nd frame and about 10 Hz while recording; that is gone.)
- **60 fps constraint ladder.** 1280x720 then 1920x1080 with `frameRate {ideal: 60, min: 50}`,
  then 720p with `ideal: 60` and no minimum, then anything. Then `getCapabilities().frameRate.max`
  is checked, and `applyConstraints({frameRate: 60})` runs when the camera can do 60 but is set
  lower. The back camera is the default on phones.
- **Encoder settings.** H.264 MP4 first (`avc1.64002A`, level 4.2, which covers 1080p60; the old
  first choice `avc1.640028` is level 4.0, which tops out at 1080p30), then VP8 and VP9 WebM. The
  bitrate is sized to the capture: width x height x fps x 0.15, clamped to 4 to 12 Mbps (8.3 Mbps
  at 720p60). The timeslice stays at 1 s.
- **Live fps badge plus the saved file's fps.** The badge shows the measured delivered rate
  (green "60 fps", accent "30 fps, results will be estimates"). A tip appears after about 2 s
  under 50 fps. The take panel shows the measured fps, container and bitrate. The results show
  "Saved video: N fps, measured by the server from the file".

## Skeleton on every frame (live preview, 2026-09-26 4:24 PM MT)

- **Per frame, no throttle.** `static/record.js` offers every presented camera frame
  (`requestVideoFrameCallback`) to `static/pose-engine.js`. At most one frame is in flight; while
  it runs, only the newest frame is kept and older ones are dropped, so the skeleton never lags
  behind the video and never queues.
- **Web Workers.** `static/pose-worker.js` runs MediaPipe Tasks Vision in a module worker:
  PoseLandmarker (lite) and HandLandmarker (2 hands), VIDEO mode, timestamps
  `max(last + 1, round(mediaTime ms))` so they always increase. Pose and hands run in **two
  workers in parallel**, so a frame costs max(pose, hands), not the sum. If two workers fail to
  start it tries one worker with both models, then the main thread.
- **GPU first, CPU fallback.** Each worker asks for the GPU delegate (WebGL2 on an
  `OffscreenCanvas`). A software renderer (SwiftShader, llvmpipe) counts as no GPU and uses the CPU
  delegate, because it was 8x slower than CPU on the test box. `?delegate=GPU|CPU` overrides.
- **Input 640 px** on the long side (`createImageBitmap` resize, transferred to the worker, not
  copied). `?input=480` overrides; 480 was not faster on the box because the hand model crops
  its own region anyway.
- **Overlay at display resolution.** The canvas is sized to the drawn video box times
  devicePixelRatio (max 3), and each result is drawn the moment it arrives, with no smoothing.
  When a frame has no pose, the canvas is cleared.
- **Recording is untouched.** MediaRecorder records the raw camera track. The skeleton keeps
  running during a take unless the Skeleton box is off or a 60 fps camera's measured rate drops
  under 55 (`skeletonPlan` in `static/camera.js`), which shows "Skeleton paused for this take:
  the camera dropped to N fps."
- **Honest rate.** When the skeleton runs under 90% of the camera rate for 2 s, the page says
  "Skeleton running at N fps on this device".
- **Debug stats.** Tick **Stats** or open the page with `?debug=1`: "camera X fps | skeleton Y fps
  | inference Z ms (pose a, hands b) | round trip R ms | mode".
- **Safari.** Module workers need Safari 15+, WebGL2 in an OffscreenCanvas inside a worker needs
  Safari/iOS 17+, `requestVideoFrameCallback` needs Safari 15.4+. If the worker cannot start or
  load the models, the engine falls back to the main thread (the previous code path, still per
  frame with one in flight). Without `requestVideoFrameCallback` the preview uses
  `requestAnimationFrame`.

### Expected phone performance (estimate, not measured on a phone)

Google's published numbers: HandLandmarker (full) 17.12 ms CPU and 12.27 ms GPU on a Pixel 6
(whole pipeline, [hand landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker),
updated 2026-08-17). The pose landmarker page's benchmark table could not be retrieved; the
BlazePose model card gives Lite about 20 ms on a Pixel 3 GPU (about 49 fps) and about 44 fps
on CPU ([legacy pose docs](https://github.com/google/mediapipe/blob/master/docs/solutions/pose.md)).
With pose and hands in parallel a Pixel 6 class phone needs roughly max(pose, hands) plus 2 to
4 ms of bitmap transfer, about 15 to 20 ms, so **about 50 to 60 fps on recent flagships and
about 30 to 50 fps on mid-range phones** are likely. The WebGL delegate in a browser is usually
slower than the native TFLite numbers. The on-page stats show the real value.

## Results playback skeleton: the freeze and the fix

**What the member saw (Android, portal Analyze tab, results playback):** the skeleton lined up
while still, lost tracking when fast drumming started, then stayed frozen pixel-identical in a
"hands down" pose for about 3 seconds while the video kept playing.

**Cause.** The old playback overlay did not use the server's analysis at all. It ran the browser
MediaPipe models on the playing `<video>` with `performance.now()` timestamps and drew inside
`try { ... } catch {}`. When a detection threw or returned nothing (a busy phone, motion blur,
GPU context trouble), the canvas was not cleared, so the last drawing stayed on screen: a stale
pose that looks frozen. The server data was fine. Re-running the new per-frame pipeline on the
member's two phone takes (720x1280, 59.0 and 58.8 fps, variable frame rate, `r_frame_rate` 60000/1)
found a pose on 100% of frames (398 of 398 and 457 of 457), both hands on 100% and 97%, no two
consecutive frames identical, and the pose wrists within about 1% of the frame from the hand
model's wrists, even at the old 0.5 thresholds. Their frame spacing is uneven (median interval
19.3 ms against a 16.9 ms average), which is why playback looks frames up by their own
timestamps instead of assuming a fixed 60 fps.

**Fix.**

- **Server, every frame, keyed by pts.** `app/video.py` runs pose (full model by default,
  `POSE_MODEL=lite|full|heavy`) and hands on every decoded frame in VIDEO mode with detection,
  presence and tracking confidence 0.3 (MediaPipe default 0.5), so fast blurred strokes keep a
  pose and tracking re-detects on its own. `app/media.py frame_times()` reads each frame's
  presentation time with `ffmpeg -copyts` (framecrc), and every frame gets `pts` on the file's
  own timeline (start offset and edit list kept). The analysis still uses its own zero-based `t`,
  so scores are unchanged.
- **Stored with the job:** `landmarks.json.gz` (cache version 2, includes the pose model).
  `GET /api/jobs/{id}/landmarks` returns `t[]` (pts in seconds), `pose[]` (null or 9 points:
  nose, shoulders, elbows, wrists, hips, normalised x, y, visibility), `hands[]` and `stats`
  (frames, pose_rate, any_hand_rate, two_hands_rate, median frame interval). Older analyses return
  404 "No per-frame skeleton data for this analysis. Analyze the video again to draw it on
  playback." `python -m scripts.backfill_landmarks [job_id ...]` adds the data to older analyses
  (it was run on every job on the studio PC on 2026-09-26).
- **Playback by exact frame.** `static/app.js` loads the data once and draws on every
  `requestVideoFrameCallback` using `meta.mediaTime` (`playbackFrame` in `static/overlay.js`,
  unit tested). An exact match is within a third of a frame interval. A frame with no detection
  clears the canvas; it never shows an older pose. Interpolation only fills a frame that is
  missing from the data when both neighbours have a pose within 3.5 frame intervals. Paused or
  seeking draws the frame on screen immediately. Without `requestVideoFrameCallback` it follows
  `currentTime` every animation frame. `?debug=1` shows "frame N of M at T s, exact | pose found
  on X% of frames, both hands Y% | drawn, empty, interpolated".
- **Why mediaTime.** On the box, Chrome's `mediaTime` equalled the `ffmpeg -copyts` pts exactly
  on a variable frame rate MP4 with B-frames and a 0.25 s start offset, including the jitter.
  `currentTime` was up to about 9 ms off, and ffmpeg without `-copyts` zero-bases timestamps
  (0.25 s off for such files). `timeupdate` fires only about 4 times a second and was never used.

### Playback verification (live portal, 2026-09-26)

| Clip | Frames | Pose found | Both hands | Browser playback (rVFC, 0.5x) |
|---|---|---|---|---|
| Fast VFR synthetic: 60 fps drummer, 3-frame motion blur, +6 ms jitter on 3 of 7 frames, 0.25 s start offset, B-frames | 720 | 100% | 45% | 661 frames presented, all exact pts matches, all drawn, 661 distinct skeletons, 0 repeats |
| Same with a 1.5 s stretch with nobody in frame | 450 | 80.4% | 36% | 88 no-person frames: 87 blank (1 boundary blend frame drawn); 361 of 362 person frames drawn |
| Member's phone takes (6.7 s at 59.0 fps and 7.8 s at 58.8 fps, re-run on the PC) | 398 and 457 | 100% | 100% and 97% | not replayed in a browser here |
| Pytest `test_fast_vfr_clip_every_frame_keyed_by_pts` (160 bpm, 6 s) | 360 | 100% | 23% | n/a |

The server `t` matched ffprobe's frame pts within 0.004 ms on the live job (720 of 720).

## Verification (2026-09-26, live portal and direct access)

Chrome with a fake 60 fps camera at 390x844 (phone emulation), recorded in Record mode,
uploaded, and measured by the server from the saved file:

| Take | Live badge | Server-measured fps |
|---|---|---|
| Before the fix (live portal, 6x CPU throttle, skeleton on, auto-paused) | 60.0 | 59.5 (1080p) |
| After, skeleton on (default: auto-paused on this GPU-less box) | 60 fps | 59.8 (720p) |
| After, skeleton off | 60 fps | 60.0 |
| After, skeleton running all take (5 ms stand-in detector, about 10 Hz, 122 calls) | 60 fps | 60.0 |
| After, direct access (`analyzer-origin...?key=`) | 60 fps | 60.0 |
| Every-frame worker skeleton ON all take (2 CPU workers, drummer as the fake camera, 17 fps skeleton on the GPU-less box) | 60 fps | 60.0 |
| Every-frame worker skeleton OFF | 60 fps | 60.0 |
| Every-frame worker skeleton ON, 4x CPU throttle (13 fps skeleton) | 60 fps | 60.0 |
| Stress, first round only: main-thread MediaPipe forced on during the take (about 380 ms per call) | 16 fps | take measured 14.6 in the browser |

The stress row is why inference moved to Web Workers: with the workers the camera and the saved
file stay at 60 fps even while the skeleton runs at 13 to 17 fps on a slow CPU.

Live skeleton on the box (no GPU, 2 CPU workers, 640 px input, a drummer as the fake camera):
pose about 24 ms, hands about 54 ms, round trip about 58 ms, skeleton 17 to 18 fps, camera 60 fps.
With nobody in frame it ran about 27 fps (hands model idle). One worker with both models ran
18 to 19 fps with nobody in frame; SwiftShader "GPU" ran 2.6 fps, hence the software-renderer check.

## iOS and Android limits

- **iOS Safari.** WebKit sets the frame rate on the capture device on iOS (not per track), so
  60 fps needs a device format that offers 60 at the chosen size ([WebKit e27ac61, bug 261461](https://github.com/WebKit/WebKit/commit/e27ac61ee27369519f6679d3ac2889915b1e563d),
  [bug 210186](https://bugs.webkit.org/show_bug.cgi?id=210186)). Many iPhones deliver 30 fps in
  Safari even when the Camera app does 60. Low light lowers the rate further ([bug 196214](https://bugs.webkit.org/show_bug.cgi?id=196214)).
  Safari records H.264/AAC MP4 with MediaRecorder. When capture comes back under 50 the page tells
  the member to record 60 fps in the Camera app and use Upload.
- **Android Chrome.** Chrome captures through Camera2 with `TEMPLATE_PREVIEW` and an AE target
  fps range ([VideoCaptureCamera2.java](https://chromium.googlesource.com/chromium/src/media/+/45d07016eaf9fef1af9b76e1dea96642d373591e/capture/video/android/java/src/org/chromium/media/VideoCaptureCamera2.java)).
  Whether 60 is offered depends on the phone. Some report 60 in `getSettings()` but deliver 30
  ([Stack Overflow 63210220](https://stackoverflow.com/questions/63210220/video-capture-in-mobile-browser-at-60-fps)),
  which is why the badge uses the measured rate. Older Chrome only had software VP8/VP9 encoding
  on Android, which could not keep 60 fps. Chrome now uses the hardware H.264 encoder in
  MediaRecorder ([f3d2acb](https://github.com/chromium/chromium/commit/f3d2acb718a824efaf13c063cefb384c8efcced8))
  and writes MP4 ([8b14d30](https://github.com/chromium/chromium/commit/8b14d30eb8647a87b2fdc567d5b97f3ad1021b00)).
  Some Android phones have produced truncated `avc1` MP4 files ([Stack Overflow 79089296](https://stackoverflow.com/questions/79089296/mediarecorder-on-chrome-produces-a-truncated-mp4-with-the-avc1-mediatype)).
  The server re-measures every file, so a bad file shows up as a clear error, not a wrong score.

## Research notes (sources)

- Constraints are requests, not guarantees. Read back `getSettings()` and measure.
  [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
  [MDN applyConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints),
  [MDN getCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities),
  [W3C Media Capture and Streams (fitness distance)](https://www.w3.org/TR/mediacapture-streams/).
  `min` makes a constraint required (OverconstrainedError when it cannot be met), hence the ladder.
- MediaRecorder: `videoBitsPerSecond` is a target, and `start(timeslice)` sets how often
  `dataavailable` fires. Very short timeslices add overhead. [MDN MediaRecorder()](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/MediaRecorder),
  [MDN start()](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/start),
  [W3C MediaStream Recording](https://www.w3.org/TR/mediastream-recording/).
- `requestVideoFrameCallback` fires once per presented frame. `presentedFrames` counts frames
  sent to the compositor, including ones whose callback was skipped, so it measures delivered fps
  without being dragged down by a busy main thread. [WICG spec](https://wicg.github.io/video-rvfc/),
  [web.dev](https://web.dev/articles/requestvideoframecallback-rvfc).
- MediaPipe Tasks Vision `detectForVideo` is synchronous on the calling thread. Google's samples
  move it to a Worker for heavy use. [Pose landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js),
  [worker sample](https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/pose-landmarker.worker.ts).
- `backdrop-filter` re-renders whenever the content behind it changes, which for a playing video
  is every frame. [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter),
  [field report on blur over streaming video](https://medium.com/@JTCreateim/backdrop-filter-property-in-css-leads-to-choppiness-in-streaming-video-45fa83f3521b).

## Needs a real-phone check

- The worker skeleton on iPhone Safari (iOS 17+ GPU path, older iOS main-thread path) and on an
  Android phone with a real GPU: the Stats line (skeleton fps, inference ms, mode) and a take with
  the skeleton on, checked for 60.0 fps on the results.
- Results playback on the member's Android phone with "Draw skeleton on playback" ticked during
  fast strokes (the `?debug=1` line should say "exact" on every frame).
- `POSE_MODEL=heavy` on the studio PC for very fast strokes (about 3x slower analysis; not tried).

- iPhone Safari and an Android Chrome phone: badge value, a 30 to 60 s take with the skeleton on
  and off, and the server-measured fps on the results.
- Whether the blur removal alone fixes the "wonky" preview on the member's phone.
- Friendly names on real devices (iOS "Back Ultra Wide Camera" style, Android "camera2 N, facing
  back"), the default back camera, and Switch.
- Whether `applyConstraints` raises a 30 fps start to 60 on Android.
