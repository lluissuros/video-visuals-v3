// Performer tracking. MediaPipe's PoseLandmarker runs on a camera (laptop, USB
// or phone, see sources/live.ts) and produces, per detected person, a
// segmentation mask and 33 landmarks. The engine injects light at the mask's
// edges and the flow field drags it outward - an aura that appears to come out
// of the performers.
//
// Pose rather than the selfie segmenter: the segmenter is a video-call
// background model with no idea what a person is, so a chair, a coat or a shape
// on the projection screen all read as foreground. PoseLandmarker detects
// people FIRST and segments second, so nothing that fails to look like a body
// ever reaches the mask. `poses` caps how many people it will find and
// `confidence` sets how sure it must be - both live, both saved in presets.
//
// The masks of all detected people merge into one texture by max, and go to the
// GPU raw, as a float texture at the model's own resolution; the engine's mask
// pass (passes/mask.ts) does the soft ramp, the aspect fit and the smoothing.
// Downsampling on the CPU to a fixed 256x144 is what made the silhouette read
// as staircases.
//
// The landmarks also give `motion`: mean landmark speed, smoothed with a fast
// attack and a slow release, which the aura uses to swell when the performers
// move. That is a body measurement, not a pixel one, so a light change or a
// cut in the projected film does not trigger it.
//
// Everything loads from public/models (run tools/fetch-models.sh once). If the
// files are missing or the camera is refused, this module reports why and the
// rest of the app is untouched.
//
// Open question for the real space: the camera sees the projection as well as
// the performers. Pose is far harder to fool than the segmenter was, but a
// large projected body could still land. To test: point the camera, stand in
// front, watch the mask view (press m). If it is still noisy, raise
// `confianza`, then consider an IR camera or lower exposure.

import * as THREE from 'three';

const WASM_PATH = '/models/wasm';
const modelPath = (v: string) => `/models/pose_landmarker_${v}.task`;

/** Slider 0..1 -> how many people the model will look for. */
export const posesFromParam = (v: number) => 1 + Math.round(v * 3);
/** Slider 0..1 -> detection/tracking confidence. Below ~0.3 junk creeps back. */
export const confidenceFromParam = (v: number) => 0.25 + v * 0.65;

export class BodyTracker {
  /** Person confidence 0..1, model resolution. Recreated when the size changes. */
  texture: THREE.DataTexture;
  /** The texture's backing store (three types it as bytes). */
  data = new Float32Array(4);
  /** Set when `texture` was replaced (new size); the engine rebinds. */
  onTexture: ((tex: THREE.DataTexture) => void) | null = null;
  readonly invert = new URLSearchParams(location.search).get('maskinvert') === '1';
  /** Movement energy 0..1, from landmark speed. Fast to rise, slow to fall. */
  motion = 0;
  /** Main-thread ms of the last inference (model + mask copy). */
  inferMs = 0;
  /** People found in the last frame. */
  poseCount = 0;
  running = false;
  error: string | null = null;

  private landmarker: any = null;
  private lastVideoTime = -1;
  private prev: { x: number; y: number }[] = [];
  private numPoses = 2;
  private confidence = 0.5;
  private pending = false;

  /** `linearFloat`: whether the GPU can filter float textures (Engine.floatLinear). */
  constructor(private linearFloat: boolean) {
    this.texture = this.makeTexture(2, 2);
  }

  private makeTexture(w: number, h: number): THREE.DataTexture {
    this.data = new Float32Array(w * h);
    const tex = new THREE.DataTexture(this.data, w, h, THREE.RedFormat, THREE.FloatType);
    const filter = this.linearFloat ? THREE.LinearFilter : THREE.NearestFilter;
    tex.minFilter = filter;
    tex.magFilter = filter;
    // Camera frames are top-left origin, GL is bottom-left.
    tex.flipY = true;
    tex.needsUpdate = true;
    return tex;
  }

  get width(): number { return this.texture.image.width; }
  get height(): number { return this.texture.image.height; }

