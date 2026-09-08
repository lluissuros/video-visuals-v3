// Performance overlay. Source selector + playback controls, the macro sliders,
// generative-layer controls, presets (the scenes) + hold, tracking camera + toggle,
// phone-link QR, status lights and a live wave meter. Hidden with `h`; `i`
// opens the instructions. The projector never needs to see any of it.

import type { CamParams, Macros } from '../types';
import {
  AURA_MODE_NAMES, DEFAULT_CAM, DEFAULT_GEN, DEFAULT_LOOK, MACRO_NAMES, GEN_TYPE_NAMES, GEN_TYPE_STARS,
} from '../types';
import type { ControlBus } from '../control/bus';
import type { MidiControl } from '../control/midi';
import type { MediaManager } from '../sources/media';
import type { LiveSources } from '../sources/live';
import QRCode from 'qrcode';
import { PresetStore, type Preset } from '../control/presets';
import type { Recorder } from './recorder';
import type { PerfMeter } from '../debug/perf';
import { posesFromParam, confidenceFromParam } from '../tracking/bodyTracking';

export interface PanelStatus {
  gz: 'off' | 'connecting' | 'live';
  audio: boolean;
  camera: 'off' | 'starting' | 'on' | 'error';
  trackingError: string | null;
  /** People the tracker is following right now. */
  poses: number;
  /** Signaling server for phone cameras reachable / phones connected. */
  phoneLink: boolean;
  phones: number;
  fps: number;
}

export interface PanelHooks {
  media: MediaManager;
  live: LiveSources;
  recorder: Recorder;
  /** Start or stop the performer tracking. */
  onToggleCamera: () => void;
  /** Which live source (laptop / USB / phone) the tracker looks through. */
  onTrackingCamera: (id: string) => void;
  /** Preset (index) to load once the media catalogue exists, and what runs after it. */
  startPreset: number;
  onStartPreset: () => void;
  trackingCamera: () => string;
  /** Frame costs, and the two levers that lower them. */
  perf: PerfMeter;
  fpsCap: () => number;
  onFpsCap: (v: number) => void;
  resScale: () => number;
  onResScale: (v: number) => void;
  bufferSize: () => { w: number; h: number };
}

const HELP_LINES: [string, string][] = [
  ['h', 'esconde / muestra este panel'],
  ['i', 'estas instrucciones'],
  ['f', 'fullscreen (para el proyector)'],
  ['1-9', 'carga el preset N'],
  ['espacio', 'siguiente preset'],
  ['p', 'HOLD (activo al arrancar): los presets solo cambian a mano'],
  ['l', 'loopea el vídeo desde este momento (otra vez: suelta)'],
  ['m', 'vista de la máscara de cámara (esquina inferior derecha)'],
  ['q', 'QR con la dirección que abre el móvil para enviar su cámara'],
  ['r', 'graba la pantalla (otra vez: para y descarga el .mp4)'],
  ['arrastra', 'suelta un vídeo o imagen del Finder sobre la ventana para usarlo'],
];

const MACRO_HELP: Record<keyof Macros, string> = {
  flow: 'cuánto arrastra el campo de flujo la imagen',
  feed: 'persistencia de las estelas (arriba = nunca se borra)',
  wash: 'zoom lento hacia dentro, respiración',
  blur: 'difuminado al FINAL de la cadena, hasta niebla total (el grano va después)',
  palette: 'cuánto se pegan los colores a la paleta extraída del vídeo',
  sat: 'saturación (0.29 = neutral, arriba = violenta)',
  pulse: 'cuánto manda el audio en todo lo demás',
  grain: 'grano de película',
};

