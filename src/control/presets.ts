// Named snapshots of everything that makes a look: character block, macros,
// generative overrides, camera params, source + speed + loop region. Stored in
// localStorage under this browser. The presets ARE the scenes: keys 1-9 and
// space move through them, and the sequencer advances them.
//
// A source added by drag&drop lives on a blob: URL that dies with the tab, so
// a preset can only restore sources that exist in public/media (the manifest).

import type { CamParams, GenOverrides, Look, Macros } from '../types';
import { DEFAULT_LOOK } from '../types';

export interface Preset {
  name: string;
  savedAt: string;
  look: Look;
  /** Legacy: index into the old fixed scene table, migrated into `look` on load. */
  scene?: number;
  macros: Macros;
  gen: GenOverrides;
  /** Optional: presets saved before the camera params existed lack it. */
  cam?: CamParams;
  source: {
    url: string;
    speed: number;
    loopStart: number | null;
    loopLength: number;
  };
}

const STORE_KEY = 'vv3-presets';

/** The old fixed scene table (ascua, marea, espejo, cueva, puro, respira,
 *  vidrio, grano), kept only to migrate presets saved with `scene: N`. */
const LEGACY_LOOKS: Partial<Look>[] = [
  {},
  { flowScale: 0.7, flowSpeed: 0.12, swirl: -0.35, inject: 0.06, videoZoom: 1.6, hueShift: 0.25, abstraction: 0.6 },
  { flowScale: 1.3, flowSpeed: 0.08, swirl: 0.3, inject: 0.14, videoZoom: 2.0, hueShift: 0.1, abstraction: 0.3, kaleido: 8, kaleidoSpin: 0.05 },
  { flowScale: 1.4, flowSpeed: 0.1, swirl: 0.15, inject: 0.05, videoZoom: 1.8, hueShift: -0.2, abstraction: 0.7, gen: 2, genMix: 0.5, genWarp: 0.8 },
  { flowScale: 0.9, flowSpeed: 0.05, swirl: 0.05, inject: 0.0, videoZoom: 1.0, hueShift: 0.0, abstraction: 1.0, gen: 1, genMix: 1.0, genWarp: 0.2 },
  { flowScale: 0.4, flowSpeed: 0.03, swirl: 0.0, inject: 0.08, videoZoom: 1.2, hueShift: 0.1, abstraction: 0.7, gen: 3, genMix: 0.15, genWarp: 0.35 },
  { flowScale: 1.0, flowSpeed: 0.07, swirl: 0.1, inject: 0.08, videoZoom: 1.4, hueShift: 0.05, abstraction: 0.5, gen: 7, genMix: 0.7, genWarp: 0.5 },
  { flowScale: 1.8, flowSpeed: 0.12, swirl: -0.1, inject: 0.06, videoZoom: 1.5, hueShift: 0.0, abstraction: 0.6, gen: 8, genMix: 0.8, genWarp: 0.3 },
];

export class PresetStore {
  presets: Preset[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.presets = JSON.parse(raw);
    } catch { /* corrupt store: start empty */ }
    let migrated = false;
    for (const p of this.presets) {
      if (p.look) continue;
      p.look = { ...DEFAULT_LOOK, ...(LEGACY_LOOKS[p.scene ?? 0] ?? {}) };
      delete p.scene;
      migrated = true;
    }
    if (migrated) this.persist();
  }

  save(preset: Preset) {
    const i = this.presets.findIndex((p) => p.name === preset.name);
    if (i >= 0) this.presets[i] = preset;
    else this.presets.push(preset);
    this.persist();
  }

  get(name: string): Preset | undefined {
    return this.presets.find((p) => p.name === name);
  }

  remove(name: string) {
    this.presets = this.presets.filter((p) => p.name !== name);
    this.persist();
  }

  /** Fails (false) when `to` is taken by another preset. */
  rename(from: string, to: string): boolean {
    const p = this.get(from);
    if (!p || (to !== from && this.get(to))) return false;
    p.name = to;
    this.persist();
    return true;
  }

  private persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.presets));
    } catch { /* storage unavailable: presets just won't survive the tab */ }
  }
}
