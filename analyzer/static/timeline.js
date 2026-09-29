export class DiagnosticTimeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.report = null;
    this.currentTime = 0;
    this.onSeek = null;

    this.canvas.addEventListener("click", (e) => {
      if (!this.report || !this.report.audio?.waveform) return;
      const rect = this.canvas.getBoundingClientRect();
      const dur = this.report.audio.waveform.duration_s || 1;
      const t = Math.max(0, Math.min(dur, ((e.clientX - rect.left) / rect.width) * dur));
      if (this.onSeek) {
        this.onSeek(t);
      }
    });
  }

  setReport(report) {
    this.report = report;
    this.render();
  }

  updatePlayhead(currentTime) {
    this.currentTime = currentTime;
    this.render();
  }

  _sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 96;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  render() {
    if (!this.report || !this.report.audio?.waveform) return;
    const { w, h } = this._sizeCanvas();
    const ctx = this.ctx;
    const peaks = this.report.audio.waveform.peaks;
    const dur = this.report.audio.waveform.duration_s || 1;

    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, w, h);

    // Grid
    const grid = this.report.audio.grid;
    if (grid?.step_ms && grid.t0 != null) {
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      const step = grid.step_ms / 1000;
      for (let t = grid.t0; t < dur; t += step) {
        const x = (t / dur) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    // Waveform
    ctx.fillStyle = "#8a8374";
    const mid = h * 0.42;
    for (let i = 0; i < peaks.length; i++) {
      const x = (i / peaks.length) * w;
      const amp = Math.max(1, peaks[i] * (h * 0.32));
      ctx.fillRect(x, mid - amp, Math.max(1, w / peaks.length), amp * 2);
    }

    // Event Markers for strikes
    const strokes = this.report.strokes || [];
    for (const s of strokes) {
      const x = (s.t / dur) * w;
      let color = "#999";
      if (s.timing_error_ms != null) {
        const err = Math.abs(s.timing_error_ms);
        if (err < 10) color = "#1f9d55"; // Green for perfect
        else if (err < 25) color = "#d69e00"; // Orange for mechanical breakdown
        else color = "#d64545"; // Red for rushed beat (large timing error)
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, h - 14, s.verification === "verified" ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Video-only strikes
    if (this.report.verification?.video_only) {
      ctx.fillStyle = "#5a2b8a";
      for (const vo of this.report.verification.video_only) {
        const x = (vo.t / dur) * w;
        ctx.beginPath();
        ctx.arc(x, h - 14, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Scrubber Playhead
    if (Number.isFinite(this.currentTime)) {
      const x = (this.currentTime / dur) * w;
      ctx.strokeStyle = "#f5c518";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  }
}
