// Performance overlay. Source selector + playback controls, the macro sliders,
// generative-layer controls, presets, scene hold, camera toggle, status lights
// and a live wave meter. Hidden with `h`; `i` opens the instructions. The
// projector never needs to see any of it.

import type { CamParams, Macros } from '../types';
import { DEFAULT_CAM, MACRO_NAMES, GEN_TYPE_NAMES } from '../types';
import { SCENES } from '../scenes/scenes';
import type { ControlBus } from '../control/bus';
import type { MidiControl } from '../control/midi';
import type { MediaManager } from '../sources/media';
import { PresetStore, type Preset } from '../control/presets';

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
  ['l', 'loopea el vídeo desde este momento (otra vez: suelta)'],
  ['m', 'vista de la máscara de cámara (esquina inferior derecha)'],
  ['arrastra', 'suelta un vídeo o imagen del Finder sobre la ventana para usarlo'],
];

const MACRO_HELP: Record<keyof Macros, string> = {
  flow: 'cuánto arrastra el campo de flujo la imagen',
  feed: 'persistencia de las estelas (arriba = nunca se borra)',
  wash: 'zoom lento hacia dentro, respiración',
  blur: 'difusión, ahora con mucho más recorrido',
  palette: 'cuánto se pegan los colores a la paleta extraída del vídeo',
  sat: 'saturación (0.29 = neutral, arriba = violenta)',
  pulse: 'cuánto manda el audio en todo lo demás',
  grain: 'grano de película',
};

type GenKey = 'speed' | 'zoom' | 'opacity' | 'video';
const GEN_SLIDERS: [GenKey, string][] = [
  ['speed', 'velocidad del shader (0.5 = 1x)'],
  ['zoom', 'zoom del shader (0.5 = 1x)'],
  ['opacity', 'presencia del shader (0.5 = la de la escena)'],
  ['video', 'cuánto colorea y dibuja el vídeo dentro del shader (necesita opacity > 0)'],
];

type CamKey = keyof CamParams;
const CAM_SLIDERS: [CamKey, string, string][] = [
  ['silOpacity', 'silueta', 'presencia de la silueta (0 = invisible)'],
  ['silTint', 'tinte', 'cuerpo oscuro (0) o lleno del color del aura (1)'],
  ['aura', 'aura', 'fuerza de la emanación'],
  ['auraSize', 'tamaño', 'alcance del halo alrededor del cuerpo'],
  ['auraSpeed', 'emanar', 'velocidad de las ondas de color que salen del cuerpo'],
];

export class Panel {
  private root: HTMLDivElement;
  private instructions!: HTMLDivElement;
  private waveCanvas: HTMLCanvasElement;
  private statusEl: HTMLDivElement;
  private sceneEl: HTMLDivElement;
  private holdBtn: HTMLButtonElement;
  private cameraBtn: HTMLButtonElement;
  private loopBtn: HTMLButtonElement;
  private loopLenLabel: HTMLSpanElement;
  private sourceSel: HTMLSelectElement;
  private speedSlider: HTMLInputElement;
  private speedLabel: HTMLSpanElement;
  private genTypeSel: HTMLSelectElement;
  private genSliders = new Map<GenKey, HTMLInputElement>();
  private camSliders = new Map<CamKey, HTMLInputElement>();
  private presetSel: HTMLSelectElement;
  private sliders = new Map<keyof Macros, HTMLInputElement>();
  private learnBtns = new Map<keyof Macros, HTMLButtonElement>();
  private bus: ControlBus;
  private hooks: PanelHooks;
  private store = new PresetStore();
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
    this.holdBtn = this.button('hold', 'congela el cambio de escena (tecla p)',
      () => this.toggleHold());
    sceneRow.append(this.sceneEl, this.holdBtn);
    this.root.appendChild(sceneRow);

    this.waveCanvas = document.createElement('canvas');
    this.waveCanvas.width = 220;
    this.waveCanvas.height = 36;
    this.waveCanvas.className = 'waves';
    this.root.appendChild(this.waveCanvas);

    // --- source ------------------------------------------------------------
    this.section('fuente');
    this.sourceSel = document.createElement('select');
    this.sourceSel.addEventListener('change', () => {
      const item = hooks.media.items[this.sourceSel.selectedIndex];
      if (item) hooks.media.select(item);
    });
    this.root.appendChild(this.sourceSel);
    this.refreshSources();
    hooks.media.onListChange = () => this.refreshSources();

    const speedRow = this.sliderRow('speed', -4, 1, 0.01, 0, (v) => {
      const rate = Math.pow(2, v);
      hooks.media.setSpeed(rate);
      this.speedLabel.textContent = `${rate.toFixed(2)}x`;
    });
    this.speedSlider = speedRow.input;
    this.speedLabel = speedRow.val;
    this.speedLabel.textContent = '1.00x';