  async start(): Promise<boolean> {
    try {
      const variant = new URLSearchParams(location.search).get('posemodel') ?? 'full';
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath(variant), delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: this.numPoses,
        minPoseDetectionConfidence: this.confidence,
        minPosePresenceConfidence: this.confidence,
        minTrackingConfidence: this.confidence,
        outputSegmentationMasks: true,
      });
      this.running = true;
      return true;
    } catch (e) {
      this.error =
        'tracking unavailable (run tools/fetch-models.sh?): ' +
        (e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  /** Live retune from the panel. Ignored while an earlier change is in flight. */
  setTuning(poses: number, confidence: number) {
    if (poses === this.numPoses && confidence === this.confidence) return;
    this.numPoses = poses;
    this.confidence = confidence;
    if (!this.landmarker || this.pending) return;
    this.pending = true;
    this.landmarker
      .setOptions({
        numPoses: this.numPoses,
        minPoseDetectionConfidence: this.confidence,
        minPosePresenceConfidence: this.confidence,
        minTrackingConfidence: this.confidence,
      })
      .catch(() => {})
      .finally(() => { this.pending = false; });
  }

  /** Call per frame with the camera's <video>. Skips work when the frame is unchanged. */
  update(video: HTMLVideoElement | null, dt: number) {
    if (!this.running || !this.landmarker || !video) return;
    if (video.currentTime === this.lastVideoTime || video.readyState < 2) {
      this.decayMotion(dt);
      return;
    }
    this.lastVideoTime = video.currentTime;

    const t0 = performance.now();
    try {
      this.infer(video, dt);
    } finally {
      this.inferMs = performance.now() - t0;
    }
  }

  private infer(video: HTMLVideoElement, dt: number) {
    const result = this.landmarker.detectForVideo(video, performance.now());
    const masks = result?.segmentationMasks;
    this.poseCount = result?.landmarks?.length ?? 0;
    this.trackMotion(result?.landmarks ?? [], dt);
    if (!masks || masks.length === 0) {
      // Nobody in frame: fade the mask out rather than freezing the last body.
      if (this.data.length > 4) this.data.fill(0);
      this.texture.needsUpdate = true;
      for (const m of masks ?? []) m.close();
      return;
    }

    const first: Float32Array = masks[0].getAsFloat32Array();
    if (masks[0].width !== this.width || masks[0].height !== this.height) {
      this.texture.dispose();
      this.texture = this.makeTexture(masks[0].width, masks[0].height);
      this.onTexture?.(this.texture);
    }
    // Copy: the mask memory is released by close() below, the upload is later.
    // Several people -> one mask, brightest wins, so bodies never cancel out.
    this.data.set(first);
    for (let i = 1; i < masks.length; i++) {
      const extra: Float32Array = masks[i].getAsFloat32Array();
      if (extra.length !== this.data.length) continue;
      for (let p = 0; p < extra.length; p++) {
        if (extra[p] > this.data[p]) this.data[p] = extra[p];
      }
    }
    for (const m of masks) m.close();
    this.texture.needsUpdate = true;
  }

  /** Mean landmark speed over every person, normalised and smoothed. */
  private trackMotion(landmarks: { x: number; y: number }[][], dt: number) {
    const flat = landmarks.flat();
    let raw = 0;
    if (flat.length && flat.length === this.prev.length && dt > 1e-4) {
      let sum = 0;
      for (let i = 0; i < flat.length; i++) {
        sum += Math.hypot(flat[i].x - this.prev[i].x, flat[i].y - this.prev[i].y);
      }
      // Normalised coords, so ~0.5 screen-widths/second of mean travel is "a lot".
      raw = Math.min(1, (sum / flat.length / dt) * 2);
    }
    this.prev = flat.map((p) => ({ x: p.x, y: p.y }));
    // Fast attack, slow release: a gesture lights up at once and glows after.
    const k = raw > this.motion ? 0.45 : 1 - Math.pow(0.35, dt);
    this.motion += (raw - this.motion) * k;
  }

  private decayMotion(dt: number) {
    this.motion *= Math.pow(0.35, dt);
  }

  stop() {
    this.landmarker?.close();
    this.landmarker = null;
    this.running = false;
    this.motion = 0;
    this.poseCount = 0;
    this.prev = [];
  }
}