type GenKey = 'speed' | 'zoom' | 'opacity' | 'video' | 'chaos' | 'movement' | 'quantity' | 'size';
const GEN_SLIDERS: [GenKey, string][] = [
  ['speed', 'velocidad del shader (0.5 = 1x)'],
  ['zoom', 'zoom del shader (0.5 = 1x)'],
  ['opacity', 'presencia del shader (0.5 = la del preset)'],
  ['video', 'cuánto colorea y dibuja el vídeo dentro del shader (necesita opacity > 0); en estrellas, cuánto vídeo se ve ENTRE los puntos (0 = solo a través de ellos)'],
];
/** Only for the estrellas shader; the rows hide for the rest. */
const STAR_SLIDERS: [GenKey, string][] = [
  ['chaos', 'estrellas: 0 = cuadrícula de puntos, 1 = desorden total en capas'],
  ['movement', 'estrellas: qué parte de las estrellas se mueve (0 = quietas, 1 = todas)'],
  ['quantity', 'estrellas: cuántas'],
  ['size', 'estrellas: tamaño de cada punto'],
];

type CamKey = keyof CamParams;
/** key, label, tooltip, and for the tracker knobs a readout of the real value. */
const CAM_SLIDERS: [CamKey, string, string, ((v: number) => string)?][] = [
  ['silOpacity', 'silueta', 'presencia de la silueta (0 = invisible)'],
  ['silTint', 'tinte', 'cuerpo oscuro (0) o lleno del color del aura (1)'],
  ['silBlur', 'suavizar', 'difumina la máscara: bordes de silueta y aura más suaves'],
  ['aura', 'aura', 'fuerza de la emanación'],
  ['auraSize', 'tamaño', 'alcance del halo alrededor del cuerpo'],
  ['auraSpeed', 'emanar', 'velocidad de las ondas de color que salen del cuerpo'],
  ['auraHue', 'color', 'velocidad del cambio de color del aura y del tinte (0 = fijo)'],
  ['motion', 'moverse', 'cuánto crece el aura cuando los performers se mueven (0 = ignora el movimiento; 0.5 = normal, 1 = exagerado)'],
  ['auraDelay', 'retraso', 'las 8 sombras del aura se retrasan cada una a su ritmo, hasta este máximo (0 = todas con el cuerpo)',
    (v) => `${(v * 10).toFixed(1)}s`],
  ['auraMirror', 'espejo', 'cuántas de las 8 sombras van al otro lado de la pantalla (espejo horizontal)',
    (v) => `${Math.round(v * 8)}/8`],
  ['auraSpread', 'matices', 'cada sombra con un matiz distinto dentro del aura (0 = todas iguales)'],
  ['auraGlow', 'brillo', 'luz volumétrica que sale del contorno hacia fuera (raymarch saturado)'],
  ['poses', 'personas', 'cuánta gente busca el modelo: de más no encuentra, de menos ignora a alguien',
    (v) => String(posesFromParam(v))],
  ['confidence', 'confianza', 'qué seguro tiene que estar de que es un cuerpo; súbela si la cámara ve la proyección e inventa performers',
    (v) => confidenceFromParam(v).toFixed(2)],
];

export class Panel {
  private root: HTMLDivElement;
  private instructions!: HTMLDivElement;
  private qr!: HTMLDivElement;
  private waveCanvas: HTMLCanvasElement;
  private statusEl: HTMLDivElement;
  private modeEl: HTMLDivElement;
  private holdBtn: HTMLButtonElement;
  private recBtn: HTMLButtonElement;
  private cameraBtn: HTMLButtonElement;
  private loopBtn: HTMLButtonElement;
  private loopLenLabel: HTMLSpanElement;
  private sourceSel: HTMLSelectElement;
  private trackSel: HTMLSelectElement;
  private speedSlider: HTMLInputElement;
  private speedLabel: HTMLSpanElement;
  private genTypeSel: HTMLSelectElement;
  private genSliders = new Map<GenKey, HTMLInputElement>();
  private starRows: HTMLElement[] = [];
  private camSliders = new Map<CamKey, HTMLInputElement>();
  private auraModeSel: HTMLSelectElement;
  private presetSel: HTMLSelectElement;
  private perfEl: HTMLDivElement;
  private sliders = new Map<keyof Macros, HTMLInputElement>();
  private pads: { x: keyof Macros; y: keyof Macros; dot: HTMLDivElement }[] = [];
  private learnBtns = new Map<keyof Macros, HTMLButtonElement>();
  private bus: ControlBus;
  private hooks: PanelHooks;
  private store = new PresetStore();
  /** Where new rows land: the panel itself, or the open fold. */
  private body: HTMLElement;
  visible = true;