    const lenRow = this.sliderRow('loop len', 0.25, 8, 0.25, 2, (v) => {
      hooks.media.setLoopLength(v);
      this.loopLenLabel.textContent = `${v.toFixed(2)}s`;
    });
    this.loopLenLabel = lenRow.val;
    this.loopLenLabel.textContent = '2.00s';

    const btnRow = document.createElement('div');
    btnRow.className = 'btn-row';
    this.loopBtn = this.button('loop', 'loopea desde este momento (tecla l)',
      () => this.toggleLoop());
    this.cameraBtn = this.button('camera off',
      'enciende la cámara + tracking de performers',
      () => hooks.onToggleCamera());
    btnRow.append(this.loopBtn, this.cameraBtn);
    this.root.appendChild(btnRow);

    // --- camera / silhouette -------------------------------------------------
    this.section('cámara');
    for (const [key, label, help] of CAM_SLIDERS) {
      const row = this.sliderRow(label, 0, 1, 0.001, bus.cam[key], (v) => {
        bus.cam[key] = v;
      });
      row.row.title = help;
      row.val.remove();
      this.camSliders.set(key, row.input);
    }

    // --- generative layer ----------------------------------------------------
    this.section('shader');
    this.genTypeSel = document.createElement('select');
    GEN_TYPE_NAMES.forEach((n, i) => {
      const opt = document.createElement('option');
      opt.textContent = i === 0 ? `${n} (default)` : `${i} ${n}`;
      this.genTypeSel.appendChild(opt);
    });
    this.genTypeSel.title = 'fuerza un shader generativo en cualquier escena';
    this.genTypeSel.addEventListener('change', () => {
      bus.gen.type = this.genTypeSel.selectedIndex;
    });
    this.root.appendChild(this.genTypeSel);

    for (const [key, help] of GEN_SLIDERS) {
      const row = this.sliderRow(key, 0, 1, 0.001, bus.gen[key], (v) => {
        bus.gen[key] = v;
      });
      row.row.title = help;
      row.val.remove();
      this.genSliders.set(key, row.input);
    }

    // --- macros --------------------------------------------------------------
    this.section('macros');
    for (const name of MACRO_NAMES) {
      const row = this.sliderRow(name, 0, 1, 0.001, bus.macros[name], (v) => {
        bus.setMacro(name, v);
      });
      row.row.title = MACRO_HELP[name];
      row.val.remove();
      const learn = this.button('midi', 'click, luego mueve un knob', () => {
        learn.textContent = '...';
        midi.learn(name);
      });
      row.row.appendChild(learn);
      this.sliders.set(name, row.input);
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

    // --- presets --------------------------------------------------------------
    this.section('presets');
    this.presetSel = document.createElement('select');
    this.root.appendChild(this.presetSel);
    this.refreshPresets();
    const pRow = document.createElement('div');
    pRow.className = 'btn-row';
    pRow.append(
      this.button('save', 'guarda el estado actual con nombre', () => this.savePreset()),
      this.button('load', 'carga el preset elegido', () => this.loadPreset()),
      this.button('copy', 'copia el preset elegido como JSON (para compartir)',
        () => this.copyPreset()),
      this.button('paste', 'importa un preset desde JSON', () => this.pastePreset()),
      this.button('del', 'borra el preset elegido', () => this.deletePreset()),
    );
    this.root.appendChild(pRow);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.root.appendChild(this.statusEl);

    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = 'i instrucciones · h panel · f fullscreen';
    this.root.appendChild(help);

    document.body.appendChild(this.root);
    this.buildInstructions();
  }

  // ---------------------------------------------------------------- helpers
  private button(text: string, tip: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.title = tip;
    b.addEventListener('click', onClick);
    return b;
  }

  private section(name: string) {
    const el = document.createElement('div');
    el.className = 'section';
    el.textContent = name;
    this.root.appendChild(el);
  }

  private sliderRow(
    label: string, min: number, max: number, step: number, value: number,
    onInput: (v: number) => void,
  ) {
    const row = document.createElement('label');
    row.className = 'row';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => onInput(Number(input.value)));
    const val = document.createElement('span');
    val.className = 'val';
    row.append(span, input, val);
    this.root.appendChild(row);
    return { row, input, val };
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

  // ---------------------------------------------------------------- presets
  private capturePreset(name: string): Preset {
    const loop = this.hooks.media.loopState;
    return {
      name,
      savedAt: new Date().toISOString(),
      scene: this.bus.currentScene(),
      macros: { ...this.bus.macros },
      gen: { ...this.bus.gen },
      cam: { ...this.bus.cam },
      source: {
        url: this.hooks.media.current?.url ?? '',
        speed: this.hooks.media.speedRate,
        loopStart: loop.start,
        loopLength: loop.length,
      },
    };
  }

  private savePreset() {
    const name = window.prompt('nombre del preset:',
      `${SCENES[this.bus.currentScene()].name}-${this.store.presets.length + 1}`);
    if (!name) return;
    this.store.save(this.capturePreset(name));
    this.refreshPresets(name);
  }

  private loadPreset() {
    const p = this.store.get(this.presetSel.value);
    if (p) this.applyPreset(p);
  }

