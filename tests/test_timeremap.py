"""Slow motion: metadata, a synthetic baked-in 4x slowed stretch (with slowed sound and with the
sound muted), the real-time clock, and display times converted back to file time."""
import subprocess

import imageio_ffmpeg
import numpy as np
import pytest

from app import timeremap as tr
from app.media import probe_video

SR = 44100
FPS = 60
W, H = 320, 240
# real time 0-2 s normal, 2-2.5 s captured slow (4x: file 2-4 s), 2.5-4.5 s normal (file 4-6 s)
TRUE_MAP = tr.TimeMap([tr.Segment(2.0, 4.0, 4.0)])


def _clip(path, sound="slowed"):
    """Square moving at 3 Hz and clicks 8 per second over noise, all in real time, baked 4x slow at file 2-4 s."""
    from scipy.signal import resample_poly
    n = int(6.0 * FPS)
    frames = np.zeros((n, H, W, 3), dtype=np.uint8)
    frames[:] = 40
    for i in range(n):
        treal = TRUE_MAP.to_real(i / FPS)
        x = int(W / 2 - 30 + 80 * np.sin(2 * np.pi * 3.0 * treal))
        frames[i, 90:150, max(0, x):max(0, x) + 60] = 230
    rng = np.random.default_rng(1)
    real = rng.normal(0, 0.03, int(4.5 * SR)).astype(np.float32)
    for k in range(int(4.5 * 8)):
        a = int(k * 0.125 * SR)
        real[a:a + 220] += rng.normal(0, 0.5, 220).astype(np.float32)
    a, b = int(2.0 * SR), int(2.5 * SR)
    slow = resample_poly(real[a:b], 4, 1).astype(np.float32) if sound == "slowed" else np.zeros((b - a) * 4, np.float32)
    audio = np.concatenate([real[:a], slow, real[b:]])
    wav = path.with_suffix(".wav")
    tr.write_wav(wav, audio / max(1.0, np.abs(audio).max()), SR)
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run([ff, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                    "-i", "-", "-i", str(wav), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12",
                    "-c:a", "aac", "-b:a", "192k", "-shortest", str(path)], input=frames.tobytes(), check=True)
    return path, audio


def _load(path):
    from app.audio import load_wav
    from app.media import extract_audio
    wav = path.with_name(path.stem + "-x.wav")
    info = probe_video(path)
    extract_audio(path, wav, info)
    y, sr = load_wav(wav)
    return info, y, sr


def test_timemap_round_trip():
    m = TRUE_MAP
    assert m.to_real(1.0) == 1.0 and m.to_real(3.0) == pytest.approx(2.25) and m.to_real(6.0) == pytest.approx(4.5)
    for r in (0.5, 2.1, 2.4, 3.0, 4.4):
        assert m.to_real(m.to_file(r)) == pytest.approx(r)
    assert tr.snap(3.7) == 4 and tr.snap(8.9) == 8 and tr.snap(3.0) is None and tr.snap(1.1) is None


@pytest.mark.parametrize("sound", ["slowed", "muted"])
def test_baked_in_4x_section_detected_and_remapped(tmp_path, sound):
    from app.audio import detect_onsets
    path, _ = _clip(tmp_path / f"baked-{sound}.mp4", sound)
    info, y, sr = _load(path)
    assert abs(info.fps - 60) < 1                        # the container looks like plain 60 fps
    tmap, sec = tr.detect(path, info, y, sr)
    assert tmap is not None and sec["remapped"] and sec["method"].startswith("content"), sec
    (seg,) = tmap.segments
    assert seg.factor == 4 and abs(seg.file_start - 2.0) < 0.25 and abs(seg.file_end - 4.0) < 0.25
    assert seg.audio == sound
    assert "captured at ~240 fps, analyzed at real speed" in sec["message"]
    assert abs(sec["real_duration_s"] - 4.5) < 0.3
    onsets = [o["t"] for o in detect_onsets(tr.real_time_audio(y, sr, tmap), sr)]
    ioi = np.diff(onsets)
    assert abs(np.median(ioi) - 0.125) < 0.01          # 8 clicks a second on the real-time clock
    if sound == "slowed":                               # slowed sound compressed back: no gap
        assert ioi.max() < 0.2 and len(onsets) >= 32
    else:                                               # muted stretch: hits there come from video only
        assert ioi.max() > 0.3


