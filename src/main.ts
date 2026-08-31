// Wiring. Sources feed the ControlBus, the bus produces one ControlFrame per
// RAF tick, the Engine renders it. Nothing here contains behavior - swap any
// piece by changing what writes into the bus.

import { config } from './config';
import { ControlBus } from './control/bus';
import { AudioAnalyser } from './control/audio';
import { GranulizerClient } from './control/granulizer';
import { Simulator } from './control/simulator';
import { MidiControl } from './control/midi';
import { VideoSource } from './sources/video';
import { PaletteExtractor } from './sources/palette';
import { CameraSource } from './sources/camera';
import { BodyTracker } from './tracking/bodyTracking';
import { Engine } from './engine/renderer';
import { Panel } from './ui/panel';
import { SCENES } from './scenes/scenes';
import { snapTick } from './debug/snap';

const canvas = document.getElementById('view') as HTMLCanvasElement;

const bus = new ControlBus();
const palette = new PaletteExtractor(config.paletteSize, config.paletteInterval);
const engine = new Engine(canvas, config.resScale, palette.colors);

const video = new VideoSource(config.videoUrl);
engine.setVideoTexture(video.texture);

const audio = new AudioAnalyser();
if (config.audioEnabled) audio.start();

const midi = new MidiControl();
midi.start();

const panel = new Panel(bus, midi);

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

// --- camera / tracking prototype ---------------------------------------------
const camera = new CameraSource();
const tracker = new BodyTracker();
let maskDebug = false;
if (config.cameraEnabled) {
  // Model first, camera second: a missing model file surfaces even when the
  // camera permission is not granted.
  (async () => {
    if ((await tracker.start()) && (await camera.start())) {
      engine.setMaskTexture(tracker.texture);
    }
  })();
}

// --- keys --------------------------------------------------------------------
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'h') panel.toggle();
  if (ev.key === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
  if (ev.key === 'm') {
    maskDebug = !maskDebug;
    document.getElementById('maskdebug')!.style.display = maskDebug ? '' : 'none';
  }
  if (ev.key === ' ') bus.requestScene(bus.currentScene() + 1);
  const n = Number(ev.key);
  if (n >= 1 && n <= SCENES.length) bus.requestScene(n - 1);
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
  palette.update(video.element, dt);
  if (tracker.running) {
    tracker.update(camera);
    if (maskDebug) drawMaskDebug();
  }

  const frame = bus.frame(dt);
  engine.render(frame);
  snapTick(canvas, dt, () => ({
    scene: bus.currentScene(),
    live: frame.wave.live,
    turn: frame.wave.turnIndex,
    waves: frame.wave.waves.map((w) => Number(w.toFixed(2))),
    gz: gz ? (gz.state.live ? 'live' : gz.connected ? 'connected' : 'off') : 'none',
    audio: audio.running,
    tracker: tracker.running,
    trackErr: tracker.error ?? camera.error,
    video: video.element.currentTime.toFixed(1),
    fps: Math.round(fpsAvg),
  }));

  panel.update(
    {
      gz: gz ? (gz.state.live ? 'live' : gz.connected ? 'connecting' : 'off') : 'off',
      audio: audio.running,
      camera: tracker.running,
      trackingError: config.cameraEnabled ? (camera.error ?? tracker.error) : null,
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