  private copyPreset() {
    const p = this.store.get(this.presetSel.value);
    if (!p) return;
    navigator.clipboard?.writeText(JSON.stringify(p, null, 1)).catch(() => {});
  }

  private pastePreset() {
    const raw = window.prompt('pega aquí el JSON del preset:');
    if (!raw) return;
    try {
      const names = this.store.importJson(raw);
      this.refreshPresets(names[names.length - 1]);
    } catch {
      window.alert('JSON no válido');
    }
  }

  private deletePreset() {
    this.store.remove(this.presetSel.value);
    this.refreshPresets();
  }

  applyPreset(p: Preset) {
    this.bus.setScene(p.scene);
    this.bus.hold = true;
    this.bus.macros = { ...p.macros };
    this.bus.gen = { ...p.gen };
    this.bus.cam = { ...(p.cam ?? DEFAULT_CAM) };
    // source: only manifest entries survive a reload (drag&drop URLs die)
    const item = this.hooks.media.items.find((i) => i.url === p.source.url);
    if (item && item !== this.hooks.media.current) {
      this.hooks.media.select(item, p.source.loopStart);
    }
    this.hooks.media.setSpeed(p.source.speed);
    this.hooks.media.applyLoop(p.source.loopStart, p.source.loopLength);
    this.syncControls();
  }

  /** Push bus/media state back into every control. */
  syncControls() {
    for (const name of MACRO_NAMES) {
      const el = this.sliders.get(name);
      if (el) el.value = String(this.bus.macros[name]);
    }
    for (const [key, el] of this.genSliders) el.value = String(this.bus.gen[key]);
    for (const [key, el] of this.camSliders) el.value = String(this.bus.cam[key]);
    this.genTypeSel.selectedIndex = this.bus.gen.type;
    this.speedSlider.value = String(Math.log2(this.hooks.media.speedRate));
    this.speedLabel.textContent = `${this.hooks.media.speedRate.toFixed(2)}x`;
    const loop = this.hooks.media.loopState;
    this.loopLenLabel.textContent = `${loop.length.toFixed(2)}s`;
    this.loopBtn.classList.toggle('on', loop.start !== null);
    this.loopBtn.textContent = loop.start !== null ? 'loop ON' : 'loop';
    this.refreshSources();
  }

  private refreshPresets(selectName?: string) {
    this.presetSel.innerHTML = '';
    for (const p of this.store.presets) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      this.presetSel.appendChild(opt);
    }
    if (selectName) this.presetSel.value = selectName;
  }

  // ---------------------------------------------------------------- toggles
  toggleHold() {
    this.bus.hold = !this.bus.hold;
    this.holdBtn.classList.toggle('on', this.bus.hold);
  }

  toggleLoop() {
    const loop = this.hooks.media.loopState;
    const looping = this.hooks.media.toggleLoop(loop.length);
    this.loopBtn.classList.toggle('on', looping);
    this.loopBtn.textContent = looping ? 'loop ON' : 'loop';
  }

  toggleInstructions() {
    this.instructions.hidden = !this.instructions.hidden;
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
    if (!this.visible) this.instructions.hidden = true;
  }

  private buildInstructions() {
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
    const genRows = GEN_SLIDERS
      .map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`)
      .join('');
    this.instructions.innerHTML = `
      <h2>teclas</h2><table>${keyRows}</table>
      <h2>shader (capa generativa)</h2>
      <p>El desplegable fuerza un shader (túnel, pliegue, kali, columnas, olas,
      órbita) sobre cualquier escena; «escena» usa el de la escena activa.</p>
      <table>${genRows}</table>
      <h2>macros</h2><table>${macroRows}</table>
      <h2>escenas</h2><table>${sceneRows}</table>
      <h2>presets</h2>
      <p>«save» guarda escena + macros + shader + fuente + velocidad + loop con
      nombre. «copy» pone el JSON en el portapapeles para compartirlo; «paste»
      lo importa. Un preset con loop guarda también el trozo de vídeo.</p>
      <p>Las escenas siguen al granulizer cuando está conectado (una canción,
      una escena, en serie). Sin granulizer, avanzan solas por reloj. HOLD las
      congela. Los botones «midi» asignan un knob físico a cada macro.</p>
      <h2>cámara</h2>
      <p>Botón «camera» del panel (pide permiso). La silueta entra en el
      feedback - los efectos fluyen por encima - y del cuerpo salen ondas de
      color hacia fuera, cada una con un matiz nuevo. Sus sliders: «silueta»
      (presencia del cuerpo), «tinte» (cuerpo oscuro o del color del aura),
      «aura» (fuerza), «tamaño» (alcance del halo), «emanar» (velocidad de
      las ondas). «m» muestra la máscara; ?maskinvert=1 en la URL si sale
      invertida.</p>`;
    document.body.appendChild(this.instructions);
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
    'generativo puro: el túnel, teñido por el vídeo',
    'casi quieto, encaje kali inquieto debajo',
  ][i] ?? '';
}
