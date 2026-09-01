// Central control bus. Sources (audio, granulizer, simulator, MIDI, UI) write
// into it; the engine reads one ControlFrame per render. The bus also runs the
// scene sequencer: a change of turn switches the visual scene, instantly -
// the feedback buffer carries the continuity. `hold` freezes the sequencer so
// a scene can be studied.

import type { AudioSignals, CamParams, ControlFrame, GenOverrides, Macros, WaveState } from '../types';
import { DEFAULT_CAM, MACRO_NAMES } from '../types';
import { SCENES } from '../scenes/scenes';
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

  /** True: the sequencer is frozen, only manual changes switch scenes. */
  hold = false;

  /** Generative-layer overrides, written by the panel, saved in presets. */
  gen: GenOverrides = { type: 0, speed: 0.5, zoom: 0.5, opacity: 0.5, video: 0.35 };

  /** Performer-camera parameters, written by the panel, saved in presets. */
  cam: CamParams = { ...DEFAULT_CAM };

  private scene = 0;
  private lastTurnIndex = -1;
  private clockAccum = 0;
  private time = 0;

  onSceneChange: ((index: number) => void) | null = null;

  setMacro(name: keyof Macros, value: number) {
    this.macros[name] = Math.min(1, Math.max(0, value));
  }

  /** Called by the structure source (granulizer client or simulator). */
  setWave(w: WaveState) {
    this.wave = w;
    if (w.live && w.turnIndex >= 0 && w.turnIndex !== this.lastTurnIndex) {
      this.lastTurnIndex = w.turnIndex;
      if (!this.hold) this.setScene(w.turnIndex % SCENES.length);
    }
  }

  setAudio(a: AudioSignals) {
    this.audio = a;
  }

  /** Manual scene change: always obeyed, hold or not. */
  setScene(index: number) {
    const target = ((index % SCENES.length) + SCENES.length) % SCENES.length;
    if (target === this.scene) return;
    this.scene = target;
    this.clockAccum = 0;
    this.onSceneChange?.(target);
  }

  currentScene(): number {
    return this.scene;
  }

  frame(dt: number): ControlFrame {
    this.time += dt;

    // Autonomous drift: a slow sine per macro around the slider's value.
    const drifted = { ...this.macros };
    MACRO_NAMES.forEach((name, i) => {
      this.lfoPhase[i] += this.lfoRate[i] * dt * Math.PI * 2;
      const wobble = Math.sin(this.lfoPhase[i]) * this.lfoDepth;
      drifted[name] = Math.min(1, Math.max(0, this.macros[name] + wobble));
    });

    // Clock mode: no structure source, advance scenes on a timer.
    if (!this.wave.live && !this.hold) {
      this.clockAccum += dt;
      if (this.clockAccum >= config.clockSceneSeconds) {
        this.clockAccum = 0;
        this.setScene(this.scene + 1);
      }
    }

    return {
      time: this.time,
      dt,
      macros: drifted,
      audio: this.audio,
      wave: this.wave,
      scene: this.scene,
      gen: this.gen,
      cam: this.cam,
    };
  }
}