  constructor(bus: ControlBus, midi: MidiControl, hooks: PanelHooks) {
    this.bus = bus;
    this.hooks = hooks;
    this.root = document.createElement('div');
    this.root.id = 'panel';
    this.body = this.root;

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'video-visuals-v3';
    this.root.appendChild(title);

    // --- presets (the scenes) + hold ---------------------------------------
    const presetRow = document.createElement('div');
    presetRow.className = 'top-row';
    this.presetSel = document.createElement('select');
    this.presetSel.title = 'presets guardados, las escenas: elegir uno lo carga (teclas 1-9, espacio)';
    this.presetSel.addEventListener('change', () => bus.setPreset(this.presetSel.selectedIndex));
    presetRow.append(
      this.presetSel,
      this.button('save', 'guarda el estado actual con nombre nuevo', () => this.savePreset()),
      this.button('update', 'sobrescribe el preset elegido con el estado actual',
        () => this.updatePreset()),
    );
    this.root.appendChild(presetRow);
    bus.onPreset = (i) => {
      const p = this.store.presets[i];
      if (!p) return;
      this.applyPreset(p);
      this.presetSel.selectedIndex = i;
    };
    this.refreshPresets();

    const modeRow = document.createElement('div');
    modeRow.className = 'top-row';
    this.modeEl = document.createElement('div');
    this.modeEl.className = 'mode';
    this.holdBtn = this.button('hold', 'congela el cambio de preset (tecla p)',
      () => this.toggleHold());
    this.recBtn = this.button('rec', 'graba lo que se ve en pantalla (tecla r); otra vez: para y descarga',
      () => hooks.recorder.toggle());
    modeRow.append(this.modeEl, this.holdBtn, this.recBtn);
    this.root.appendChild(modeRow);

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
    this.body.appendChild(this.sourceSel);
    // The manifest lands after the panel is built; that first list change is
    // also the moment the starting preset can find its source.
    let started = false;
    hooks.media.onListChange = () => {
      this.refreshSources();
      if (started) return;
      started = true;
      if (this.store.presets.length > 0) {
        bus.setPreset(hooks.startPreset);
        hooks.onStartPreset();
        this.syncBusControls();
      }
    };

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
    btnRow.append(this.loopBtn);
    this.body.appendChild(btnRow);

    // --- camera / silhouette -------------------------------------------------
    this.section('cámara');
    this.trackSel = document.createElement('select');
    this.trackSel.title = 'qué cámara mira el tracking de performers';
    this.trackSel.addEventListener('change', () => {
      hooks.onTrackingCamera(this.trackSel.value);
    });
    this.body.appendChild(this.trackSel);
    const camRow = document.createElement('div');
    camRow.className = 'btn-row';
    this.cameraBtn = this.button('camera off',
      'enciende el tracking de performers con la cámara elegida',
      () => hooks.onToggleCamera());
    camRow.append(
      this.cameraBtn,
      this.button('móvil', 'QR para que un móvil envíe su cámara (tecla q)',
        () => this.toggleQr()),
    );
    this.body.appendChild(camRow);
    this.refreshSources();
    hooks.live.onChange(() => { this.refreshSources(); if (!this.qr.hidden) this.renderQr(); });

    this.auraModeSel = document.createElement('select');
    AURA_MODE_NAMES.forEach((n) => {
      const opt = document.createElement('option');
      opt.textContent = `aura ${n}`;
      this.auraModeSel.appendChild(opt);
    });
    this.auraModeSel.title = 'colores del aura: arcoíris alrededor del color principal, o la paleta del vídeo';
    this.auraModeSel.selectedIndex = bus.cam.auraMode;
    this.auraModeSel.addEventListener('change', () => {
      bus.cam.auraMode = this.auraModeSel.selectedIndex;
    });
    this.body.appendChild(this.auraModeSel);
    for (const [key, label, help, format] of CAM_SLIDERS) {
      // `personas` is a count, so it snaps; the rest are continuous.
      const step = key === 'poses' ? 1 / 3 : 0.001;
      let readout: HTMLSpanElement | null = null;
      const row = this.sliderRow(label, 0, 1, step, bus.cam[key], (v) => {
        bus.cam[key] = v;
        if (readout && format) readout.textContent = format(v);
      });
      row.row.title = help;
      // The tracker knobs show what they really mean; the look knobs do not.
      if (format) {
        readout = row.val;
        readout.textContent = format(bus.cam[key]);
      } else {
        row.val.remove();
      }
      this.camSliders.set(key, row.input);
    }

    // --- generative layer ----------------------------------------------------
    this.section('shader');
    this.genTypeSel = document.createElement('select');
    GEN_TYPE_NAMES.forEach((n, i) => {
      const opt = document.createElement('option');
      opt.textContent = i === 0 ? n : `${i} ${n}`;
      this.genTypeSel.appendChild(opt);
    });
    this.genTypeSel.title = 'fuerza un shader generativo sobre cualquier preset';
    this.genTypeSel.addEventListener('change', () => {
      bus.gen.type = this.genTypeSel.selectedIndex;
      this.syncStarRows();
    });
    this.body.appendChild(this.genTypeSel);

    for (const [key, help] of [...GEN_SLIDERS, ...STAR_SLIDERS]) {
      const row = this.sliderRow(key, 0, 1, 0.001, bus.gen[key], (v) => {
        bus.gen[key] = v;
      });
      row.row.title = help;
      row.val.remove();
      this.genSliders.set(key, row.input);
      if (STAR_SLIDERS.some(([k]) => k === key)) this.starRows.push(row.row);
    }
    this.syncStarRows();

    // --- macros --------------------------------------------------------------
    this.section('macros');
    const xyRow = document.createElement('div');
    xyRow.className = 'xy-row';
    // sat 0.29 is neutral (see MACRO_HELP): a line marks it on the pad
    xyRow.append(this.xyPad('palette', 'sat', 0.29), this.xyPad('flow', 'feed'));
    this.body.appendChild(xyRow);
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
    const external = (name: keyof Macros, value: number) => {
      bus.setMacro(name, value);
      const el = this.sliders.get(name);
      if (el) el.value = String(value);
    };
    midi.onChange = external;
    hooks.live.remote.onMacro = (name, value) => {
      if ((MACRO_NAMES as string[]).includes(name)) external(name as keyof Macros, value);
    };

    // --- performance ----------------------------------------------------------
    this.section('rendimiento');
    this.perfEl = document.createElement('div');
    this.perfEl.id = 'perf';
    this.perfEl.innerHTML = '<div class="light"><span class="dot"></span><span class="word"></span></div><div class="nums"></div>';
    this.perfEl.title = 'frame = tiempo entre fotogramas · js = trabajo de CPU en el hilo principal · '
      + 'gpu = tiempo de dibujo · track = modelo de poses. gpu ≈ frame → manda la GPU: baja la '
      + 'resolución. js alto → CPU: menos personas o apaga la cámara. fps 120 → cap 60 lo baja todo a la mitad. '
      + 'El semáforo es el % del tiempo que la GPU (o la CPU) está ocupada dibujando: verde < 45, ámbar < 75, rojo arriba.';
    document.body.appendChild(this.perfEl);   // HUD in the top-right corner, follows the panel (h)
    const fpsSel = this.choice('fps', [[0, 'fps: pantalla (sin límite)'], [60, 'fps: 60'], [30, 'fps: 30']],
      hooks.fpsCap(), (v) => hooks.onFpsCap(v));
    fpsSel.title = 'límite de fotogramas por segundo: en pantallas de 120 Hz, 60 ahorra la mitad';
    const resSel = this.choice('res', [[1, 'res: 1 (completa)'], [0.75, 'res: 0.75'], [0.5, 'res: 0.5'], [0.35, 'res: 0.35']],
      hooks.resScale(), (v) => hooks.onResScale(v));
    resSel.title = 'resolución del buffer de feedback respecto a la pantalla; el desenfoque final disimula 0.5';

    this.body = this.root;
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.root.appendChild(this.statusEl);

    const help = document.createElement('div');
    help.className = 'help';
    help.textContent = 'i instrucciones · h panel · f fullscreen';
    this.root.appendChild(help);

    document.body.appendChild(this.root);
    this.buildInstructions();
    this.buildQr();
  }

