"""Frame-rate measurement across containers: WebM without a duration header
(MediaRecorder style), variable frame rate, and the 30 fps rejection message."""
import subprocess

import imageio_ffmpeg
import pytest

from app.media import MediaError, check_frame_rate, probe_video


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


def test_variable_frame_rate_uses_real_average(tmp_path):
    # 60 fps source with every other frame dropped in the second half: 1.5 s of 60 + 1.5 s of 30.
    out = encode(tmp_path / "vfr.mp4", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=60", "-t", "3",
                 "-vf", "select='lt(t,1.5)+not(mod(n,2))'", "-fps_mode", "vfr", "-c:v", "libx264", "-preset", "ultrafast")
    info = probe_video(out)
    assert 43 <= info.fps <= 47          # (90 + 45) frames over 3 s
    with pytest.raises(MediaError, match="fps"):
        check_frame_rate(info)


def test_30fps_message_is_actionable(tmp_path):
    out = encode(tmp_path / "slow.mp4", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-t", "1",
                 "-c:v", "libx264", "-preset", "ultrafast")
    with pytest.raises(MediaError) as err:
        check_frame_rate(probe_video(out))
    assert "30 fps" in str(err.value) and "60 fps" in str(err.value)
