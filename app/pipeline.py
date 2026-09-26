"""Analysis pipeline run in the background for each job (spec section 3):

  1. extract the audio track from the uploaded video (ffmpeg)
  2. audio module   -> onsets, tempo, timing, velocity
  3. video module   -> landmarks, tracks, session form metrics
  4. fusion module  -> per-stroke records and audio/video cross-verification
  5. sticking check -> single paradiddle RLRR LRLL comparison
  6. scoring        -> 0-100 scores
  7. write report.json and mark the job done

Clips from MIN_FPS (about 24) up to 50 fps are analysed with quality.low_fps set,
a disclaimer message, and a widened audio/video verify window.

A video-stage failure never sinks the run: the form section is marked degraded
with the reason and the audio results are still returned.

analyze_file() runs stages 1 to 5 on any video file (the job runner, the training
dataset intake and scripts/evaluate.py all use it). It can cache the MediaPipe
landmarks, the slow part, so re-running with other tuning settings is quick.
Thresholds come from app/tuning.py (current settings at call time).
"""
from __future__ import annotations

import gzip
import json
import platform
import traceback
from pathlib import Path

from . import jobs, tuning
from .audio import analyze_audio
from .fusion import fuse
from .media import LOW_FPS_BELOW, MediaError, VideoInfo, extract_audio, is_low_fps, low_fps_message, min_fps, probe_video
from .scoring import score_report
from .sticking import check_sticking
from .video import MAX_PROCESS_WIDTH, build_tracks, extract_landmarks, session_metrics

ENGINE_VERSION = "0.1.0"


def _versions() -> dict:
    import aubio
    import cv2
    import librosa
    import mediapipe
    import numpy
    return {"engine": ENGINE_VERSION, "python": platform.python_version(), "aubio": str(aubio.version),
            "librosa": librosa.__version__, "mediapipe": mediapipe.__version__, "opencv": cv2.__version__,
            "numpy": numpy.__version__, "tuning": tuning.as_dict()}


def _cache_key(video_path: Path) -> dict:
    import mediapipe
    st = Path(video_path).stat()
    return {"size": st.st_size, "mtime": int(st.st_mtime), "max_width": MAX_PROCESS_WIDTH,
            "mediapipe": mediapipe.__version__, "version": 1}


