// Performance overlay. Source selector + playback controls, the macro sliders,
// scene hold, camera toggle, status lights and a live wave meter. Hidden with
// `h`; `i` opens the instructions. The projector never needs to see any of it.

import type { Macros } from '../types';
import { MACRO_NAMES } from '../types';
import { SCENES } from '../scenes/scenes';
import type { ControlBus } from '../control/bus';
import type { MidiControl } from '../control/midi';
import type { MediaManager } from '../sources/media';

export interface PanelStatus {
  gz: 'off' | 'connecting' | 'live';
  audio: boolean;
  camera: 'off' | 'starting' | 'on' | 'error';
  trackingError: string | null;
  fps: number;
}

export interface PanelHooks {
  media: MediaManager;
  /** Start or stop the performer-tracking camera. */
  onToggleCamera: () => void;
}

const HELP_LINES: [string, string][] = [
  ['h', 'esconde / muestra este panel'],
  ['i', 'estas instrucciones'],
  ['f', 'fullscreen (para el proyector)'],
  ['1-6', 'fuerza una escena'],
  ['espacio', 'siguiente escena'],
  ['p', 'HOLD: congela el secuenciador de escenas para estudiar una'],
  ['l', 'loopea los últimos ~2 s del vídeo (otra vez: suelta)'],
  ['m', 'vista de la máscara de cámara (esquina inferior derecha)'],
  ['arrastra', 'suelta un vídeo o imagen del Finder sobre la ventana para usarlo'],
];

const MACRO_HELP: Record<keyof Macros, string> = {
  flow: 'cuánto arrastra el campo de flujo la imagen',
  feed: 'persistencia de las estelas (arriba = nunca se borra)',
  wash: 'zoom lento hacia dentro, respiración',
  blur: 'difumina los bordes duros y pixelados',
  palette: 'cuánto se pegan los colores a la paleta extraída del vídeo',
  sat: 'saturación (0.29 = neutral, arriba = violenta)',
  pulse: 'cuánto manda el audio en todo lo demás',
  grain: 'grano de película',
};

export class Panel {
  private root: HTMLDivElement;
  private instructions: HTMLDivElement;
  private waveCanvas: HTMLCanvasElement;
  private statusEl: HTMLDivElement;
  private sceneEl: HTMLDivElement;
  private holdBtn: HTMLButtonElement;
  private cameraBtn: HTMLButtonElement;
  private loopBtn: HTMLButtonElement;
  private sourceSel: HTMLSelectElement;
  private speedLabel: HTMLSpanElement;
  private sliders = new Map<keyof Macros, HTMLInputElement>();
  private learnBtns = new Map<keyof Macros, HTMLButtonElement>();
  private bus: ControlBus;
  private hooks: PanelHooks;
  visible = true;

