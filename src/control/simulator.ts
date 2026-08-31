// Fake granulizer for developing without SuperCollider. Reproduces the shape
// of lib/40-rotation.scd: n songs share one cycle, each song's probability is
// a phase-offset bump, the highest bump holds the turn. Numbers differ from
// the real tendency curve; the SHAPE (waves in series) is what matters here.

import type { WaveState } from '../types';

export class Simulator {
  private phase = 0;
  songs = 3;
  /** Full cycle length in seconds (one visit to every song). */
  cycleSeconds = 60;
  state: WaveState = { waves: [], turnIndex: -1, turnProb: 0, live: true };

  tick(dt: number): WaveState {
    this.phase = (this.phase + dt / this.cycleSeconds) % 1;
    const waves: number[] = [];
    let best = 0;
    let bestI = -1;
    for (let i = 0; i < this.songs; i++) {
      const ph = (this.phase + i / this.songs) % 1;
      // Raised-cosine bump narrowed so turns hand over cleanly.
      const p = Math.pow(0.5 + 0.5 * Math.cos(ph * Math.PI * 2), 2.5);
      waves.push(p);
      if (p > best) {
        best = p;
        bestI = i;
      }
    }
    this.state = { waves, turnIndex: bestI, turnProb: best, live: true };
    return this.state;
  }
}
