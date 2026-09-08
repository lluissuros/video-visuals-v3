// Central control bus. Sources (audio, granulizer, simulator, MIDI, UI) write
// into it; the engine reads one ControlFrame per render. The bus also runs the
// preset sequencer: a change of turn (or the clock) asks the panel for the next
// saved preset, instantly - the feedback buffer carries the continuity. `hold`
// freezes the sequencer so a look can be studied.

import type { AudioSignals, CamParams, ControlFrame, GenOverrides, Look, Macros, WaveState } from '../types';
import { DEFAULT_CAM, DEFAULT_GEN, DEFAULT_LOOK, MACRO_NAMES } from '../types';
import { config } from '../config';

const defaultMacros: Macros = {
  flow: 0.45,
  feed: 0.72,
  wash: 0.3,
  blur: 0.3,
  palette: 0.4,
  sat: 0.4,
  pulse: 0.5,
  grain: 0.2,
};

export class ControlBus {
  macros: Macros = { ...defaultMacros };
  /** Slow autonomous drift per macro, so the piece moves by itself. */
  private lfoPhase: number[] = MACRO_NAMES.map(() => Math.random() * Math.PI * 2);
  private lfoRate: number[] = MACRO_NAMES.map(() => 0.008 + Math.random() * 0.02);
  lfoDepth = 0.12;

  audio: AudioSignals = { energy: 0, low: 0, mid: 0, high: 0, onset: 0 };
  wave: WaveState = { waves: [], turnIndex: -1, turnProb: 0, live: false };

  /** True: the sequencer is frozen, only manual changes switch presets. */
  hold = false;

  /** Generative-layer overrides, written by the panel, saved in presets. */
  gen: GenOverrides = { ...DEFAULT_GEN };

  /** Performer-camera parameters, written by the panel, saved in presets. */
  cam: CamParams = { ...DEFAULT_CAM };

  /** Character block (flow field, inject, kaleido, base shader), from the preset. */
  look: Look = { ...DEFAULT_LOOK };

  /** Saved presets are the scenes: the panel keeps this count current. */
  presetCount = 0;
  private preset = 0;
  private clockAccum = 0;
  private time = 0;
  private lastTurnIndex = -1;

  /** The panel applies preset `index` (bus state + source) when this fires. */
  onPreset: ((index: number) => void) | null = null;

  setMacro(name: keyof Macros, value: number) {
    this.macros[name] = Math.min(1, Math.max(0, value));
  }

  /** Called by the structure source (granulizer client or simulator). */
  setWave(w: WaveState) {
    this.wave = w;
    if (w.live && w.turnIndex >= 0 && w.turnIndex !== this.lastTurnIndex) {
      this.lastTurnIndex = w.turnIndex;
      if (!this.hold && this.presetCount > 0 && w.turnIndex % this.presetCount !== this.preset) {
        this.setPreset(w.turnIndex);
      }
    }
  }

  setAudio(a: AudioSignals) {
    this.audio = a;
  }

  /** Switch to a saved preset (wraps). Always obeyed, hold or not. */
  setPreset(index: number) {
    const n = this.presetCount;
    if (n === 0) return;
    this.preset = ((index % n) + n) % n;
    this.clockAccum = 0;
    this.onPreset?.(this.preset);
  }

  currentPreset(): number {
    return this.preset;
  }

  frame(dt: number): ControlFrame {
    this.time += dt;

    // Autonomous drift: a slow sine per macro around the slider's value.
    // `pulse` is exempt: it is a depth, and 0 must mean no audio at all.
    const drifted = { ...this.macros };
    MACRO_NAMES.forEach((name, i) => {
      if (name === 'pulse') return;
      this.lfoPhase[i] += this.lfoRate[i] * dt * Math.PI * 2;
      const wobble = Math.sin(this.lfoPhase[i]) * this.lfoDepth;
      drifted[name] = Math.min(1, Math.max(0, this.macros[name] + wobble));
    });

    // Clock mode: no structure source, advance presets on a timer.
    if (!this.wave.live && !this.hold) {
      this.clockAccum += dt;
      if (this.clockAccum >= config.clockSceneSeconds) {
        this.clockAccum = 0;
        this.setPreset(this.preset + 1);
      }
    }

    return {
      time: this.time,
      dt,
      macros: drifted,
      audio: this.audio,
      wave: this.wave,
      look: this.look,
      gen: this.gen,
      cam: this.cam,
    };
  }
}