def landmarks(video_path: Path, progress=None, cache: Path | None = None) -> dict:
    """MediaPipe landmarks for every frame, read from / written to a gzip JSON cache when given."""
    key = _cache_key(video_path) if cache else None
    if cache and Path(cache).exists():
        try:
            with gzip.open(cache, "rt", encoding="utf-8") as fh:
                data = json.load(fh)
            if data.get("key") == key:
                return data["raw"]
        except (OSError, ValueError, KeyError):
            pass
    raw = extract_landmarks(video_path, progress)
    if cache:
        Path(cache).parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(str(cache) + ".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as fh:
            json.dump({"key": key, "raw": raw}, fh)
        tmp.replace(cache)
    return raw


def run_video_stage(video_path: Path, progress, cache: Path | None = None) -> tuple[object | None, dict]:
    """Landmarks and session metrics. Returns (tracks or None, video section)."""
    try:
        raw = landmarks(video_path, progress, cache)
        tracks = build_tracks(raw)
        return tracks, session_metrics(tracks)
    except Exception as exc:  # degrade, keep the audio results
        return None, degraded_video(exc)


def degraded_video(exc: Exception) -> dict:
    """Video section for a failed video stage."""
    return {
        "frames_total": 0, "frames_kept": 0, "landmark_coverage": 0.0, "degraded": True,
        "degraded_reason": f"Video analysis failed: {type(exc).__name__}: {exc}",
        "normalization": None,
        "form": {"symmetry": None, "posture_drift_per_min": None, "shoulder_line_angle_deg": None,
                 "grip_proxy": {"experimental": True, "L": None, "R": None}},
        "trajectories": {"t": [], "left_wrist_height": [], "right_wrist_height": []},
    }


def analyse(audio: dict, tracks, video: dict, params: dict, fps: float | None = None) -> dict:
    """Fusion, sticking check, per-hand form and scores for already-computed audio and video.

    fps is the measured source frame rate (widens the verify window under 50 fps).
    """
    strokes, verification, hand_form = fuse(audio, tracks, video["degraded"],
                                            params.get("av_offset_ms", 0.0), params.get("verify_window_ms"), fps)
    sticking = check_sticking(strokes, params.get("rudiment"))
    for s in strokes:
        s.setdefault("expected_hand", None)
    video = {**video, "form": {
        "stroke_height": {h: {"mean": hand_form[h]["stroke_height_mean"], "std": hand_form[h]["stroke_height_std"]}
                          for h in ("L", "R")},
        "arm_vs_wrist_index": {h: hand_form[h]["arm_vs_wrist_index"] for h in ("L", "R")},
        **video["form"],
    }}
    scores = score_report(audio, video, strokes, verification)
    return {"video": video, "strokes": strokes, "verification": verification, "sticking": sticking, "scores": scores}


def quality_section(info: VideoInfo, verification: dict) -> dict:
    """Frame rate quality flag: low_fps under 50 fps, with the disclaimer and the window used."""
    low = is_low_fps(info.fps)
    return {
        "low_fps": low,
        "measured_fps": info.fps,
        "min_fps": min_fps(),
        "full_accuracy_fps": LOW_FPS_BELOW,
        "verify_window_ms": verification["window_ms"],
        "verify_window_widened": bool(verification.get("window_widened", False)),
        "message": low_fps_message(info.fps) if low else None,
    }


def build_report(job_id: str, created_at: str, filename: str, info: VideoInfo, params: dict,
                 audio: dict, analysed: dict) -> dict:
    """Assemble the report in the shape of schema/report.schema.json."""
    return {
        "job_id": job_id,
        "created_at": created_at,
        "source": {"filename": filename, "fps": info.fps, "nominal_fps": info.nominal_fps,
                   "duration_s": info.duration_s, "frame_count": info.frame_count, "width": info.width,
                   "height": info.height, "container": info.container},
        "quality": quality_section(info, analysed["verification"]),
        "params": params,
        "audio": audio,
        **analysed,
        "engine": _versions(),
    }


def analyze_file(video_path: Path, params: dict, workdir: Path, stage=None,
                 landmarks_cache: Path | None = None) -> tuple[VideoInfo, dict, dict]:
    """Probe, extract audio (workdir/audio.wav, reused when present), audio, video, fusion.

    Returns (info, audio section, analysed sections). stage(name, progress) reports progress.
    Raises MediaError for files that cannot be analysed.
    """
    stage = stage or (lambda name, progress: None)
    stage("probing video", 0.02)
    info = probe_video(video_path)
    stage("extracting audio", 0.05)
    wav = Path(workdir) / "audio.wav"
    if not wav.exists() or wav.stat().st_mtime < Path(video_path).stat().st_mtime:
        extract_audio(video_path, wav, info)
    stage("analysing audio", 0.10)
    audio = analyze_audio(wav, params.get("target_bpm"))
    stage("tracking pose and hands", 0.30)
    tracks, video = run_video_stage(video_path, lambda f: stage("tracking pose and hands", 0.30 + 0.55 * f),
                                    landmarks_cache)
    stage("fusing audio and video", 0.90)
    return info, audio, analyse(audio, tracks, video, params, info.fps)


def run(job_id: str, video_path: Path, params: dict) -> None:
    """Execute the full pipeline for one job, recording progress in job.json."""
    d = jobs.job_dir(job_id)

    def stage(name: str, progress: float) -> None:
        jobs.update(job_id, status="processing", stage=name, progress=round(progress, 3))

    try:
        info, audio, analysed = analyze_file(video_path, params, d, stage)
        job = jobs.read(job_id)
        jobs.write_report(job_id, build_report(job_id, job["created_at"], job["filename"], info, params, audio, analysed))
        jobs.update(job_id, status="done", stage="done", progress=1.0)
    except MediaError as exc:
        jobs.update(job_id, status="error", stage="error", error=str(exc))
    except Exception as exc:
        (d / "error.log").write_text(traceback.format_exc(), encoding="utf-8")
        jobs.update(job_id, status="error", stage="error", error=f"Analysis failed: {type(exc).__name__}: {exc}")
