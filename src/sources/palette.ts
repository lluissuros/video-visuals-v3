// Dominant-color extraction. Every few seconds the current video frame is
// downsampled to a small canvas and clustered (k-means, few iterations, seeded
// from the previous palette so colors glide instead of jumping). The engine
// receives the palette as a uniform and can pull the whole image toward it.

import * as THREE from 'three';

const W = 64;
const H = 36;
const ITERATIONS = 8;

export class PaletteExtractor {
  readonly colors: THREE.Vector3[];
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private centers: number[][];
  private accum = 0;
  private interval: number;

  constructor(size: number, intervalSeconds: number) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.interval = intervalSeconds;
    // Start from a warm spread so the first frames are not black.
    this.centers = Array.from({ length: size }, (_, i) => {
      const t = i / size;
      return [0.5 + 0.4 * Math.sin(t * 6.3), 0.2 + 0.3 * t, 0.2 + 0.2 * (1 - t)];
    });
    this.colors = this.centers.map((c) => new THREE.Vector3(c[0], c[1], c[2]));
  }

  /** Call every frame; extraction only runs when the interval elapses. */
  update(video: HTMLVideoElement, dt: number) {
    this.accum += dt;
    if (this.accum < this.interval) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;
    this.accum = 0;
    this.extract(video);
  }

  private extract(video: HTMLVideoElement) {
    this.ctx.drawImage(video, 0, 0, W, H);
    let data: Uint8ClampedArray;
    try {
      data = this.ctx.getImageData(0, 0, W, H).data;
    } catch {
      return; // tainted canvas (cross-origin source): keep the previous palette
    }

    const px: number[][] = [];
    for (let i = 0; i < data.length; i += 4) {
      px.push([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]);
    }

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
    // Almodovar clip, the red).
    const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
    const order = this.centers
      .map((c, i) => ({ c, i, s: sat(c) * (0.3 + Math.max(...c)) }))
      .sort((a, b) => b.s - a.s);
    order.forEach((o, i) => this.colors[i].set(o.c[0], o.c[1], o.c[2]));
  }
}
