// Named snapshots of everything that makes a look: scene, macros, generative
// overrides, source + speed + loop region. Stored in localStorage; the copy
// button puts the JSON on the clipboard so a look can be shared or pasted
// back on another machine.
//
// A source added by drag&drop lives on a blob: URL that dies with the tab, so
// a preset can only restore sources that exist in public/media (the manifest).

import type { GenOverrides, Macros } from '../types';

export interface Preset {
  name: string;
  savedAt: string;
  scene: number;
  macros: Macros;
  gen: GenOverrides;
  source: {
    url: string;
    speed: number;
    loopStart: number | null;
    loopLength: number;
  };
}

const STORE_KEY = 'vv3-presets';

export class PresetStore {
  presets: Preset[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) this.presets = JSON.parse(raw);
    } catch { /* corrupt store: start empty */ }
  }

  save(preset: Preset) {
    const i = this.presets.findIndex((p) => p.name === preset.name);
    if (i >= 0) this.presets[i] = preset;
    else this.presets.push(preset);
    this.persist();
  }

  remove(name: string) {
    this.presets = this.presets.filter((p) => p.name !== name);
    this.persist();
  }

  get(name: string): Preset | undefined {
    return this.presets.find((p) => p.name === name);
  }

  /** Import one preset (or an array) from pasted JSON. Returns what landed. */
  importJson(raw: string): string[] {
    const parsed = JSON.parse(raw);
    const list: Preset[] = Array.isArray(parsed) ? parsed : [parsed];
    const names: string[] = [];
    for (const p of list) {
      if (typeof p?.name !== 'string' || typeof p?.scene !== 'number') continue;
      this.save(p);
      names.push(p.name);
    }
    return names;
  }

  private persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.presets));
    } catch { /* storage unavailable: presets just won't survive the tab */ }
  }
}
