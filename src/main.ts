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
import { CameraSource } from './sources/camera';
import { BodyTracker } from './tracking/bodyTracking';
import { Engine } from './engine/renderer';
import { Panel, type PanelStatus } from './ui/panel';
import { SCENES } from './scenes/scenes';
import { GEN_TYPE_NAMES, MACRO_NAMES } from './types';
import { snapTick } from './debug/snap';

const canvas = document.getElementById('view') as HTMLCanvasElement;

const bus = new ControlBus();
const palette = new PaletteExtractor(config.paletteSize, config.paletteInterval);
const engine = new Engine(canvas, config.resScale, palette.colors);

const media = new MediaManager();
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
// 'clock': no structure source; the bus advances scenes on its own timer.

if (config.scene !== null && Number.isFinite(config.scene)) {
  bus.setScene(config.scene);
  bus.hold = true;
}
if (config.shader !== null && Number.isFinite(config.shader)) {
  bus.gen.type = Math.min(GEN_TYPE_NAMES.length - 1, Math.max(0, config.shader));
}
// Any macro can be preset from the URL: ?blur=0.8&feed=0.9 ...
{
  const q = new URLSearchParams(location.search);
  for (const name of MACRO_NAMES) {
    const v = q.get(name);
    if (v !== null) bus.setMacro(name, Number(v));
  }
}

// --- camera / tracking prototype ---------------------------------------------
const camera = new CameraSource();
const tracker = new BodyTracker();
let cameraState: PanelStatus['camera'] = 'off';
let maskDebug = false;

async function toggleCamera() {
  if (cameraState === 'on' || cameraState === 'starting') {
    tracker.stop();
    camera.stop();
    engine.setMaskTexture(null);
    cameraState = 'off';
    return;
  }
  cameraState = 'starting';
  // Model first, camera second: a missing model file surfaces even when the
  // camera permission is not granted.
  if ((await tracker.start()) && (await camera.start())) {
    engine.setMaskTexture(tracker.texture);
    cameraState = 'on';
  } else {
    cameraState = 'error';
  }
}
if (config.cameraEnabled) toggleCamera();

const panel = new Panel(bus, midi, { media, onToggleCamera: toggleCamera });

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
  if (ev.key === 'p') panel.toggleHold();
  if (ev.key === 'l') panel.toggleLoop();
  if (ev.key === ' ') bus.setScene(bus.currentScene() + 1);
  const n = Number(ev.key);
  if (n >= 1 && n <= SCENES.length) bus.setScene(n - 1);
});

// --- main loop ---------------------------------------------------------------
let last = performance.now();
let fpsAvg = 60;

function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAvg += (1 / Math.max(dt, 1e-4) - fpsAvg) * 0.03;

  if (sim) bus.setWave(sim.tick(dt));
  bus.setAudio(audio.read(dt));
  palette.update(media.element, dt);
  if (tracker.running) tracker.update(camera);
  if (maskDebug) drawMaskDebug();

  const frame = bus.frame(dt);
  engine.render(frame);
  snapTick(canvas, dt, () => ({
    scene: bus.currentScene(),
    live: frame.wave.live,
    turn: frame.wave.turnIndex,
    waves: frame.wave.waves.map((w) => Number(w.toFixed(2))),
    gz: gz ? (gz.state.live ? 'live' : gz.connected ? 'connected' : 'off') : 'none',
    audio: audio.running,
    camera: cameraState,
    trackErr: tracker.error ?? camera.error,
    video: media.videoSource?.element.currentTime.toFixed(1) ?? 'img',
    sources: media.items.length,
    fps: Math.round(fpsAvg),
  }));

  panel.update(
    {
      gz: gz ? (gz.state.live ? 'live' : gz.connected ? 'connecting' : 'off') : 'off',
      audio: audio.running,
      camera: cameraState,
      trackingError:
        cameraState === 'error' ? (tracker.error ?? camera.error) : null,
      fps: fpsAvg,
    },
    frame.wave.waves,
    bus.currentScene(),
    frame.wave.live,
  );

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

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
      ctx.fillText((tracker.error ?? camera.error ?? 'error').slice(0, 38), 12, 96);
    }
    return;
  }
  const img = ctx.createImageData(256, 144);
  const data = (tracker.texture.image.data as Uint8Array);
  for (let i = 0; i < data.length; i++) {
    img.data[i * 4] = data[i];
    img.data[i * 4 + 1] = data[i];
    img.data[i * 4 + 2] = data[i];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
