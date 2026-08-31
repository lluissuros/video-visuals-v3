// Performance overlay. Six macro sliders, source toggles, status lights, and a
// live wave meter. Hidden with `h` - the projector never needs to see it.
//
// Keys: h panel · f fullscreen · m mask debug · 1-4 force a scene · space next scene

import type { Macros } from '../types';
import { MACRO_NAMES } from '../types';
import { SCENES } from '../scenes/scenes';
import type { ControlBus } from '../control/bus';
import type { MidiControl } from '../control/midi';

export interface PanelStatus {
  gz: 'off' | 'connecting' | 'live';
  audio: boolean;
  camera: boolean;
  trackingError: string | null;
  fps: number;
}

export class Panel {
  private root: HTMLDivElement;
  private waveCanvas: HTMLCanvasElement;
  private statusEl: HTMLDivElement;
  private sceneEl: HTMLDivElement;
  private sliders = new Map<keyof Macros, HTMLInputElement>();
  visible = true;

  constructor(bus: ControlBus, midi: MidiControl) {
    this.root = document.createElement('div');
    this.root.id = 'panel';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'video-visuals-v3';
    this.root.appendChild(title);

    this.sceneEl = document.createElement('div');
    this.sceneEl.className = 'scene';
    this.root.appendChild(this.sceneEl);

    this.waveCanvas = document.createElement('canvas');
    this.waveCanvas.width = 220;
    this.waveCanvas.height = 44;
    this.waveCanvas.className = 'waves';
    this.root.appendChild(this.waveCanvas);

    for (const name of MACRO_NAMES) {
      const row = document.createElement('label');
      row.className = 'row';
      const span = document.createElement('span');
      span.textContent = name;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.001';
      input.value = String(bus.macros[name]);
      input.addEventListener('input', () => bus.setMacro(name, Number(input.value)));
      const learn = document.createElement('button');
      learn.textContent = 'midi';
      learn.title = 'click, then move a knob';
      learn.addEventListener('click', () => {
        learn.textContent = '...';
        midi.learn(name);
      });
      midi.onLearned = (learned, cc) => {
        if (learned === name) learn.textContent = `cc${cc}`;
      };
      row.append(span, input, learn);
      this.root.appendChild(row);
      this.sliders.set(name, input);
    }

    midi.onChange = (name, value) => {
      bus.setMacro(name, value);
      const el = this.sliders.get(name);
      if (el) el.value = String(value);
    };

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.root.appendChild(this.statusEl);

    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = 'h panel · f fullscreen · m mask · 1-4 scene · space next';
    this.root.appendChild(help);

    document.body.appendChild(this.root);
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }

  update(status: PanelStatus, waves: number[], sceneIndex: number, live: boolean) {
    this.sceneEl.textContent =
      `scene ${sceneIndex + 1}/${SCENES.length} · ${SCENES[sceneIndex].name}` +
      (live ? ' · following granulizer' : ' · internal clock');

    const parts = [
      `gz ${status.gz}`,
      `audio ${status.audio ? 'on' : 'off'}`,
      `camera ${status.camera ? 'on' : 'off'}`,
      `${status.fps.toFixed(0)} fps`,
    ];
    if (status.trackingError) parts.push(status.trackingError);
    this.statusEl.textContent = parts.join(' · ');

    const ctx = this.waveCanvas.getContext('2d')!;
    const { width: w, height: h } = this.waveCanvas;
    ctx.clearRect(0, 0, w, h);
    if (waves.length > 0) {
      const bw = w / waves.length;
      waves.forEach((p, i) => {
        ctx.fillStyle = `rgba(255, ${80 + p * 120 | 0}, 80, ${0.35 + p * 0.65})`;
        ctx.fillRect(i * bw + 2, h - p * h, bw - 4, p * h);
      });
    }
  }
}
