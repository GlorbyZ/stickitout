"""Frame-rate measurement across containers: WebM without a duration header
(MediaRecorder style), variable and uneven frame rate, 30 fps acceptance with the
low frame rate flag, and the rejection message below MIN_FPS."""
import subprocess

import imageio_ffmpeg
import pytest

from app import config
from app.media import MediaError, check_frame_rate, is_low_fps, low_fps_message, probe_video


def encode(out, *args):
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args, str(out)], check=True)
    return out


def test_webm_60fps(tmp_path):
    out = encode(tmp_path / "rec.webm", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=60", "-f", "lavfi",
                 "-i", "sine=f=440", "-t", "2", "-c:v", "libvpx", "-deadline", "realtime", "-c:a", "libopus")
    info = probe_video(out)
    assert info.container == "matroska" and info.has_audio
    assert 59 <= info.fps <= 61
    check_frame_rate(info)
    assert not is_low_fps(info.fps)


def test_variable_frame_rate_uses_real_average(tmp_path):
    # 60 fps source with every other frame dropped in the second half: 1.5 s of 60 + 1.5 s of 30.
    out = encode(tmp_path / "vfr.mp4", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=60", "-t", "3",
                 "-vf", "select='lt(t,1.5)+not(mod(n,2))'", "-fps_mode", "vfr", "-c:v", "libx264", "-preset", "ultrafast")
    info = probe_video(out)
    assert 43 <= info.fps <= 47          # (90 + 45) frames over 3 s
    check_frame_rate(info)               # accepted now, but under the 60 fps class
    assert is_low_fps(info.fps)


def test_30fps_accepted_and_flagged(tmp_path):
    out = encode(tmp_path / "phone30.mp4", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-t", "1",
                 "-c:v", "libx264", "-preset", "ultrafast")
    info = probe_video(out)
    assert 29 <= info.fps <= 31
    check_frame_rate(info)
    assert is_low_fps(info.fps)
    msg = low_fps_message(info.fps)
    assert msg.startswith("Recorded at 30 fps.") and "60 fps" in msg and "estimates" in msg
    assert "\u2014" not in msg and "\u2013" not in msg      # plain punctuation, no em or en dashes


def test_uneven_30fps_phone_timing_accepted(tmp_path):
    # Frames in uneven pairs (16.7 ms then 50 ms apart) averaging 30 fps, like a jittery phone file.
    out = encode(tmp_path / "uneven30.mp4", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=60", "-t", "3",
                 "-vf", "select='lt(mod(n,4),2)'", "-fps_mode", "vfr", "-c:v", "libx264", "-preset", "ultrafast")
    info = probe_video(out)
    assert 28 <= info.fps <= 32
    check_frame_rate(info)
    assert is_low_fps(info.fps)


def test_below_minimum_rejected_with_actionable_message(tmp_path):
    out = encode(tmp_path / "slow.mp4", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15", "-t", "1",
                 "-c:v", "libx264", "-preset", "ultrafast")
    with pytest.raises(MediaError) as err:
        check_frame_rate(probe_video(out))
    msg = str(err.value)
    assert "15 fps" in msg and "at least 24 fps" in msg and "60 fps" in msg


def test_min_fps_is_configurable(tmp_path, monkeypatch):
    out = encode(tmp_path / "phone30.mp4", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-t", "1",
                 "-c:v", "libx264", "-preset", "ultrafast")
    info = probe_video(out)
    monkeypatch.setattr(config, "MIN_FPS", 40.0)
    with pytest.raises(MediaError, match="at least 40 fps"):
        check_frame_rate(info)
    monkeypatch.setattr(config, "MIN_FPS", 12.0)
    check_frame_rate(info)


def test_min_fps_env_var(monkeypatch):
    import importlib
    monkeypatch.setenv("MIN_FPS", "28")
    try:
        assert importlib.reload(config).MIN_FPS == 28.0
    finally:
        monkeypatch.delenv("MIN_FPS")
        importlib.reload(config)
    assert config.MIN_FPS == 23.5
