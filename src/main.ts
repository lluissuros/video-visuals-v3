// Wiring. Sources feed the ControlBus, the bus produces one ControlFrame per
// RAF tick, the Engine renders it. Nothing here contains behavior - swap any
// piece by changing what writes into the bus.

import { config } from './config';
import { ControlBus } from './control/bus';
import { AudioAnalyser } from './control/audio';
import { GranulizerClient } from './control/granulizer';
import { Simulator } from './control/simulator';
import { MidiControl } from './control/midi';
import { MediaManager } from './sources/media';
import { PaletteExtractor } from './sources/palette';
import { LiveSources, DEFAULT_LOCAL } from './sources/live';
import { BodyTracker, posesFromParam, confidenceFromParam } from './tracking/bodyTracking';
import { Engine } from './engine/renderer';
import { Panel, type PanelStatus } from './ui/panel';
import { Recorder } from './ui/recorder';
import { GEN_TYPE_NAMES, MACRO_NAMES } from './types';
import { snapTick } from './debug/snap';
import { PerfMeter } from './debug/perf';

const canvas = document.getElementById('view') as HTMLCanvasElement;

const bus = new ControlBus();
const palette = new PaletteExtractor(config.paletteSize, config.paletteInterval);
// Performance levers, remembered per browser; ?res= in the URL wins.
const perf = new PerfMeter();
const savedRes = Number(localStorage.getItem('vv3.perf.res'));
const resScale = new URLSearchParams(location.search).has('res') || !(savedRes > 0)
  ? config.resScale : savedRes;
let fpsCap = Number(localStorage.getItem('vv3.perf.fps')) || 0;   // 0 = vsync
const engine = new Engine(canvas, resScale, palette.colors);

// Live cameras (laptop, USB, phones) feed both the film source and the tracker.
const live = new LiveSources(config.phoneHost);
live.start();

const media = new MediaManager(live);
media.onSource = (tex) => {
  engine.setVideoTexture(tex);
  palette.invalidate();
};
media.init(config.videoUrl);

const audio = new AudioAnalyser();
if (config.audioEnabled) audio.start();

const midi = new MidiControl();
midi.start();

// --- structure source -------------------------------------------------------
let gz: GranulizerClient | null = null;
let sim: Simulator | null = null;
if (config.structure === 'gz') {
  gz = new GranulizerClient(config.bridgeHost);
  gz.onUpdate = (w) => bus.setWave(w);
} else if (config.structure === 'sim') {
  sim = new Simulator();
}
// 'clock': no structure source; the bus advances presets on its own timer.

bus.hold = config.hold;
/** ?shader=N and any macro (?blur=0.8&feed=0.9) win over the starting preset. */
function applyUrlOverrides() {
  if (config.shader !== null && Number.isFinite(config.shader)) {
    bus.gen.type = Math.min(GEN_TYPE_NAMES.length - 1, Math.max(0, config.shader));
  }
  const q = new URLSearchParams(location.search);
  for (const name of MACRO_NAMES) {
    const v = q.get(name);
    if (v !== null) bus.setMacro(name, Number(v));
  }
}
applyUrlOverrides();

// --- camera / tracking prototype ---------------------------------------------
const tracker = new BodyTracker(engine.floatLinear);
tracker.onTexture = (tex) => engine.setMaskTexture(tex, tracker.invert);
let cameraState: PanelStatus['camera'] = 'off';
let trackingCamera = DEFAULT_LOCAL;
let maskDebug = false;

async function toggleCamera() {
  if (cameraState === 'on' || cameraState === 'starting') {
    tracker.stop();
    live.release(trackingCamera);
    engine.setMaskTexture(null);
    cameraState = 'off';
    return;
  }
  cameraState = 'starting';
  // Model first, camera second: a missing model file surfaces even when the
  // camera permission is not granted.
  if ((await tracker.start()) && (await live.acquire(trackingCamera))) {
    engine.setMaskTexture(tracker.texture, tracker.invert);
    cameraState = 'on';
  } else {
    cameraState = 'error';
  }
}

/** Point the tracker at another camera, live if it is running. */
async function setTrackingCamera(id: string) {
  if (id === trackingCamera) return;
  const wasOn = cameraState === 'on';
  if (wasOn) live.release(trackingCamera);
  trackingCamera = id;
  if (wasOn && !(await live.acquire(id))) cameraState = 'error';
}
if (config.cameraEnabled) toggleCamera();

const recorder = new Recorder(canvas, () => audio.stream, config.recMbps);

const panel = new Panel(bus, midi, {
  media,
  live,
  recorder,
  onToggleCamera: toggleCamera,
  onTrackingCamera: setTrackingCamera,
  startPreset: config.preset,
  onStartPreset: applyUrlOverrides,
  trackingCamera: () => trackingCamera,
  perf,
  fpsCap: () => fpsCap,
  onFpsCap: (v) => { fpsCap = v; localStorage.setItem('vv3.perf.fps', String(v)); },
  resScale: () => engine.resScaleValue,
  onResScale: (v) => { engine.setResScale(v); localStorage.setItem('vv3.perf.res', String(v)); },
  bufferSize: () => engine.bufferSize,
});

