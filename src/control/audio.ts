// External audio analysis. Takes any input the OS offers (mic, line-in, or a
// loopback device like BlackHole when the music plays on another machine's
// mix bus). Produces smoothed band energies and a cheap spectral-flux onset.

import type { AudioSignals } from '../types';

const FFT_SIZE = 1024;

export class AudioAnalyser {
  private analyser: AnalyserNode | null = null;
  private freq = new Uint8Array(FFT_SIZE / 2);
  private prevFreq = new Uint8Array(FFT_SIZE / 2);
  private smoothed: AudioSignals = { energy: 0, low: 0, mid: 0, high: 0, onset: 0 };
  private fluxAvg = 0;
  running = false;
  error: string | null = null;
  /** The input stream, so the recorder can put the music on the video. */
  stream: MediaStream | null = null;

  async start(deviceId?: string) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.stream = stream;
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.smoothingTimeConstant = 0.6;
      src.connect(this.analyser);
      this.running = true;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.running = false;
    }
  }

  static async listInputs(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  /** Call once per render frame. */
  read(dt: number): AudioSignals {
    if (!this.analyser) return this.smoothed;
    this.prevFreq.set(this.freq);
    this.analyser.getByteFrequencyData(this.freq);

    const n = this.freq.length;
    const band = (from: number, to: number) => {
      let sum = 0;
      const a = Math.floor(n * from);
      const b = Math.max(a + 1, Math.floor(n * to));
      for (let i = a; i < b; i++) sum += this.freq[i];
      return sum / ((b - a) * 255);
    };

    // ~0-250 Hz, 250-2k, 2k-10k at 48k sample rate.
    const low = band(0, 0.012);
    const mid = band(0.012, 0.09);
    const high = band(0.09, 0.45);
    const energy = low * 0.5 + mid * 0.35 + high * 0.15;

    // Spectral flux against its own running average -> onset.
    let flux = 0;
    for (let i = 0; i < n; i++) {
      const d = this.freq[i] - this.prevFreq[i];
      if (d > 0) flux += d;
    }
    flux /= n * 255;
    this.fluxAvg += (flux - this.fluxAvg) * 0.05;
    const hit = flux > this.fluxAvg * 2.2 && flux > 0.015;

    // Attack fast, release slow; onset decays on its own.
    const s = this.smoothed;
    const follow = (cur: number, target: number, up: number, down: number) =>
      cur + (target - cur) * (target > cur ? up : down);
    s.low = follow(s.low, low, 0.5, 0.08);
    s.mid = follow(s.mid, mid, 0.5, 0.08);
    s.high = follow(s.high, high, 0.5, 0.08);
    s.energy = follow(s.energy, energy, 0.4, 0.05);
    s.onset = hit ? 1 : Math.max(0, s.onset - dt * 3.5);
    return s;
  }
}
