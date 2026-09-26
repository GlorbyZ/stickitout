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
- **Pose tracking throttled and auto-paused** (`detectPlan` in `static/camera.js`, unit tested).
  It is scheduled by presented camera frames (`requestVideoFrameCallback`): every 2nd frame in
  preview at 60 fps, about 10 Hz while recording, about 10 Hz for framing tips with the skeleton
  off. During a take it pauses until the take ends when the Skeleton box is off, when a detection
  costs more than 8 ms, or when a 60 fps camera's measured rate drops under 55.
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

A Web Worker for MediaPipe (OffscreenCanvas plus transferred ImageBitmaps, as in Google's
samples) would take pose tracking off the main thread entirely. It was not done here because
throttling and auto-pause already keep takes at 60 fps and the change is much larger. It is the
next step if phones still drop preview frames with the skeleton on.

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
| Stress: real MediaPipe forced on during the take (auto-pause disabled, about 380 ms per call) | 16 fps | take measured 14.6 in the browser |

The last row shows why the auto-pause matters. It is a test-only override, not how the page runs.

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

- iPhone Safari and an Android Chrome phone: badge value, a 30 to 60 s take with the skeleton on
  and off, and the server-measured fps on the results.
- Whether the blur removal alone fixes the "wonky" preview on the member's phone.
- Friendly names on real devices (iOS "Back Ultra Wide Camera" style, Android "camera2 N, facing
  back"), the default back camera, and Switch.
- Whether `applyConstraints` raises a 30 fps start to 60 on Android.
