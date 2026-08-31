// Performer-tracking prototype (the side quest). MediaPipe's selfie segmenter
// runs on the webcam and produces a person-confidence mask; the engine injects
// light at the mask's edges and the flow field drags it outward - an aura that
// appears to come out of the performers.
//
// Everything loads from public/models (run tools/fetch-models.sh once). If the
// files are missing or the camera is refused, this module reports why and the
// rest of the app is untouched.
//
// Confidence masks rather than the category mask: the category mask's polarity
// is inconsistent across model builds (0/1 vs 0/255, person-first vs
// background-first). The LAST confidence channel is the person in both known
// layouts ([person] and [background, person]). If a future model still comes
// out inverted, ?maskinvert=1 flips it without a rebuild.
//
// Open question for the real space: the camera sees the projection as well as
// the performers, so the mask may pick up projected shapes. To test: point the
// camera, stand in front, watch the mask view (press m). If it is too noisy,
// candidates are an IR camera, lower exposure, or segmenting on a color key.

import * as THREE from 'three';
import type { CameraSource } from '../sources/camera';

const WASM_PATH = '/models/wasm';
const MODEL_PATH = '/models/selfie_segmenter.tflite';
const MASK_W = 256;
const MASK_H = 144;

export class BodyTracker {
  readonly texture: THREE.DataTexture;
  private data: Uint8Array<ArrayBuffer>;
  private segmenter: any = null;
  private lastVideoTime = -1;
  private invert = new URLSearchParams(location.search).get('maskinvert') === '1';
  running = false;
  error: string | null = null;

  constructor() {
    this.data = new Uint8Array(MASK_W * MASK_H);
    this.texture = new THREE.DataTexture(
      this.data, MASK_W, MASK_H, THREE.RedFormat, THREE.UnsignedByteType,
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    // Camera frames are top-left origin, GL is bottom-left.
    this.texture.flipY = true;
  }

  async start(): Promise<boolean> {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      this.segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
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

  /** Call per frame with a live camera. Skips work when the frame is unchanged. */
  update(camera: CameraSource) {
    const video = camera.element;
    if (!this.running || !this.segmenter || !video) return;
    if (video.currentTime === this.lastVideoTime || video.readyState < 2) return;
    this.lastVideoTime = video.currentTime;

    const result = this.segmenter.segmentForVideo(video, performance.now());
    const masks = result?.confidenceMasks;
    if (!masks || masks.length === 0) return;
    const person = masks[masks.length - 1];
    const src: Float32Array = person.getAsFloat32Array();
    const sw = person.width;
    const sh = person.height;
    for (let y = 0; y < MASK_H; y++) {
      const sy = ((y * sh / MASK_H) | 0) * sw;
      const dy = y * MASK_W;
      for (let x = 0; x < MASK_W; x++) {
        let conf = src[sy + ((x * sw / MASK_W) | 0)];
        if (this.invert) conf = 1 - conf;
        this.data[dy + x] = conf > 0.5 ? 255 : 0;
      }
    }
    for (const m of masks) m.close();
    this.texture.needsUpdate = true;
  }

  stop() {
    this.segmenter?.close();
    this.segmenter = null;
    this.running = false;
  }
}
