// Central control bus. Sources (audio, granulizer, simulator, MIDI, UI) write
// into it; the engine reads one ControlFrame per render. The bus also runs the
// scene sequencer: a change of turn advances the visual scene with a crossfade.

import type { AudioSignals, ControlFrame, Macros, WaveState } from '../types';
import { MACRO_NAMES } from '../types';
import { SCENES } from '../scenes/scenes';
import { config } from '../config';

const SCENE_FADE_SECONDS = 2.5;

const defaultMacros: Macros = {
  flow: 0.45,
  feed: 0.72,
  wash: 0.35,
  palette: 0.5,
  pulse: 0.5,
  grain: 0.25,
};

export class ControlBus {
  macros: Macros = { ...defaultMacros };
  /** Slow autonomous drift per macro, so the piece moves by itself. */
  private lfoPhase: number[] = MACRO_NAMES.map(() => Math.random() * Math.PI * 2);
  private lfoRate: number[] = MACRO_NAMES.map(() => 0.008 + Math.random() * 0.02);
  lfoDepth = 0.12;

  audio: AudioSignals = { energy: 0, low: 0, mid: 0, high: 0, onset: 0 };
  wave: WaveState = { waves: [], turnIndex: -1, turnProb: 0, live: false };

  private sceneA = 0;
  private sceneB = 0;
  private sceneMix = 0; // 0 = fully A, 1 = fully B
  private fading = false;
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
      this.requestScene(w.turnIndex % SCENES.length);
    }
  }

  setAudio(a: AudioSignals) {
    this.audio = a;
  }

  requestScene(index: number) {
    const target = index % SCENES.length;
    if (target === this.currentScene() && !this.fading) return;
    // Restarting a fade mid-flight: promote whatever is on screen to A.
    if (this.fading && this.sceneMix > 0.5) this.sceneA = this.sceneB;
    this.sceneB = target;
    this.sceneMix = 0;
    this.fading = true;
    this.onSceneChange?.(target);
  }

  currentScene(): number {
    return this.fading && this.sceneMix > 0.5 ? this.sceneB : this.sceneA;
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
    if (!this.wave.live) {
      this.clockAccum += dt;
      if (this.clockAccum >= config.clockSceneSeconds) {
        this.clockAccum = 0;
        this.requestScene((this.currentScene() + 1) % SCENES.length);
      }
    } else {
      this.clockAccum = 0;
    }

    if (this.fading) {
      this.sceneMix += dt / SCENE_FADE_SECONDS;
      if (this.sceneMix >= 1) {
        this.sceneA = this.sceneB;
        this.sceneMix = 0;
        this.fading = false;
      }
    }

    return {
      time: this.time,
      dt,
      macros: drifted,
      audio: this.audio,
      wave: this.wave,
      sceneA: this.sceneA,
      sceneB: this.sceneB,
      sceneMix: this.fading ? this.sceneMix : 0,
    };
  }
}
