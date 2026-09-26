// Unit tests for static/camera.js. Run: node --test tests/js
import test from "node:test";
import assert from "node:assert/strict";
import {
  constraintLadder, boostConstraints, fpsBadge, lowFpsTip, isPhone, describeCamera, friendlyCameras,
  bestCamera, pickMimeType, videoBitrate, liveFps, retryable,
} from "../../static/camera.js";

test("ladder asks 720p60 with min 50 first, then 1080p60, then no min", () => {
  const l = constraintLadder();
  assert.deepEqual(l[0].frameRate, { ideal: 60, min: 50 });
  assert.equal(l[0].width.ideal, 1280);
  assert.deepEqual(l[1].frameRate, { ideal: 60, min: 50 });
  assert.equal(l[1].width.ideal, 1920);
  assert.deepEqual(l[2].frameRate, { ideal: 60 });
  assert.equal(l.at(-1), true);
  assert.deepEqual(l[0].facingMode, { ideal: "environment" });
});

test("ladder with a device pins it and never falls back to another camera", () => {
  const l = constraintLadder({ deviceId: "abc" });
  for (const c of l) assert.deepEqual(c.deviceId, { exact: "abc" });
  assert.equal(l[0].facingMode, undefined);
});

test("retryable covers constraint errors, not permission", () => {
  assert.ok(retryable({ name: "OverconstrainedError" }));
  assert.ok(!retryable({ name: "NotAllowedError" }));
});

test("boost only when the camera can do 60 and is not already there", () => {
  assert.deepEqual(boostConstraints({ frameRate: { max: 60 } }, { frameRate: 30, width: 1280, height: 720 }),
    { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: 60 });
  assert.equal(boostConstraints({ frameRate: { max: 30 } }, { frameRate: 30 }), null);
  assert.equal(boostConstraints({ frameRate: { max: 120 } }, { frameRate: 60 }), null);
  assert.equal(boostConstraints(undefined, { frameRate: 30 }), null);
});

test("badge: 60 fps green, 30 fps accent with estimate note, very low is bad", () => {
  assert.deepEqual(fpsBadge(59.7), { text: "60 fps", level: "good" });
  assert.deepEqual(fpsBadge(30), { text: "30 fps, results will be estimates", level: "warn" });
  assert.equal(fpsBadge(15).level, "bad");
  assert.equal(fpsBadge(0).level, "idle");
  assert.equal(liveFps(0, 30), 30);
  assert.equal(liveFps(58.2, 60), 58.2);
});

