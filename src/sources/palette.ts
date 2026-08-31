// Dominant-color extraction. Every few seconds the current frame is
// downsampled to a small canvas and clustered (k-means, few iterations, seeded
// from the previous palette so colors glide instead of jumping).
//
// Shadows and greys are the majority of most film frames and they used to win
// the clustering - the palette drifted to murk. Now pixels are FILTERED before
// clustering: only reasonably saturated, reasonably lit pixels vote, unless
// almost nothing passes (a genuinely dark scene keeps a palette). The result
// leans toward the colors that make a frame interesting - the red coat, not
// the wall behind it.

import * as THREE from 'three';

const W = 64;
const H = 36;
const ITERATIONS = 8;

type SourceEl = HTMLVideoElement | HTMLImageElement;

export class PaletteExtractor {
  readonly colors: THREE.Vector3[];
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private centers: number[][];
  private accum: number;
  private interval: number;

  constructor(size: number, intervalSeconds: number) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.interval = intervalSeconds;
    this.accum = intervalSeconds; // extract on the first ready frame
    // Start from a warm spread so the first frames are not black.
    this.centers = Array.from({ length: size }, (_, i) => {
      const t = i / size;
      return [0.5 + 0.4 * Math.sin(t * 6.3), 0.2 + 0.3 * t, 0.2 + 0.2 * (1 - t)];
    });
    this.colors = this.centers.map((c) => new THREE.Vector3(c[0], c[1], c[2]));
  }

  /** Force an extraction on the next ready frame (e.g. after a source switch). */
  invalidate() {
    this.accum = this.interval;
  }

  /** Call every frame; extraction only runs when the interval elapses. */
  update(el: SourceEl | null, dt: number) {
    this.accum += dt;
    if (this.accum < this.interval || !el) return;
    if (el instanceof HTMLVideoElement) {
      if (el.readyState < 2 || el.videoWidth === 0) return;
    } else if (!el.complete || el.naturalWidth === 0) {
      return;
    }
    this.accum = 0;
    this.extract(el);
  }

  private extract(el: SourceEl) {
    this.ctx.drawImage(el, 0, 0, W, H);
    let data: Uint8ClampedArray;
    try {
      data = this.ctx.getImageData(0, 0, W, H).data;
    } catch {
      return; // tainted canvas (cross-origin source): keep the previous palette
    }

    const all: number[][] = [];
    const vivid: number[][] = [];
    for (let i = 0; i < data.length; i += 4) {
      const p = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      all.push(p);
      const mx = Math.max(p[0], p[1], p[2]);
      const sat = mx - Math.min(p[0], p[1], p[2]);
      if (sat > 0.14 && mx > 0.12) vivid.push(p);
    }
    // Vivid pixels vote when there are enough of them to mean something.
    const px = vivid.length > all.length * 0.04 ? vivid : all;

    const k = this.centers.length;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
      for (const p of px) {
        let best = 0;
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const ce = this.centers[c];
          const d =
            (p[0] - ce[0]) ** 2 + (p[1] - ce[1]) ** 2 + (p[2] - ce[2]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        const s = sums[best];
        s[0] += p[0];
        s[1] += p[1];
        s[2] += p[2];
        s[3]++;
      }
      for (let c = 0; c < k; c++) {
        const s = sums[c];
        if (s[3] > 0) {
          this.centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
        } else {
          // Dead cluster: reseed on a random pixel so it can find a color.
          this.centers[c] = [...px[(Math.random() * px.length) | 0]];
        }
      }
    }

    // Most saturated first, so palette index 0 is the "voice" color (in the
    // Almodovar clip, the red). A mild saturation push on the way out: k-means
    // averages wash colors toward the middle, this pulls them back.
    const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
    const order = this.centers
      .map((c, i) => ({ c, i, s: sat(c) * (0.3 + Math.max(...c)) }))
      .sort((a, b) => b.s - a.s);
    order.forEach((o, i) => {
      const l = (o.c[0] + o.c[1] + o.c[2]) / 3;
      const boost = o.c.map((ch) => Math.min(1, Math.max(0, l + (ch - l) * 1.35)));
      this.colors[i].set(boost[0], boost[1], boost[2]);
    });
  }
}
