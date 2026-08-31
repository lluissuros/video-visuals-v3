// Web MIDI -> macros. Simple CC learn: the panel arms a macro, the next CC
// that moves becomes its controller. Mappings persist in localStorage.

import type { Macros } from '../types';
import { MACRO_NAMES } from '../types';

const STORE_KEY = 'vv3-midi-map';

export class MidiControl {
  private map: Partial<Record<number, keyof Macros>> = {};
  private learning: keyof Macros | null = null;
  available = false;
  onChange: ((name: keyof Macros, value: number) => void) | null = null;
  onLearned: ((name: keyof Macros, cc: number) => void) | null = null;

  async start() {
    if (!navigator.requestMIDIAccess) return;
    try {
      const access = await navigator.requestMIDIAccess();
      const attach = () => {
        access.inputs.forEach((input) => {
          input.onmidimessage = (ev) => this.handle(ev);
        });
      };
      attach();
      access.onstatechange = attach;
      this.available = true;
      this.load();
    } catch {
      this.available = false;
    }
  }

  learn(name: keyof Macros) {
    this.learning = name;
  }

  private handle(ev: MIDIMessageEvent) {
    const data = ev.data;
    if (!data || data.length < 3) return;
    const [status, cc, value] = data;
    if ((status & 0xf0) !== 0xb0) return; // CC messages only
    if (this.learning) {
      // One CC drives one macro: drop any previous claim on this CC.
      this.map[cc] = this.learning;
      this.onLearned?.(this.learning, cc);
      this.learning = null;
      this.save();
    }
    const target = this.map[cc];
    if (target) this.onChange?.(target, value / 127);
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.map));
    } catch { /* storage may be unavailable; mapping just won't persist */ }
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [cc, name] of Object.entries(parsed)) {
        if ((MACRO_NAMES as string[]).includes(name)) {
          this.map[Number(cc)] = name as keyof Macros;
        }
      }
    } catch { /* corrupt store: start unmapped */ }
  }
}