  constructor(bus: ControlBus, midi: MidiControl, hooks: PanelHooks) {
    this.bus = bus;
    this.hooks = hooks;
    this.root = document.createElement('div');
    this.root.id = 'panel';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'video-visuals-v3';
    this.root.appendChild(title);

    // --- scene + hold ------------------------------------------------------
    const sceneRow = document.createElement('div');
    sceneRow.className = 'scene-row';
    this.sceneEl = document.createElement('div');
    this.sceneEl.className = 'scene';
    this.holdBtn = document.createElement('button');
    this.holdBtn.textContent = 'hold';
    this.holdBtn.title = 'congela el cambio de escena (tecla p)';
    this.holdBtn.addEventListener('click', () => this.toggleHold());
    sceneRow.append(this.sceneEl, this.holdBtn);
    this.root.appendChild(sceneRow);

    this.waveCanvas = document.createElement('canvas');
    this.waveCanvas.width = 220;
    this.waveCanvas.height = 36;
    this.waveCanvas.className = 'waves';
    this.root.appendChild(this.waveCanvas);

    // --- source ------------------------------------------------------------
    const srcHead = document.createElement('div');
    srcHead.className = 'section';
    srcHead.textContent = 'fuente';
    this.root.appendChild(srcHead);

    this.sourceSel = document.createElement('select');
    this.sourceSel.addEventListener('change', () => {
      const item = hooks.media.items[this.sourceSel.selectedIndex];
      if (item) hooks.media.select(item);
    });
    this.root.appendChild(this.sourceSel);
    this.refreshSources();
    hooks.media.onListChange = () => this.refreshSources();

    const speedRow = document.createElement('label');
    speedRow.className = 'row';
    const speedName = document.createElement('span');
    speedName.textContent = 'speed';
    const speed = document.createElement('input');
    speed.type = 'range';
    speed.min = '-4';
    speed.max = '1';
    speed.step = '0.01';
    speed.value = '0';
    this.speedLabel = document.createElement('span');
    this.speedLabel.className = 'val';
    this.speedLabel.textContent = '1.00x';
    speed.addEventListener('input', () => {
      const rate = Math.pow(2, Number(speed.value));
      hooks.media.setSpeed(rate);
      this.speedLabel.textContent = `${rate.toFixed(2)}x`;
    });
    speedRow.append(speedName, speed, this.speedLabel);
    this.root.appendChild(speedRow);

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    this.loopBtn = document.createElement('button');
    this.loopBtn.textContent = 'loop 2s';
    this.loopBtn.title = 'loopea los últimos 2 s del vídeo (tecla l)';
    this.loopBtn.addEventListener('click', () => this.toggleLoop());
    this.cameraBtn = document.createElement('button');
    this.cameraBtn.textContent = 'camera off';
    this.cameraBtn.title = 'enciende la cámara + tracking de performers';
    this.cameraBtn.addEventListener('click', () => hooks.onToggleCamera());
    btnRow.append(this.loopBtn, this.cameraBtn);
    this.root.appendChild(btnRow);

    // --- macros --------------------------------------------------------------
    const macroHead = document.createElement('div');
    macroHead.className = 'section';
    macroHead.textContent = 'macros';
    this.root.appendChild(macroHead);

    for (const name of MACRO_NAMES) {
      const row = document.createElement('label');
      row.className = 'row';
      row.title = MACRO_HELP[name];
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
      learn.title = 'click, luego mueve un knob';
      learn.addEventListener('click', () => {
        learn.textContent = '...';
        midi.learn(name);
      });
      row.append(span, input, learn);
      this.root.appendChild(row);
      this.sliders.set(name, input);
      this.learnBtns.set(name, learn);
    }

    midi.onLearned = (learned, cc) => {
      const btn = this.learnBtns.get(learned);
      if (btn) btn.textContent = `cc${cc}`;
    };
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
    help.textContent = 'i instrucciones · h panel · f fullscreen';
    this.root.appendChild(help);

    document.body.appendChild(this.root);

    // --- instructions overlay ------------------------------------------------
    this.instructions = document.createElement('div');
    this.instructions.id = 'instructions';
    this.instructions.hidden = true;
    const keyRows = HELP_LINES
      .map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`)
      .join('');
    const macroRows = MACRO_NAMES
      .map((m) => `<tr><td>${m}</td><td>${MACRO_HELP[m]}</td></tr>`)
      .join('');
    const sceneRows = SCENES
      .map((s, i) => `<tr><td>${i + 1} ${s.name}</td><td>${sceneBlurb(i)}</td></tr>`)
      .join('');
    this.instructions.innerHTML = `
      <h2>teclas</h2><table>${keyRows}</table>
      <h2>macros</h2><table>${macroRows}</table>
      <h2>escenas</h2><table>${sceneRows}</table>
      <p>Las escenas siguen al granulizer cuando está conectado (una canción,
      una escena, en serie). Sin granulizer, avanzan solas por reloj. HOLD las
      congela. Los botones «midi» asignan un knob físico a cada macro.</p>
      <p>Cámara: botón «camera» del panel (pide permiso). La silueta queda
      oscura y el flujo saca luz de sus bordes. «m» muestra la máscara;
      ?maskinvert=1 en la URL si sale invertida.</p>`;
    document.body.appendChild(this.instructions);
  }

  refreshSources() {
    this.sourceSel.innerHTML = '';
    for (const item of this.hooks.media.items) {
      const opt = document.createElement('option');
      opt.textContent = `${item.kind === 'video' ? '▶' : '▣'} ${item.name}`;
      this.sourceSel.appendChild(opt);
    }
    const idx = this.hooks.media.items.findIndex(
      (i) => i === this.hooks.media.current,
    );
    if (idx >= 0) this.sourceSel.selectedIndex = idx;
  }

  toggleHold() {
    this.bus.hold = !this.bus.hold;
    this.holdBtn.classList.toggle('on', this.bus.hold);
  }

  toggleLoop() {
    const looping = this.hooks.media.toggleLoop(2);
    this.loopBtn.classList.toggle('on', looping);
    this.loopBtn.textContent = looping ? 'loop ON' : 'loop 2s';
  }

  toggleInstructions() {
    this.instructions.hidden = !this.instructions.hidden;
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
    if (!this.visible) this.instructions.hidden = true;
  }

  update(status: PanelStatus, waves: number[], sceneIndex: number, live: boolean) {
    this.sceneEl.textContent =
      `escena ${sceneIndex + 1}/${SCENES.length} · ${SCENES[sceneIndex].name}` +
      (this.bus.hold ? ' · HOLD' : live ? ' · granulizer' : ' · reloj');
    this.holdBtn.classList.toggle('on', this.bus.hold);

    this.cameraBtn.textContent = `camera ${status.camera}`;
    this.cameraBtn.classList.toggle('on', status.camera === 'on');

    const parts = [
      `gz ${status.gz}`,
      `audio ${status.audio ? 'on' : 'off'}`,
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

function sceneBlurb(i: number): string {
  return [
    'brasa lenta, cerca de la película',
    'olas laterales, medio abstracto',
    'caleidoscopio girando sobre la película',
    'filamentos fractales trenzados con el vídeo',
    'generativo puro: el túnel de interferencias',
    'casi quieto, lavados de color que respiran',
  ][i] ?? '';
}