def test_normal_clip_not_flagged(tmp_path):
    from scripts.make_test_video import make_video
    path = make_video(tmp_path / "plain60.mp4", fps=60, seconds=4.0, bpm=100.0)
    info, y, sr = _load(path)
    tmap, sec = tr.detect(path, info, y, sr)
    assert tmap is None and sec["detected"] is False and sec["message"] is None


def test_android_capture_fps_metadata_means_whole_file_slowed(tmp_path):
    out = tmp_path / "android.mp4"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30",
                    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-metadata", "com.android.capture.fps=120",
                    "-movflags", "use_metadata_tags", str(out)], check=True)
    info = probe_video(out)
    tmap, sec = tr.detect(out, info, None, None)
    assert tmap is not None and tmap.segments[0].factor == 4 and sec["metadata"]["android_capture_fps"] == 120
    assert "captured at ~120 fps" in sec["message"]


def test_samsung_sef_trailer_segments(tmp_path):
    out = tmp_path / "sef.mp4"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=240",
                    "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)], check=True)
    name, data = b"SlowMotion_Data", b"200:700:3"
    rec = b"\x00\x00" + (0x0890).to_bytes(2, "little") + len(name).to_bytes(4, "little") + name + data
    body = out.read_bytes()
    dir_ = b"SEFH" + (106).to_bytes(4, "little") + (1).to_bytes(4, "little") + b"\x00\x00" + (0x0890).to_bytes(2, "little") \
        + len(rec).to_bytes(4, "little") + len(rec).to_bytes(4, "little")
    out.write_bytes(body + rec + dir_ + (len(dir_)).to_bytes(4, "little") + b"SEFT")
    assert tr.read_sef_slow_motion(out) == [{"start_s": 0.2, "end_s": 0.7, "slow_down": 4}]
    tmap, sec = tr.detect(out, probe_video(out), None, None)
    assert tmap is None and sec["detected"] and "Samsung" in sec["method"]      # real-time original: no remap


def test_no_sound_strikes_and_file_times():
    m = tr.TimeMap([tr.Segment(2.0, 4.0, 4.0, "muted")])
    ver = {"video_only": [{"t": 1.0, "hand": "L"}, {"t": 2.2, "hand": "R"}, {"t": 2.4, "hand": "L"}],
           "verified_stroke_count": 3, "unverified_onsets": 1, "video_only_strikes": 3, "agreement_pct": 42.86}
    tr.split_video_only(ver, m)
    assert ver["video_only_strikes"] == 1 and len(ver["video_only_no_sound"]) == 2
    assert ver["video_only_no_sound"][0]["note"] == tr.NO_SOUND and ver["agreement_pct"] == 60.0
    report = {"audio": {"onsets": [{"t": 2.25}], "beat_times": [2.25]}, "strokes": [{"t": 2.25}, {"t": 3.0}],
              "verification": ver, "video": {"trajectories": {"t": [2.25]}},
              "coaching": {"findings": [{"examples": [{"t": 2.25, "label": "x"}]}]}}
    tr.to_file_times(report, m)
    assert report["strokes"][0] == {"t": 3.0, "t_real": 2.25} and report["strokes"][1]["t"] == 4.5
    assert report["audio"]["onsets"][0]["t"] == 3.0 and report["audio"]["beat_times"] == [3.0]
    assert report["coaching"]["findings"][0]["examples"][0]["t"] == 3.0
    assert report["verification"]["video_only_no_sound"][0]["t"] == pytest.approx(2.8)