// --- keys --------------------------------------------------------------------
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'h') panel.toggle();
  if (ev.key === 'i') panel.toggleInstructions();
  if (ev.key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
  if (ev.key === 'm') {
    maskDebug = !maskDebug;
    document.getElementById('maskdebug')!.style.display = maskDebug ? '' : 'none';
  }
  if (ev.key === 'q') panel.toggleQr();
  if (ev.key === 'r') recorder.toggle();
  if (ev.key === 'p') panel.toggleHold();
  if (ev.key === 'l') panel.toggleLoop();
  if (ev.key === ' ') bus.setPreset(bus.currentPreset() + 1);
  const n = Number(ev.key);
  if (n >= 1 && n <= bus.presetCount) bus.setPreset(n - 1);
});

// Fullscreen hides the cursor; a mouse move shows it for two seconds so the
// panel stays usable on the projector.
let cursorTimer = 0;
function hideCursor() {
  document.body.classList.toggle('nocursor', !!document.fullscreenElement);
}
document.addEventListener('fullscreenchange', hideCursor);
window.addEventListener('mousemove', () => {
  if (!document.fullscreenElement) return;
  document.body.classList.remove('nocursor');
  clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(hideCursor, 2000);
});

// --- main loop ---------------------------------------------------------------
let last = performance.now();

function tick(now: number) {
  requestAnimationFrame(tick);
  // fps cap: skip this vsync when the last frame is too recent (a 120 Hz
  // screen otherwise doubles every cost for nothing the eye needs)
  if (fpsCap > 0 && now - last < 1000 / fpsCap - 2) return;
  const t0 = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  perf.frame(now - last);
  last = now;

  if (sim) bus.setWave(sim.tick(dt));
  bus.setAudio(audio.read(dt));
  palette.update(media.element, dt);
  engine.setSourceAspect(aspectOf(media.element));
  if (tracker.running) {
    const cam = live.element(trackingCamera);
    tracker.setTuning(posesFromParam(bus.cam.poses), confidenceFromParam(bus.cam.confidence));
    tracker.update(cam, dt);
    engine.setMaskAspect(aspectOf(cam));
    // «moverse» 0.5 = the raw movement, 1 = almost 3x: the top half REALLY shows
    engine.setMotion(Math.min(1, tracker.motion * Math.pow(bus.cam.motion * 2, 1.5)));
  }
  if (maskDebug) drawMaskDebug();

  const frame = bus.frame(dt);
  engine.render(frame);
  perf.gpu(engine.gpuMs);
  live.remote.syncMacros({ palette: bus.macros.palette, sat: bus.macros.sat });
  snapTick(canvas, dt, () => ({
    preset: bus.currentPreset(),
    live: frame.wave.live,
    turn: frame.wave.turnIndex,
    waves: frame.wave.waves.map((w) => Number(w.toFixed(2))),
    gz: gz ? (gz.state.live ? 'live' : gz.connected ? 'connected' : 'off') : 'none',
    audio: audio.running,
    camera: cameraState,
    poses: tracker.poseCount,
    motion: Number(tracker.motion.toFixed(2)),
    trackErr: tracker.error ?? live.error,
    phones: live.remote.phones.size,
    video: media.videoSource?.element.currentTime.toFixed(1) ?? 'img',
    sources: media.items.length,
    fps: Math.round(perf.fps),
    ms: { frame: +perf.frameMs.toFixed(1), js: +perf.jsMs.toFixed(1), gpu: +perf.gpuMs.toFixed(1), track: +perf.trackMs.toFixed(1) },
  }));

  panel.update(
    {
      gz: gz ? (gz.state.live ? 'live' : gz.connected ? 'connecting' : 'off') : 'off',
      audio: audio.running,
      camera: cameraState,
      poses: tracker.running ? tracker.poseCount : 0,
      trackingError:
        cameraState === 'error' ? (tracker.error ?? live.error) : null,
      phoneLink: live.remote.connected,
      phones: live.remote.phones.size,
      fps: perf.fps,
    },
    frame.wave.waves,
    frame.wave.live,
  );
  perf.js(performance.now() - t0);
}
requestAnimationFrame(tick);

/** Width/height of a video or image element, 0 while it has no frame yet. */
function aspectOf(el: HTMLVideoElement | HTMLImageElement | null): number {
  if (!el) return 0;
  return el instanceof HTMLVideoElement
    ? el.videoWidth / (el.videoHeight || 1)
    : el.naturalWidth / (el.naturalHeight || 1);
}

function drawMaskDebug() {
  const el = document.getElementById('maskdebug') as HTMLCanvasElement;
  const ctx = el.getContext('2d')!;
  if (!tracker.running) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.fillStyle = '#c66';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('cámara apagada:', 12, 60);
    ctx.fillText('botón «camera» del panel (h)', 12, 78);
    if (cameraState === 'error') {
      ctx.fillText((tracker.error ?? live.error ?? 'error').slice(0, 38), 12, 96);
    }
    return;
  }
  // Raw confidence, nearest-sampled down to the debug canvas.
  const img = ctx.createImageData(256, 144);
  const data = tracker.data;
  const { width: tw, height: th } = tracker;
  for (let y = 0; y < 144; y++) {
    const sy = ((y * th / 144) | 0) * tw;
    for (let x = 0; x < 256; x++) {
      let c = data[sy + ((x * tw / 256) | 0)];
      if (tracker.invert) c = 1 - c;
      const v = (c * 255) | 0;
      const i = (y * 256 + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