  // ---------------------------------------------------------------- helpers
  private button(text: string, tip: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = text;
    b.title = tip;
    b.addEventListener('click', onClick);
    return b;
  }

  /** Select over numeric values; a value not in the list is added as-is. */
  private choice(
    name: string, options: [number, string][], current: number, onChange: (v: number) => void,
  ): HTMLSelectElement {
    const sel = document.createElement('select');
    if (!options.some(([v]) => v === current)) options = [[current, `${name}: ${current}`], ...options];
    for (const [v, label] of options) {
      const opt = document.createElement('option');
      opt.value = String(v);
      opt.textContent = label;
      sel.appendChild(opt);
    }
    sel.value = String(current);
    sel.addEventListener('change', () => onChange(Number(sel.value)));
    this.body.appendChild(sel);
    return sel;
  }

  /** Opens a fold and makes it the target of everything appended after it.
   *  Open/closed is remembered, so a set-up panel comes back the way it was. */
  private section(name: string) {
    const el = document.createElement('details');
    el.className = 'section';
    el.open = localStorage.getItem(`vv3.fold.${name}`) !== '0';
    const head = document.createElement('summary');
    head.textContent = name;
    el.appendChild(head);
    el.addEventListener('toggle', () => {
      localStorage.setItem(`vv3.fold.${name}`, el.open ? '1' : '0');
    });
    this.root.appendChild(el);
    this.body = el;
  }

