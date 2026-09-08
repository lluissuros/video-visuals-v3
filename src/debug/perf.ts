// Per-frame cost meter. A browser cannot read CPU or GPU load, so this
// measures what the loop can see: the frame interval, main-thread JS time
// per frame, GPU time per frame (WebGL timer query, when Chrome exposes it)
// and tracker inference time. Read alongside each other they say what is
// saturating: gpu ≈ frame → GPU-bound (lower res); js high → CPU (tracker).

export class PerfMeter {
  fps = 60;
  /** rAF interval, ms. */
  frameMs = 16;
  /** Main-thread work inside tick(), ms. */
  jsMs = 0;
  /** GPU time of one render, ms; NaN when the timer extension is missing. */
  gpuMs = NaN;
  /** Pose model inference, ms of main-thread time per camera frame. */
  trackMs = 0;

  private smooth(prev: number, v: number, k = 0.05): number {
    return prev + (v - prev) * k;
  }

  frame(dtMs: number) {
    this.frameMs = this.smooth(this.frameMs, dtMs);
    this.fps = this.smooth(this.fps, 1000 / Math.max(dtMs, 0.1), 0.03);
  }

  /** Busy share of each second, 0..1: draw (or JS) time × frames per second.
   *  Rendering only - video decode and the pose model's own GPU work are not
   *  seen from here, so this reads a little low. */
  get gpuLoad(): number { return Number.isNaN(this.gpuMs) ? 0 : this.gpuMs * this.fps / 1000; }
  get cpuLoad(): number { return this.jsMs * this.fps / 1000; }
  get load(): number { return Math.max(this.gpuLoad, this.cpuLoad); }

  /** Traffic light: green under 45% busy, amber under 75%, red above. */
  get level(): 'ok' | 'warm' | 'hot' {
    const l = this.load;
    return l < 0.45 ? 'ok' : l < 0.75 ? 'warm' : 'hot';
  }

  js(ms: number) { this.jsMs = this.smooth(this.jsMs, ms); }
  gpu(ms: number) { this.gpuMs = Number.isNaN(this.gpuMs) ? ms : this.smooth(this.gpuMs, ms, 0.1); }
  track(ms: number) { this.trackMs = this.smooth(this.trackMs, ms, 0.1); }
}