test("low fps tip uses the phone wording on phones", () => {
  assert.equal(lowFpsTip(30, true), "Your phone's browser is limited to 30 fps. For 60 fps, record in your Camera app at 60 fps and use Upload.");
  assert.match(lowFpsTip(30, false), /about 30 fps/);
  assert.ok(isPhone("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"));
  assert.ok(isPhone("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5));
  assert.ok(!isPhone("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0));
});

test("friendly names from real-world labels", () => {
  const cases = [
    ["camera2 0, facing back", "Back camera"],
    ["camera2 1, facing front", "Front camera"],
    ["Back Camera", "Back camera"],
    ["Back Ultra Wide Camera", "Back camera (ultra wide)"],
    ["Back Telephoto Camera", "Back camera (telephoto)"],
    ["Back Dual Wide Camera", "Back camera (dual wide)"],
    ["Front Camera", "Front camera"],
    ["Integrated Camera (04f2:b6dd)", "Laptop webcam"],
    ["FaceTime HD Camera", "Laptop webcam"],
    ["HD Webcam", "Laptop webcam"],
    ["Logitech BRIO (046d:085e)", "USB camera"],
    ["USB2.0 PC CAMERA (1908:2310)", "USB camera"],
    ["OBS Virtual Camera", "Virtual camera"],
    ["Zaylyn's iPhone Camera", "Phone camera"],
  ];
  for (const [label, name] of cases) assert.equal(describeCamera(label).name, name, label);
  assert.equal(describeCamera("Some Camera", "environment").name, "Back camera");
});

test("duplicates are numbered, raw label kept as title, best is the main back camera", () => {
  const devs = [
    { kind: "videoinput", deviceId: "f", label: "camera2 1, facing front" },
    { kind: "videoinput", deviceId: "b2", label: "camera2 2, facing back" },
    { kind: "videoinput", deviceId: "b0", label: "camera2 0, facing back" },
    { kind: "audioinput", deviceId: "m", label: "mic" },
  ];
  const cams = friendlyCameras(devs);
  assert.deepEqual(cams.map((c) => c.name), ["Front camera", "Back camera", "Back camera 2"]);
  assert.equal(cams[1].title, "camera2 2, facing back");
  assert.equal(bestCamera(cams).deviceId, "b0");
  const ios = friendlyCameras([
    { kind: "videoinput", deviceId: "front", label: "Front Camera" },
    { kind: "videoinput", deviceId: "uw", label: "Back Ultra Wide Camera" },
    { kind: "videoinput", deviceId: "main", label: "Back Camera" },
  ]);
  assert.equal(bestCamera(ios).deviceId, "main");
  const laptop = friendlyCameras([
    { kind: "videoinput", deviceId: "int", label: "Integrated Camera (04f2:b6dd)" },
    { kind: "videoinput", deviceId: "usb", label: "Logitech BRIO (046d:085e)" },
  ]);
  assert.equal(bestCamera(laptop).deviceId, "usb");
  assert.equal(friendlyCameras([{ kind: "videoinput", deviceId: "x", label: "" }])[0].title, "Camera 1");
});

test("recorder prefers H.264 MP4 and a bitrate that holds 60 fps", () => {
  assert.equal(pickMimeType((m) => m.startsWith("video/webm")), "video/webm;codecs=vp8,opus");
  assert.equal(pickMimeType((m) => m.includes("avc1.64002A")), "video/mp4;codecs=avc1.64002A,mp4a.40.2");
  assert.equal(pickMimeType(() => false), "");
  assert.ok(videoBitrate(1280, 720, 60) >= 8_000_000);
  assert.equal(videoBitrate(1920, 1080, 60), 12_000_000);
  assert.equal(videoBitrate(640, 480, 30), 4_000_000);
});

test("no em dashes in user-facing copy", () => {
  for (const s of [lowFpsTip(30, true), lowFpsTip(30, false), fpsBadge(30).text, fpsBadge(15).text]) assert.ok(!s.includes("\u2014"));
});

import { detectPlan } from "../../static/camera.js";

test("pose tracking: every 2nd frame in preview at 60 fps, 10 Hz while recording", () => {
  assert.deepEqual(detectPlan({ cameraFps: 60 }), { every: 2, pause: false, reason: "" });
  assert.equal(detectPlan({ cameraFps: 30 }).every, 1);
  assert.equal(detectPlan({ recording: true, cameraFps: 60, fps: 60, detectCost: 4 }).every, 6);
  assert.equal(detectPlan({ cameraFps: 60, fps: 50 }).every, 3);
  assert.equal(detectPlan({ cameraFps: 60, skeletonOn: false }).every, 6);
});

test("pose tracking pauses while recording when off, slow, dropping frames, or already paused", () => {
  assert.equal(detectPlan({ recording: true, skeletonOn: false }).reason, "off");
  assert.equal(detectPlan({ recording: true, detectCost: 12 }).reason, "slow");
  assert.equal(detectPlan({ recording: true, cameraFps: 60, fps: 52 }).reason, "fps");
  assert.equal(detectPlan({ recording: true, cameraFps: 30, fps: 29.8 }).pause, false);  // a 30 fps camera is not "dropping"
  assert.equal(detectPlan({ recording: true, held: true, fps: 60 }).reason, "held");
});
