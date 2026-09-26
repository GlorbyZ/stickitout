# Stick It Out analyzer: portable image for any Docker host or cloud VM.
# Build:  docker build -t sio-analyzer .
# Run:    docker run -p 8800:8800 -e ACCESS_TOKEN=change-me -v sio-data:/data sio-analyzer

# ---- build stage: compile aubio (source only on PyPI) into wheels ----
FROM python:3.11-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY requirements.txt .
# GCC 14 turns aubio 0.4.9's old numpy ufunc signatures into errors; relax that one check.
ENV CFLAGS="-Wno-error=incompatible-pointer-types"
RUN pip install --no-cache-dir "numpy==2.4.6" setuptools wheel \
    && pip wheel --no-cache-dir --no-build-isolation --wheel-dir /wheels aubio==0.4.9

# ---- runtime stage ----
FROM python:3.11-slim
# ffmpeg: audio extraction and frame counting. libgl1/libegl1/libgles2/libglib2.0-0/libgomp1:
# MediaPipe Tasks loads EGL/GLES even when it runs on the CPU.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libgl1 libegl1 libgles2 libglib2.0-0 libgomp1 libsndfile1 curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /wheels /wheels
COPY requirements.txt .
RUN pip install --no-cache-dir /wheels/aubio-*.whl -r requirements.txt && rm -rf /wheels
COPY app ./app
COPY scripts ./scripts
COPY schema ./schema
COPY static ./static
# Bake the MediaPipe models into the image so it starts without downloading them.
RUN python scripts/fetch_models.py

RUN useradd --create-home --uid 10001 analyzer && mkdir -p /data && chown analyzer /data
USER analyzer
ENV PORT=8800 \
    DATA_DIR=/data/jobs \
    MAX_UPLOAD_MB=1024 \
    JOB_TTL_HOURS=72 \
    IMAGEIO_FFMPEG_EXE=/usr/bin/ffmpeg \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8800
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1
# Shell form so $PORT from the host platform (Fly, Render, Railway) is honored.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips="*"
