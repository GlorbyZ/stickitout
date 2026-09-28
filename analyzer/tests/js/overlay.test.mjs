// Unit tests for static/overlay.js. Run: node --test tests/js
import test from "node:test";
import assert from "node:assert/strict";
import { nearestIndex, frameInterval, playbackFrame, inputSize, overlaySize, rateMeter } from "../../static/overlay.js";

// A variable frame rate clip with a 0.25 s start offset, like the server sends it.
function clip(n = 12) {
  const t = [], pose = [], hands = [];
  for (let i = 0; i < n; i++) {
    t.push(+(0.25 + i / 60 + (i % 7 > 3 ? 0.006 : 0)).toFixed(5));
    const x = i / 100;
    pose.push(i === 5 ? null : Array.from({ length: 9 }, () => [x, 0.5, 0.9]).flat());
    hands.push(i % 2 ? [] : [Array(42).fill(x)]);
  }
  return { t, pose, hands, points: [0, 11, 12, 13, 14, 15, 16, 23, 24] };
}

test("nearest frame by binary search", () => {
  const t = [0.25, 0.2667, 0.2833, 0.3227];
  assert.equal(nearestIndex(t, 0.2), 0);
  assert.equal(nearestIndex(t, 0.28), 2);
  assert.equal(nearestIndex(t, 0.32), 3);
  assert.equal(nearestIndex([], 1), -1);
  assert.ok(Math.abs(frameInterval(clip().t) - 1 / 60) < 0.001);
});

test("playback draws exactly the frame on screen, by mediaTime", () => {
  const d = clip();
  const f = playbackFrame(d, d.t[4]);                  // a shifted VFR frame
  assert.equal(f.index, 4); assert.ok(f.exact); assert.ok(!f.interpolated);
  assert.equal(f.result.pose.landmarks[0][15].x, 0.04);
  assert.equal(f.result.pose.landmarks[0][23].visibility, 0.9);
  assert.equal(f.result.hands.landmarks[0].length, 21);
});

test("a frame without a detection draws nothing, never the previous pose", () => {
  const d = clip();
  const f = playbackFrame(d, d.t[5]);
  assert.ok(f.exact);
  assert.equal(f.result, null);
});

test("interpolates only when the frame on screen is missing from the data", () => {
  const d = clip();
  // Remove frame 2: its time now falls between frames 1 and 3.
  const miss = { ...d, t: d.t.filter((_, i) => i !== 2), pose: d.pose.filter((_, i) => i !== 2), hands: d.hands.filter((_, i) => i !== 2) };
  const f = playbackFrame(miss, d.t[2]);
  assert.ok(!f.exact && f.interpolated);
  assert.ok(Math.abs(f.result.pose.landmarks[0][15].x - 0.02) < 1e-4);
  // Neighbour without a pose: no interpolation, nothing drawn.
  const miss2 = { ...d, t: d.t.filter((_, i) => i !== 6), pose: d.pose.filter((_, i) => i !== 6), hands: d.hands.filter((_, i) => i !== 6) };
  assert.equal(playbackFrame(miss2, d.t[6]).result, null);
  // Far outside the clip: nothing.
  assert.equal(playbackFrame(d, 9).result, null);
});

test("inference input and overlay sizes", () => {
  assert.deepEqual(inputSize(1280, 720), { width: 640, height: 360 });
  assert.deepEqual(inputSize(720, 1280), { width: 360, height: 640 });
  assert.deepEqual(inputSize(480, 360), { width: 480, height: 360 });
  assert.deepEqual(overlaySize(390, 520, 1280, 720, 2), { width: 780, height: 439 });
});

test("rate meter", () => {
  const m = rateMeter(1000);
  for (let i = 0; i <= 60; i++) m.add(i * 16.667);
  assert.ok(Math.abs(m.rate(1000) - 60) < 1);
});