  private syncStarRows() {
    const show = this.bus.gen.type === GEN_TYPE_STARS;
    for (const row of this.starRows) row.hidden = !show;
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
    this.body.appendChild(row);
    return { row, input, val };
  }

  /** Square pad: drag sets two macros at once (x right, y up). `neutralY`
   *  draws a line at the y value that means "no effect". */
  private xyPad(x: keyof Macros, y: keyof Macros, neutralY?: number): HTMLDivElement {
    const pad = document.createElement('div');
    pad.className = 'xy';
    pad.title = `${x} → · ${y} ↑`;
    if (neutralY !== undefined) {
      const line = document.createElement('div');
      line.className = 'neutral';
      line.style.top = `${(1 - neutralY) * 100}%`;
      line.title = `${y} ${neutralY} = neutral`;
      pad.appendChild(line);
      pad.title += ` · línea = ${y} neutral (${neutralY})`;
    }
    const dot = document.createElement('div');
    dot.className = 'dot';
    const lx = document.createElement('span');
    lx.className = 'lx';
    lx.textContent = x;
    const ly = document.createElement('span');
    ly.className = 'ly';
    ly.textContent = y;
    pad.append(dot, lx, ly);
    const move = (ev: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const vx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const vy = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height));
      this.bus.setMacro(x, vx);
      this.bus.setMacro(y, vy);
      this.sliders.get(x)!.value = String(vx);
      this.sliders.get(y)!.value = String(vy);
    };
    pad.addEventListener('pointerdown', (ev) => {
      pad.setPointerCapture(ev.pointerId);
      move(ev);
    });
    pad.addEventListener('pointermove', (ev) => {
      if (pad.hasPointerCapture(ev.pointerId)) move(ev);
    });
    this.pads.push({ x, y, dot });
    return pad;
  }

  /** Dots follow the bus, whoever moved the macro (slider, MIDI, phone). */
  private syncPads() {
    for (const { x, y, dot } of this.pads) {
      dot.style.left = `${this.bus.macros[x] * 100}%`;
      dot.style.top = `${(1 - this.bus.macros[y]) * 100}%`;
    }
  }

  refreshSources() {
    this.sourceSel.innerHTML = '';
    const items = this.hooks.media.items;
    for (const item of items) {
      const opt = document.createElement('option');
      const icon = item.kind === 'video' ? '▶' : item.kind === 'image' ? '▣' : '●';
      opt.textContent = `${icon} ${item.name}`;
      this.sourceSel.appendChild(opt);
    }
    const idx = items.findIndex((i) => i.url === this.hooks.media.current?.url);
    if (idx >= 0) this.sourceSel.selectedIndex = idx;

    this.trackSel.innerHTML = '';
    const wanted = this.hooks.trackingCamera();
    for (const src of this.hooks.live.list()) {
      const opt = document.createElement('option');
      opt.value = src.id;
      opt.textContent = `${src.kind === 'remote' ? '📱' : '💻'} ${src.name}`;
      this.trackSel.appendChild(opt);
    }
    this.trackSel.value = wanted;
    if (this.trackSel.value !== wanted && this.trackSel.options.length > 0) {
      // The chosen camera is gone (phone left): keep showing it as a placeholder.
      const opt = document.createElement('option');
      opt.value = wanted;
      opt.textContent = `📱 (desconectado)`;
      this.trackSel.appendChild(opt);
      this.trackSel.value = wanted;
    }
  }

  // ---------------------------------------------------------------- presets
  private capturePreset(name: string): Preset {
    const loop = this.hooks.media.loopState;
    return {
      name,
      savedAt: new Date().toISOString(),
      look: { ...this.bus.look },
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

  /** New preset from the current state; it becomes the active one. */
  private savePreset() {
    const name = window.prompt('nombre del preset:', `preset-${this.store.presets.length + 1}`);
    if (!name) return;
    this.store.save(this.capturePreset(name));
    this.refreshPresets(name);
    this.bus.setPreset(this.presetSel.selectedIndex);
  }

  /** The selected preset takes the current state, same name. */
  private updatePreset() {
    const name = this.presetSel.value;
    if (!this.store.get(name)) return;
    this.store.save(this.capturePreset(name));
    this.refreshPresets(name);
  }

  /** Bus state + source from a preset. Called by the bus for keys, dropdown
   *  and sequencer alike. */
  applyPreset(p: Preset) {
    this.bus.look = { ...DEFAULT_LOOK, ...p.look };
    this.bus.macros = { ...p.macros };
    // params added later (star knobs, suavizar, color, aura mode) fall back to defaults
    this.bus.gen = { ...DEFAULT_GEN, ...p.gen };
    this.bus.cam = { ...DEFAULT_CAM, ...(p.cam ?? {}) };
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
    this.syncBusControls();
    this.speedSlider.value = String(Math.log2(this.hooks.media.speedRate));
    this.speedLabel.textContent = `${this.hooks.media.speedRate.toFixed(2)}x`;
    const loop = this.hooks.media.loopState;
    this.loopLenLabel.textContent = `${loop.length.toFixed(2)}s`;
    this.loopBtn.classList.toggle('on', loop.start !== null);
    this.loopBtn.textContent = loop.start !== null ? 'loop ON' : 'loop';
    this.refreshSources();
  }

  /** Sliders and selects follow the bus (after a preset). */
  private syncBusControls() {
    for (const name of MACRO_NAMES) {
      const el = this.sliders.get(name);
      if (el) el.value = String(this.bus.macros[name]);
    }
    for (const [key, el] of this.genSliders) el.value = String(this.bus.gen[key]);
    for (const [key, el] of this.camSliders) {
      el.value = String(this.bus.cam[key]);
      el.dispatchEvent(new Event('input'));   // refreshes the readouts too
    }
    this.auraModeSel.selectedIndex = this.bus.cam.auraMode;
    this.genTypeSel.selectedIndex = this.bus.gen.type;
    this.syncStarRows();
  }

  private refreshPresets(selectName?: string) {
    this.presetSel.innerHTML = '';
    this.store.presets.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = `${i + 1} ${p.name}`;
      this.presetSel.appendChild(opt);
    });
    this.bus.presetCount = this.store.presets.length;
    if (selectName) this.presetSel.value = selectName;
    else this.presetSel.selectedIndex = this.bus.currentPreset();
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

  /** QR + URL a phone opens to send its camera (needs tools/phone-cam running). */
  toggleQr() {
    this.qr.hidden = !this.qr.hidden;
    if (!this.qr.hidden) this.renderQr();
  }

  private renderQr() {
    const urls = this.hooks.live.remote.urls;
    const url = urls.find((u) => /\/\/(192\.168|10\.|172\.)/.test(u)) ?? urls[0];
    const canvas = this.qr.querySelector('canvas')!;
    const text = this.qr.querySelector('p')!;
    if (!url) {
      canvas.hidden = true;
      text.textContent = this.hooks.live.remote.connected
        ? 'sin red: conecta el portátil a un wifi o al hotspot del móvil'
        : 'arranca el servidor: npm run phone (y recarga)';
      return;
    }
    canvas.hidden = false;
    QRCode.toCanvas(canvas, url, { width: 260, margin: 1 }).catch(() => {});
    text.textContent = `${url}  ·  acepta el certificado una vez`;
  }

  private buildQr() {
    this.qr = document.createElement('div');
    this.qr.id = 'qr';
    this.qr.hidden = true;
    this.qr.innerHTML = '<canvas></canvas><p></p>';
    this.qr.addEventListener('click', () => { this.qr.hidden = true; });
    document.body.appendChild(this.qr);
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
    this.perfEl.hidden = !this.visible;
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
    const genRows = [...GEN_SLIDERS, ...STAR_SLIDERS]
      .map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`)
      .join('');
    this.instructions.innerHTML = `
      <h2>teclas</h2><table>${keyRows}</table>
      <h2>shader (capa generativa)</h2>
      <p>El desplegable fuerza un shader (túnel, pliegue, kali, columnas, olas,
      órbita, vidrio, solar, estrellas); «base» deja el que el preset lleva
      de fondo (a menudo ninguno).</p>
      <table>${genRows}</table>
      <h2>macros</h2>
      <p>Los dos cuadrados mueven dos macros a la vez: palette (→) con sat (↑),
      y flow (→) con feed (↑). Los sliders y los puntos se siguen mutuamente.</p>
      <table>${macroRows}</table>
      <h2>presets (las escenas)</h2>
      <p>El desplegable de arriba es la lista de presets: elegir uno lo carga.
      «save» guarda macros + shader + cámara + fuente + velocidad + loop con
      nombre nuevo; «update» sobrescribe el preset elegido con el estado
      actual. Un preset con loop guarda también el trozo de vídeo.</p>
      <p>El programa arranca en el primer preset y con HOLD: los presets solo
      cambian a mano (teclas 1-9, espacio). Sin HOLD siguen al granulizer si
      está conectado (una canción, un preset, en serie) o avanzan solos por
      reloj. ?hold=0 en la URL arranca sin HOLD; ?preset=N arranca en otro.
      Los botones «midi» asignan un knob físico a cada macro.</p>
      <h2>grabar</h2>
      <p>«rec» (o r) graba lo que se ve en pantalla, sin el panel, y con el
      audio de entrada si el análisis de audio está activo. Otra pulsación
      para y descarga un .mp4 (H.264) con fecha y hora; en navegadores que no
      saben escribir mp4 sale un .webm.</p>
      <h2>rendimiento</h2>
      <p>El navegador no puede leer la carga de CPU ni de GPU; mide lo que sí
      ve. El semáforo de arriba a la derecha es el porcentaje del tiempo que
      la GPU (o la CPU) pasa dibujando: verde «fresco» por debajo del 45 %,
      ámbar «caliente» hasta el 75 %, rojo «quemado» por encima. Debajo, los
      detalles: fps, «gpu» (tiempo de dibujo), «js» (CPU del bucle), «track»
      (modelo de poses) y el tamaño del buffer. Si manda gpu baja la «res».
      Si manda js: menos «personas» o cámara apagada. Un
      límite de 60 fps en una pantalla de 120 Hz ahorra la mitad de todo. Los
      dos ajustes se recuerdan en este navegador.</p>
      <h2>cámara</h2>
      <p>El desplegable elige qué cámara mira el tracking (portátil, USB o un
      móvil); «camera» lo enciende (pide permiso). La silueta entra en el
      feedback - los efectos fluyen por encima - y del cuerpo salen ondas de
      color hacia fuera, cada una con un matiz nuevo. Sus sliders: «silueta»
      (presencia del cuerpo), «tinte» (cuerpo oscuro o del color del aura),
      «suavizar» (bordes de la máscara), «aura» (fuerza), «tamaño» (alcance
      del halo), «emanar» (velocidad de las ondas), «color» (velocidad del
      cambio de color), «moverse» (cuánto crece el aura al moverse los
      performers: 0.5 normal, 1 exagerado). El desplegable «aura» elige
      arcoíris o los colores de la paleta del vídeo.</p>
      <p>El halo lo forman 8 sombras de la silueta. «retraso» da a cada sombra
      su propio retardo, hasta 10 s (una sombra siempre va con el cuerpo).
      «espejo» manda algunas al otro lado de la pantalla, invertidas.
      «matices» da a cada sombra un matiz distinto dentro del aura. «brillo»
      añade una luz volumétrica que sale del contorno (raymarch saturado).</p>
      <p>El modelo busca personas, no manchas: una silla o una forma
      proyectada no genera silueta. «personas» dice a cuánta gente sigue (1-4)
      y «confianza» cuánto tiene que creérselo - súbela si la cámara ve la
      proyección e inventa cuerpos. El estado de abajo indica cuántos
      «cuerpos» encuentra. Ambos se guardan en el preset. La cámara se recorta para llenar la pantalla, no se
      estira: mejor en horizontal. «m» muestra la máscara; ?maskinvert=1 en
      la URL si sale invertida.</p>
      <h2>móvil como cámara</h2>
      <p>En el portátil: <code>npm run phone</code>. Pulsa «móvil» (o q) y
      escanea el QR con el móvil (misma red o hotspot del móvil; sin internet).
      Acepta el certificado una vez, pulsa «enviar cámara». El móvil aparece en
      «fuente» (como película) y en el desplegable de cámara (como silueta):
      puedes usarlo para una cosa, la otra o las dos.</p>`;
    document.body.appendChild(this.instructions);
  }

  update(status: PanelStatus, waves: number[], live: boolean) {
    const n = this.bus.presetCount;
    this.modeEl.textContent =
      (n ? `preset ${this.bus.currentPreset() + 1}/${n}` : 'sin presets') +
      (this.bus.hold ? ' · HOLD' : live ? ' · granulizer' : ' · reloj');
    this.holdBtn.classList.toggle('on', this.bus.hold);
    this.syncPads();
    const rec = this.hooks.recorder;
    this.recBtn.classList.toggle('on', rec.recording);
    this.recBtn.textContent = rec.recording ? `● ${formatTime(rec.elapsed)}` : 'rec';
    this.recBtn.title = rec.error ?? 'graba lo que se ve en pantalla (tecla r); otra vez: para y descarga';

    this.cameraBtn.textContent = `camera ${status.camera}`;
    this.cameraBtn.classList.toggle('on', status.camera === 'on');

    const parts = [
      `gz ${status.gz}`,
      `audio ${status.audio ? 'on' : 'off'}`,
      `móvil ${status.phoneLink ? status.phones : 'off'}`,
      `cuerpos ${status.poses}`,
      `${status.fps.toFixed(0)} fps`,
    ];
    if (status.trackingError) parts.push(status.trackingError);
    if (rec.error) parts.push(`rec: ${rec.error}`);
    this.statusEl.textContent = parts.join(' · ');

    const p = this.hooks.perf;
    const buf = this.hooks.bufferSize();
    const ms = (v: number) => Number.isNaN(v) ? 'n/d' : `${v.toFixed(1)}ms`;
    const words = { ok: 'fresco', warm: 'caliente', hot: 'quemado' };
    this.perfEl.className = p.level;
    this.perfEl.querySelector('.word')!.textContent =
      `${words[p.level]} · ${Math.round(p.load * 100)}%`;
    this.perfEl.querySelector('.nums')!.textContent = [
      `${p.fps.toFixed(0)} fps`, `gpu ${ms(p.gpuMs)} · js ${ms(p.jsMs)}`,
      `track ${ms(p.trackMs)}`, `${buf.w}×${buf.h}`,
    ].join('\n');

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

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
