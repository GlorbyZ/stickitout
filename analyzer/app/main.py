"""FastAPI app: upload endpoint, job status, results, and the static frontend.

Endpoints (all JSON; errors are {"error": message} with a proper status code):
  POST /api/analyze          multipart: video (required), rudiment, target_bpm,
                             av_offset_ms, verify_window_ms -> 202 {job_id}
  GET  /api/jobs/{id}        {status, progress, error, stage}
  GET  /api/results/{id}     full report JSON (schema/report.schema.json), coaching included
  GET  /api/jobs/{id}/video  the uploaded video, for playback on the results page
  GET  /api/config           {max_upload_mb, access_gate, min_fps, full_accuracy_fps} for the frontend
  GET  /healthz              {"ok": true}, never gated (for host health checks)
  GET  /                     Analyze page (upload, record, results)

Training dataset (labeling page and accuracy evaluation, see app/dataset.py):
  GET  /label                             Label page
  GET  /api/dataset                       {clips: [summary]}
  POST /api/dataset                       multipart: video + optional player, labeler, rudiment,
                                          click_bpm, surface, camera_angle, lighting, take_type
                                          -> 202 {clip_id}; analysed in the background to pre-fill strokes
  POST /api/dataset/from-job/{job_id}     copy a finished analysis (original video + report) -> 202 {clip_id}
  GET  /api/dataset/{clip_id}             {labels, status, video, detections, onsets, analysis}
  PUT  /api/dataset/{clip_id}/labels      save labels (JSON, schema/labels.schema.json) -> {labels}
  POST /api/dataset/{clip_id}/reanalyze   re-run the analyzer for fresh detections (labels untouched)
  GET  /api/dataset/{clip_id}/video       the clip (browser copy when the original codec will not play)
  GET  /api/dataset/{clip_id}/waveform    {rate, duration_s, peaks} for the labeling timeline

Settings come from environment variables (app/config.py). If ACCESS_TOKEN is set,
everything except /healthz is behind the access gate (app/access.py). Jobs older
than JOB_TTL_HOURS are deleted at startup and then at most every 10 minutes.

Frame rate is checked at upload time so a clip under MIN_FPS (about 24 fps) is
rejected immediately (422) instead of failing later in the background job.
30 fps clips are accepted; their report carries quality.low_fps and a disclaimer.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import threading
import uuid
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from starlette.requests import ClientDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import coaching, config, dataset, jobs, labels, pipeline, tuning
from .access import AccessGate
from .media import LOW_FPS_BELOW, SLOW_MOTION_FPS, MediaError, check_frame_rate, is_slow_motion, min_fps, probe_video

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
MAX_UPLOAD_BYTES = int(config.MAX_UPLOAD_MB * 1024 * 1024)
CLEANUP_EVERY_S = 600
_last_cleanup = 0.0
ALLOWED_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
DEFAULT_RUDIMENT = "Single Paradiddle"



def cleanup_old_jobs(force: bool = False) -> None:
    global _last_cleanup
    if force or time.time() - _last_cleanup > CLEANUP_EVERY_S:
        _last_cleanup = time.time()
        jobs.cleanup(config.JOB_TTL_HOURS)
        cleanup_abandoned_uploads()


def pull_shared_clips() -> None:
    """Copy settled videos from CLIP_SHARE into the dataset and start intake."""
    if not config.CLIP_SHARE:
        return
    try:
        added = dataset.import_from_share()
    except OSError:
        return
    for item in added:
        dataset.process(item["clip_id"])


def _share_loop() -> None:
    while True:
        pull_shared_clips()
        time.sleep(30)


@asynccontextmanager
async def lifespan(_: FastAPI):
    cleanup_old_jobs(force=True)
    if config.CLIP_SHARE:
        threading.Thread(target=_share_loop, name="clip-share", daemon=True).start()
    yield


app = FastAPI(title="Stick It Out Analyzer", version=pipeline.ENGINE_VERSION, lifespan=lifespan)


def too_large_message() -> str:
    return (f"Video is larger than {config.MAX_UPLOAD_MB:g} MB. Trim it to the part you want analysed "
            "or record a shorter take.")


def error(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return error(exc.status_code, str(exc.detail))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    return error(422, f"Invalid {field}: {first.get('msg', 'bad value')}")


@app.exception_handler(Exception)
async def unhandled_error(_: Request, exc: Exception) -> JSONResponse:
    return error(500, f"Internal error: {type(exc).__name__}")


def _number(raw: str | None, name: str, lo: float, hi: float, default: float | None) -> float | None:
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name} must be a number.")
    if not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError(f"{name} must be between {lo:g} and {hi:g}.")
    return value


def _params(rudiment, target_bpm, av_offset_ms, verify_window_ms) -> dict:
    from .profiles import profile as rudiment_profile
    chosen = rudiment_profile(rudiment) or rudiment_profile(DEFAULT_RUDIMENT)
    if rudiment and str(rudiment).strip() and rudiment_profile(rudiment) is None:
        raise ValueError("That rudiment is not one we have recorded takes for yet.")
    return {
        "rudiment": chosen["name"],
        "target_bpm": _number(target_bpm, "target_bpm", 20, 400, None),
        "av_offset_ms": _number(av_offset_ms, "av_offset_ms", -2000, 2000, 0.0),
        "verify_window_ms": _number(verify_window_ms, "verify_window_ms", 5, 200,
                                    tuning.current().verify_window_ms),
    }


def _extension(filename: str, content_type: str | None) -> str:
    return Path(filename).suffix.lower() or (".webm" if "webm" in (content_type or "") else ".mp4")


async def _start_job(background: BackgroundTasks, job_id: str, path: Path, params: dict):
    """Probe the saved upload, refuse unusable footage, then analyse in the background."""
    try:
        info = await run_in_threadpool(probe_video, path)
        check_frame_rate(info)
    except MediaError as exc:
        jobs.delete(job_id)
        return error(422, str(exc))
    jobs.update(job_id, video_file=path.name, source={"fps": info.fps, "duration_s": info.duration_s})
    background.add_task(pipeline.run, job_id, path, params)
    return {"job_id": job_id, "fps": info.fps, "slow_motion": is_slow_motion(info.fps)}


@app.post("/api/analyze", status_code=202)
async def analyze(
    background: BackgroundTasks,
    video: UploadFile = File(...),
    rudiment: str = Form(DEFAULT_RUDIMENT),
    target_bpm: str | None = Form(None),
    av_offset_ms: str | None = Form(None),
    verify_window_ms: str | None = Form(None),
):
    try:
        params = _params(rudiment, target_bpm, av_offset_ms, verify_window_ms)
    except ValueError as exc:
        return error(422, str(exc))
    filename = Path(video.filename or "upload.mp4").name
    ext = _extension(filename, video.content_type)
    if ext not in ALLOWED_EXT:
        return error(415, f"Unsupported file type {ext}. Upload an MP4, MOV or WebM video.")

    cleanup_old_jobs()
    job_id = jobs.create(filename)
    path = jobs.job_dir(job_id) / f"video{ext}"
    size = 0
    with path.open("wb") as out:
        while chunk := await video.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                jobs.delete(job_id)
                return error(413, too_large_message())
            out.write(chunk)
    return await _start_job(background, job_id, path, params)


# Resumable upload (every file size), built for shaky connections and Wi-Fi/cell switches.
# The page cuts the file into PIECE_BYTES pieces and sends each with its index and SHA-256:
#   POST /api/uploads (filename, size)          -> {upload_id, piece_bytes, pieces}
#   GET  /api/uploads/{id}                      -> {size, piece_bytes, pieces, have: [indexes], complete, job_id}
#   PUT  /api/uploads/{id}/pieces/{i}?sha256=H  raw bytes; checked, then stored (re-sending is fine)
#   POST /api/uploads/{id}/finish               same form fields as /api/analyze -> {job_id, fps, slow_motion}
# A piece is written to a temp file and only kept when its length and checksum match, so a dropped
# connection never leaves half a piece. Finish joins the pieces, checks the total size and starts
# the analysis; calling it again returns the same job. Unfinished uploads are deleted after 24 h.
PIECE_BYTES = 8 * 1024 * 1024
MAX_PIECE_BYTES = 32 * 1024 * 1024
UPLOAD_TTL_HOURS = 24.0
UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _upload(upload_id: str) -> tuple[Path, dict] | None:
    if not UPLOAD_ID.match(upload_id or ""):
        return None
    meta = jobs.job_dir(upload_id) / "upload.json"
    try:
        return meta.parent, json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _have(folder: Path, meta: dict) -> list[int]:
    return sorted(int(f.name[6:]) for f in folder.glob("piece-*") if f.name[6:].isdigit()
                  and int(f.name[6:]) < meta["pieces"])


def _piece_len(meta: dict, index: int) -> int:
    return min(meta["piece_bytes"], meta["size"] - index * meta["piece_bytes"])


def cleanup_abandoned_uploads(max_age_hours: float = UPLOAD_TTL_HOURS) -> int:
    """Delete unfinished uploads (pieces but no joined video) with nothing new for max_age_hours."""
    if not jobs.DATA_DIR.exists():
        return 0
    cutoff, removed = time.time() - max_age_hours * 3600, 0
    for d in jobs.DATA_DIR.iterdir():
        if not (d.is_dir() and UPLOAD_ID.match(d.name) and (d / "upload.json").exists()):
            continue
        if any(f.name.startswith("video.") for f in d.iterdir()):
            continue                                   # finished: normal job retention applies
        newest = max((f.stat().st_mtime for f in d.iterdir()), default=d.stat().st_mtime)
        if newest < cutoff:
            jobs.delete(d.name)
            removed += 1
    return removed


@app.post("/api/uploads", status_code=201)
async def upload_start(filename: str = Form("upload.mp4"), size: str = Form(...),
                       content_type: str | None = Form(None), piece_bytes: str | None = Form(None)):
    name = Path(filename or "upload.mp4").name
    ext = _extension(name, content_type)
    if ext not in ALLOWED_EXT:
        return error(415, f"Unsupported file type {ext}. Upload an MP4, MOV or WebM video.")
    if not (size or "").isdigit() or int(size) <= 0:
        return error(422, "Invalid size: must be the file size in bytes.")
    total = int(size)
    if total > MAX_UPLOAD_BYTES:
        return error(413, too_large_message())
    cleanup_old_jobs()
    job_id = jobs.create(name)
    step = PIECE_BYTES                          # the page uses the default; tests may ask for smaller pieces
    if (piece_bytes or "").isdigit():
        step = max(256 * 1024, min(MAX_PIECE_BYTES, int(piece_bytes)))
    meta = {"filename": name, "ext": ext, "size": total, "piece_bytes": step,
            "pieces": -(-total // step), "created": time.time()}
    (jobs.job_dir(job_id) / "upload.json").write_text(json.dumps(meta), encoding="utf-8")
    jobs.update(job_id, stage="uploading")
    return {"upload_id": job_id, "piece_bytes": step, "pieces": meta["pieces"]}


@app.get("/api/uploads/{upload_id}")
def upload_status(upload_id: str):
    up = _upload(upload_id)
    if up is None:
        return error(404, "Upload not found. Start the upload again.")
    folder, meta = up
    done = any(f.name.startswith("video.") for f in folder.iterdir())
    have = list(range(meta["pieces"])) if done else _have(folder, meta)
    return {"upload_id": upload_id, "size": meta["size"], "piece_bytes": meta["piece_bytes"],
            "pieces": meta["pieces"], "have": have, "complete": len(have) == meta["pieces"],
            "job_id": upload_id if done else None}


@app.put("/api/uploads/{upload_id}/pieces/{index}")
async def upload_piece(upload_id: str, index: int, request: Request, sha256: str = ""):
    up = _upload(upload_id)
    if up is None:
        return error(404, "Upload not found. Start the upload again.")
    folder, meta = up
    if not 0 <= index < meta["pieces"]:
        return error(422, f"Invalid piece index {index}.")
    want = sha256.lower()
    if not SHA256.match(want):
        return error(422, "Invalid sha256: 64 hex characters expected.")
    expected = _piece_len(meta, index)
    target = folder / f"piece-{index}"
    if any(f.name.startswith("video.") for f in folder.iterdir()):
        return {"index": index, "stored": True, "have": meta["pieces"], "pieces": meta["pieces"]}
    tmp = folder / f"piece-{index}.{uuid.uuid4().hex[:8]}.tmp"
    digest, size = hashlib.sha256(), 0
    try:
        with tmp.open("wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > expected:
                    break
                digest.update(chunk)
                out.write(chunk)
        if size != expected:
            tmp.unlink(missing_ok=True)
            return error(400, f"Piece {index} has {size} bytes, expected {expected}. Send it again.")
        if digest.hexdigest() != want:
            tmp.unlink(missing_ok=True)
            return error(400, f"Piece {index} checksum does not match. Send it again.")
        tmp.replace(target)                     # atomic; a re-sent piece simply replaces the same bytes
    except ClientDisconnect:
        tmp.unlink(missing_ok=True)
        return error(400, "Connection dropped during the piece.")
    finally:
        tmp.unlink(missing_ok=True)
    return {"index": index, "stored": True, "have": len(_have(folder, meta)), "pieces": meta["pieces"]}


@app.post("/api/uploads/{upload_id}/finish", status_code=202)
async def upload_finish(
    upload_id: str,
    background: BackgroundTasks,
    rudiment: str = Form(DEFAULT_RUDIMENT),
    target_bpm: str | None = Form(None),
    av_offset_ms: str | None = Form(None),
    verify_window_ms: str | None = Form(None),
):
    up = _upload(upload_id)
    if up is None:
        return error(404, "Upload not found. Start the upload again.")
    folder, meta = up
    try:
        params = _params(rudiment, target_bpm, av_offset_ms, verify_window_ms)
    except ValueError as exc:
        return error(422, str(exc))
    job = jobs.read(upload_id)
    if job.get("video_file"):                   # finished before (the answer got lost): same job
        fps = (job.get("source") or {}).get("fps") or 0
        return {"job_id": upload_id, "fps": fps, "slow_motion": is_slow_motion(fps)}
    have = _have(folder, meta)
    missing = sorted(set(range(meta["pieces"])) - set(have))
    if missing:
        return JSONResponse({"error": f"{len(missing)} pieces are still missing.", "missing": missing[:500]},
                            status_code=409)
    path = folder / f"video{meta['ext']}"
    tmp = folder / "joining.tmp"
    with tmp.open("wb") as out:
        for i in range(meta["pieces"]):
            with (folder / f"piece-{i}").open("rb") as fh:
                shutil.copyfileobj(fh, out, 1024 * 1024)
    if tmp.stat().st_size != meta["size"]:
        tmp.unlink(missing_ok=True)
        return error(409, "The joined file has the wrong size. Start the upload again.")
    tmp.replace(path)
    for i in range(meta["pieces"]):
        (folder / f"piece-{i}").unlink(missing_ok=True)
    return await _start_job(background, upload_id, path, params)


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    try:
        job = jobs.read(job_id)
    except KeyError:
        return error(404, "Job not found.")
    return {"status": job["status"], "progress": job["progress"], "error": job["error"], "stage": job.get("stage")}


@app.get("/api/results/{job_id}")
def results(job_id: str):
    try:
        job = jobs.read(job_id)
    except KeyError:
        return error(404, "Job not found.")
    if job["status"] == "error":
        return error(422, job["error"] or "Analysis failed.")
    if job["status"] != "done":
        return error(409, f"Job is {job['status']}; results are not ready yet.")
    report = jobs.read_report(job_id)
    if coaching.needs_update(report):   # made before coaching (or an older version): computed on the fly
        report["coaching"] = coaching.safe_coach(report)
    return report


@app.get("/api/jobs/{job_id}/video")
def job_video(job_id: str):
    try:
        job = jobs.read(job_id)
    except KeyError:
        return error(404, "Job not found.")
    path = jobs.job_dir(job_id) / job.get("video_file", "")
    if not job.get("video_file") or not path.exists():
        return error(404, "Video not found.")
    return FileResponse(path)


@app.get("/api/jobs/{job_id}/landmarks")
def job_landmarks(job_id: str):
    """Per-frame pose and hand landmarks for the playback skeleton, keyed by frame presentation time."""
    try:
        job = jobs.read(job_id)
    except KeyError:
        return error(404, "Job not found.")
    if job["status"] != "done":
        return error(409, f"Job is {job['status']}; landmarks are not ready yet.")
    data = pipeline.playback_landmarks(jobs.job_dir(job_id) / pipeline.LANDMARKS_FILE)
    if data is None:
        return error(404, "No per-frame skeleton data for this analysis. Analyze the video again to draw it on playback.")
    return data


# ---------- training dataset ----------
DATASET_META_FIELDS = ("player", "rudiment", "click_bpm", "surface", "camera_angle", "lighting", "take_type")


def _clip_or_404(clip_id: str):
    if not dataset.exists(clip_id):
        return error(404, "Clip not found.")
    return None


@app.get("/api/dataset")
def dataset_list():
    return {"clips": dataset.list_clips(), "dataset_dir": str(dataset.DATASET_DIR),
            "clip_share": str(config.CLIP_SHARE) if config.CLIP_SHARE else ""}


@app.post("/api/dataset/import-share", status_code=202)
def dataset_import_share(background: BackgroundTasks):
    if not config.CLIP_SHARE:
        return error(404, "CLIP_SHARE is not set. Point it at the shared drive folder.")
    if not config.CLIP_SHARE.is_dir():
        return error(404, f"Shared drive folder was not found: {config.CLIP_SHARE}")
    background.add_task(pull_shared_clips)
    return {"ok": True, "clip_share": str(config.CLIP_SHARE)}


@app.post("/api/dataset", status_code=202)
async def dataset_upload(request: Request, background: BackgroundTasks, video: UploadFile = File(...)):
    form = await request.form()
    raw = {k: str(form.get(k)).strip() for k in DATASET_META_FIELDS if form.get(k) not in (None, "")}
    try:
        meta = {k: (float(v) if k == "click_bpm" else v) for k, v in raw.items()}
        meta = labels.validate_meta(meta)
    except ValueError as exc:
        return error(422, str(exc) if isinstance(exc, labels.LabelError) else "click_bpm must be a number.")
    filename = Path(video.filename or "clip.mp4").name
    ext = Path(filename).suffix.lower() or (".webm" if "webm" in (video.content_type or "") else ".mp4")
    if ext not in ALLOWED_EXT:
        return error(415, f"Unsupported file type {ext}. Upload an MP4, MOV or WebM video.")
    clip_id, path = dataset.create(filename, ext, "upload", meta)
    size = 0
    with path.open("wb") as out:
        while chunk := await video.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                dataset.delete(clip_id)
                return error(413, too_large_message())
            out.write(chunk)
    try:
        check_frame_rate(await run_in_threadpool(probe_video, path))
    except MediaError as exc:
        dataset.delete(clip_id)
        return error(422, str(exc))
    labeler = str(form.get("labeler") or "").strip()[:80]
    if labeler:
        data = dataset.read_labels(clip_id)
        data["labeler"] = labeler
        dataset._write_json(dataset.clip_dir(clip_id) / "labels.json", labels.validate(data))
    background.add_task(dataset.process, clip_id)
    return {"clip_id": clip_id}


@app.post("/api/dataset/from-job/{job_id}", status_code=202)
def dataset_from_job(job_id: str, background: BackgroundTasks):
    try:
        clip_id = dataset.add_from_job(job_id)
    except KeyError:
        return error(404, "Job not found.")
    except ValueError as exc:
        return error(409, str(exc))
    if dataset.read_status(clip_id).get("state") != "ready":
        background.add_task(dataset.process, clip_id)
    return {"clip_id": clip_id, "label_url": f"/label#clip={clip_id}"}


@app.get("/api/dataset/{clip_id}")
def dataset_detail(clip_id: str):
    return _clip_or_404(clip_id) or dataset.detail(clip_id)


@app.put("/api/dataset/{clip_id}/labels")
async def dataset_save(clip_id: str, request: Request):
    if (missing := _clip_or_404(clip_id)) is not None:
        return missing
    try:
        body = await request.json()
    except ValueError:
        return error(400, "Send the labels as JSON.")
    try:
        return {"labels": dataset.save_labels(clip_id, body)}
    except labels.LabelError as exc:
        return error(422, str(exc))


@app.post("/api/dataset/{clip_id}/reanalyze", status_code=202)
def dataset_reanalyze(clip_id: str, background: BackgroundTasks):
    if (missing := _clip_or_404(clip_id)) is not None:
        return missing
    if dataset.read_status(clip_id).get("state") in ("queued", "processing"):
        return error(409, "This clip is still being processed.")
    dataset.set_status(clip_id, state="queued", stage="queued", progress=0.0, error=None)
    background.add_task(dataset.process, clip_id, True)
    return {"clip_id": clip_id}


@app.get("/api/dataset/{clip_id}/video")
def dataset_video(clip_id: str):
    if (missing := _clip_or_404(clip_id)) is not None:
        return missing
    path = dataset.video_file(clip_id)
    return FileResponse(path) if path.exists() else error(404, "Video not found.")


@app.get("/api/dataset/{clip_id}/waveform")
def dataset_waveform(clip_id: str):
    if (missing := _clip_or_404(clip_id)) is not None:
        return missing
    wf = dataset.waveform(clip_id)
    return wf if wf is not None else error(409, "The waveform is not ready yet.")


@app.middleware("http")
async def reject_oversized(request: Request, call_next):
    """Refuse an oversized upload from its Content-Length before reading the body."""
    length = request.headers.get("content-length", "")
    if (request.url.path in ("/api/analyze", "/api/dataset") and request.method == "POST"
            and length.isdigit() and int(length) > MAX_UPLOAD_BYTES + 1024 * 1024):
        return error(413, too_large_message())
    if (request.method == "PUT" and request.url.path.startswith("/api/uploads/")
            and length.isdigit() and int(length) > MAX_PIECE_BYTES):
        return error(413, "Upload piece too large.")
    response = await call_next(request)
    path = request.url.path
    if path in ("/", "/label") or path.startswith("/static/"):
        # Revalidate every time (ETag makes it cheap), so a proxy or CDN in front of the
        # tunnel never keeps serving an old copy of the front end after a code change.
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/config")
def client_config():
    return {"max_upload_mb": config.MAX_UPLOAD_MB, "access_gate": bool(config.ACCESS_TOKEN),
            "min_fps": min_fps(), "full_accuracy_fps": LOW_FPS_BELOW,
            "slow_motion_fps": SLOW_MOTION_FPS, "piece_bytes": PIECE_BYTES,
            "clip_share": str(config.CLIP_SHARE) if config.CLIP_SHARE else ""}


@app.get("/healthz")
def healthz():
    return {"ok": True}


from fastapi.responses import HTMLResponse

def html_with_cache_buster(path: Path) -> HTMLResponse:
    content = path.read_text("utf-8")
    def replacer(m):
        filename = m.group(1)
        filepath = STATIC_DIR / filename
        if filepath.exists():
            t = int(filepath.stat().st_mtime)
            return f'/static/{filename}?t={t}'
        return m.group(0)
    
    content = re.sub(r'/static/([a-zA-Z0-9_\-\.]+\.(?:js|css))(?:\?v=[0-9]+)?', replacer, content)
    return HTMLResponse(content)

@app.get("/")
def index():
    return html_with_cache_buster(STATIC_DIR / "index.html")

@app.get("/label")
def label_page():
    return html_with_cache_buster(STATIC_DIR / "label.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Added last so it is the outermost layer: nothing runs before the key is checked.
if config.ACCESS_TOKEN:
    app.add_middleware(AccessGate, token=config.ACCESS_TOKEN)
