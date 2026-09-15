// aiSource: an experimental stage between the film source and the engine.
// It photographs the current source, sends the frame to the local Python
// service (ai/server.py, Core ML img2img) and turns the answer into a texture
// the engine consumes exactly like a video. Everything lives in src/ai and
// ai/; when it is off, or the service is down, the engine sees the source
// untouched. Remove the folder and the few lines in main.ts and it is gone.
//
// Two clocks: the service answers at a few frames per second; the compositor
// here runs at render rate and crossfades toward each new AI frame (EMA), then
// mixes a share of the live source back in for immediate motion.

import * as THREE from 'three';

/** Mirrors ai/pipeline.py Params. */
export interface AiParams {
  prompt: string;
  strength: number;
  feedback: number;
  seed: number;
  steps: number;
  prompt_glide: number;
  noise_mix: number;
  /** Warp the latent memory along the source's motion (optical flow). */
  flow: boolean;
}

export interface AiStatus {
  connected: boolean;
  ready: boolean;
  loading: string;
  error: string;
  model: string;
  size: string;
  sizes: string[];
  models: { key: string; label: string }[];
  fps: number;
  ms: { encode: number; unet: number; decode: number; total: number } | null;
  dropped: number;
  params: AiParams | null;
}

/** Local knobs (the service never sees them). */
export interface AiLocal {
  /** Share of the raw source mixed back over the AI image. */
  mix: number;
  /** Crossfade time toward each new AI frame: 0 = hard cut, 1 = ~1 s. */
  smooth: number;
  /** Cap on frames sent per second: what the GPU lends to the model. */
  sendFps: number;
  /** JPEG quality of the frames sent. */
  quality: number;
  /** Where the tracker's silhouette goes: `after` = engine only (the AI never
   *  sees it), `before` = painted into the frame the model receives and
   *  hidden from the engine, `both`, `screen` = the model receives the
   *  rendered canvas itself (silhouette with its colors and aura, and
   *  everything else): a loop, anchored by `mix` of the raw source. */
  silhouette: 'after' | 'before' | 'both' | 'screen';
  /** Opacity of the silhouette painted for the model (before/both). */
  silOpacity: number;
}

/** One tracker mask, as main hands it over: raw confidences at the model's
 *  resolution, plus the camera aspect they stand for. */
export interface MaskFrame {
  data: Float32Array;
  width: number;
  height: number;
  invert: boolean;
  aspect: number;
  /** Paint color, 0..255; white when absent. */
  color?: [number, number, number];
}

const STORE = 'vv3.ai';
const MAX_INFLIGHT = 2;

const compositeVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** acc = mix(prev, ai, k): the crossfade buffer. */
const accFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uAi;
uniform sampler2D uPrev;
uniform float uK;
uniform float uHasPrev;
void main() {
  vec3 ai = texture2D(uAi, vUv).rgb;
  vec3 prev = texture2D(uPrev, vUv).rgb;
  gl_FragColor = vec4(mix(ai, mix(prev, ai, uK), uHasPrev), 1.0);
}
`;

/** out = mix(acc, source, mix), the source cover-fitted to the AI frame. */
const mixFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uAcc;
uniform sampler2D uSrc;
uniform vec2 uSrcFit;
uniform float uMix;
void main() {
  vec2 suv = (vUv - 0.5) * uSrcFit + 0.5;
  vec3 src = texture2D(uSrc, suv).rgb;
  vec3 acc = texture2D(uAcc, vUv).rgb;
  gl_FragColor = vec4(mix(acc, src, uMix), 1.0);
}
`;

export class AiSource {
  /** On = the engine gets this module's texture instead of the source. */
  enabled = false;
  local: AiLocal = {
    mix: 0.15, smooth: 0.35, sendFps: 8, quality: 0.85, silhouette: 'after', silOpacity: 1,
  };
  /** Wired by main: the current tracker mask, or null when the camera is off. */
  maskProvider: (() => MaskFrame | null) | null = null;
  status: AiStatus = {
    connected: false, ready: false, loading: '', error: '', model: '', size: '512x320',
    sizes: [], models: [], fps: 0, ms: null, dropped: 0, params: null,
  };
  /** Requested model/size and params; re-sent on every (re)connect. */
  wanted: { model: string; size: string; params: Partial<AiParams> } = {
    model: 'sd-turbo', size: '512x320', params: {},
  };
  /** Fired when enabled flips or the status changes: main re-wires the film. */
  onChange: (() => void) | null = null;
  /** Round trip of the last frame, ms, and frames received per second. */
  latencyMs = 0;
  rxFps = 0;
  /** Frames received so far (the panel's preview redraws when it changes). */
  frames = 0;

  private ws: WebSocket | null = null;
  private retry = 0;
  private input: { tex: THREE.Texture; el: HTMLVideoElement | HTMLImageElement } | null = null;
  private w = 512;
  private h = 320;
  private capture: OffscreenCanvas;
  private cctx: OffscreenCanvasRenderingContext2D;
  private maskCanvas = new OffscreenCanvas(2, 2);
  private mctx = this.maskCanvas.getContext('2d')!;
  private inflight = 0;
  private frameId = 0;
  private sentAt = new Map<number, number>();
  private lastSend = 0;
  private rxTimes: number[] = [];
  private encoding = false;

  private aiTex: THREE.Texture | null = null;
  private lastBitmap: ImageBitmap | null = null;
  /** Bitmaps replaced before a render uploaded their successor; closed after one. */
  private staleBitmaps: ImageBitmap[] = [];
  private hasAi = false;
  private acc: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private out: THREE.WebGLRenderTarget;
  private cur = 0;
  private accMat: THREE.ShaderMaterial;
  private mixMat: THREE.ShaderMaterial;
  private accScene = new THREE.Scene();
  private mixScene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private hasPrev = false;

  constructor(private host: string, private renderer: THREE.WebGLRenderer) {
    this.load();
    const [w, h] = this.wanted.size.split('x').map(Number);
    this.w = w; this.h = h;
    this.capture = new OffscreenCanvas(w, h);
    this.cctx = this.capture.getContext('2d', { alpha: false })!;
    const mk = () => new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false,
    });
    this.acc = [mk(), mk()];
    this.out = mk();
    this.accMat = new THREE.ShaderMaterial({
      vertexShader: compositeVertex, fragmentShader: accFragment, depthTest: false, depthWrite: false,
      uniforms: { uAi: { value: null }, uPrev: { value: null }, uK: { value: 1 }, uHasPrev: { value: 0 } },
    });
    this.mixMat = new THREE.ShaderMaterial({
      vertexShader: compositeVertex, fragmentShader: mixFragment, depthTest: false, depthWrite: false,
      uniforms: {
        uAcc: { value: null }, uSrc: { value: null },
        uSrcFit: { value: new THREE.Vector2(1, 1) }, uMix: { value: 0 },
      },
    });
    const quad = new THREE.PlaneGeometry(2, 2);
    this.accScene.add(new THREE.Mesh(quad, this.accMat));
    this.mixScene.add(new THREE.Mesh(quad, this.mixMat));
    this.connect();
  }

  /** What the engine should draw while the module is on. */
  get texture(): THREE.Texture { return this.out.texture; }
  get inputTexture(): THREE.Texture | null { return this.input?.tex ?? null; }
  get aspect(): number { return this.w / this.h; }
  /** The engine draws our texture only when we are on AND have an answer
   *  (or the source fallback would flash black at every model switch). */
  get active(): boolean { return this.enabled && this.input !== null; }
  /** Latest AI frame, for the palette extractor. */
  get bitmap(): ImageBitmap | null { return this.hasAi ? this.lastBitmap : null; }
  /** True while the silhouette travels through the model only: main keeps
   *  the mask away from the engine so it is not drawn twice. */
  get hidesMask(): boolean { return this.active && this.local.silhouette === 'before'; }

  // ---------------------------------------------------------------- wiring
  setInput(tex: THREE.Texture, el: HTMLVideoElement | HTMLImageElement) {
    const changed = this.input !== null && this.input.el !== el;
    this.input = { tex, el };
    this.mixMat.uniforms.uSrc.value = tex;
    // a new source starts clean: no latent memory of the old one
    if (changed) this.reset();
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.hasPrev = false;
    this.save();
    this.onChange?.();
  }

  setLocal(patch: Partial<AiLocal>) {
    const rewire = patch.silhouette !== undefined && patch.silhouette !== this.local.silhouette;
    Object.assign(this.local, patch);
    this.save();
    if (rewire) this.onChange?.();
  }

  setParams(patch: Partial<AiParams>) {
    Object.assign(this.wanted.params, patch);
    this.save();
    this.send({ type: 'params', ...patch });
  }

  setModel(model: string, size?: string) {
    this.wanted.model = model;
    if (size) this.wanted.size = size;
    this.save();
    this.send({ type: 'model', model, size: this.wanted.size });
  }

  /** Drop the model's latent memory and our crossfade buffer. */
  reset() {
    this.send({ type: 'reset' });
    this.hasPrev = false;
  }

  // ------------------------------------------------------------ per frame
  /** Call once per render tick. Sends a frame when it is time; composites. */
  update(dt: number) {
    if (this.local.silhouette !== 'screen') this.maybeSend();
    this.composite(dt);
  }

  /** Call right after the engine rendered, in the same task (the WebGL
   *  buffer is still readable): in `screen` mode the model gets the canvas. */
  afterRender(canvas: HTMLCanvasElement) {
    if (this.local.silhouette === 'screen') this.maybeSend(canvas);
  }

  private maybeSend(screen?: HTMLCanvasElement) {
    if (!this.enabled || !this.input || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    // a frame unanswered for 3 s is lost (service hiccup): do not wait for it
    for (const [k, t] of this.sentAt) if (now - t > 3000) this.sentAt.delete(k);
    if (this.encoding) return;
    this.inflight = this.sentAt.size;
    if (!this.status.ready || this.inflight >= MAX_INFLIGHT) return;
    if (now - this.lastSend < 1000 / Math.max(0.5, this.local.sendFps)) return;
    const el = screen ?? this.input.el;
    const sw = el instanceof HTMLVideoElement ? el.videoWidth : el instanceof HTMLImageElement ? el.naturalWidth : el.width;
    const sh = el instanceof HTMLVideoElement ? el.videoHeight : el instanceof HTMLImageElement ? el.naturalHeight : el.height;
    if (!(sw > 0 && sh > 0)) return;
    if (el instanceof HTMLVideoElement && el.readyState < 2) return;
    this.lastSend = now;
    // cover-fit crop of the source into the working frame
    const scale = Math.max(this.w / sw, this.h / sh);
    const cw = this.w / scale;
    const ch = this.h / scale;
    this.cctx.drawImage(el, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, this.w, this.h);
    if (!screen) this.paintMask();
    const id = ++this.frameId;
    this.encoding = true;
    this.capture.convertToBlob({ type: 'image/jpeg', quality: this.local.quality })
      .then((blob) => blob.arrayBuffer())
      .then((buf) => {
        this.encoding = false;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const msg = new Uint8Array(4 + buf.byteLength);
        new DataView(msg.buffer).setUint32(0, id, true);
        msg.set(new Uint8Array(buf), 4);
        this.sentAt.set(id, performance.now());
        this.ws.send(msg);
      })
      .catch(() => { this.encoding = false; });
  }

  /** Silhouette into the model's frame (before/both): flat color (the
   *  palette's, or white), alpha = the tracker's confidence, cover-fitted like
   *  the source so both cameras line up when they are the same one. */
  private paintMask() {
    const mode = this.local.silhouette;
    if ((mode !== 'before' && mode !== 'both') || this.local.silOpacity <= 0) return;
    const m = this.maskProvider?.();
    if (!m) return;
    const [cr, cg, cb] = m.color ?? [255, 255, 255];
    const { width: tw, height: th } = m;
    if (this.maskCanvas.width !== tw || this.maskCanvas.height !== th) {
      this.maskCanvas.width = tw; this.maskCanvas.height = th;
    }
    const img = this.mctx.createImageData(tw, th);
    const px = img.data;
    const gain = this.local.silOpacity * 255;
    for (let i = 0, n = tw * th; i < n; i++) {
      const c = m.invert ? 1 - m.data[i] : m.data[i];
      const o = i * 4;
      px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; px[o + 3] = c * gain;
    }
    this.mctx.putImageData(img, 0, 0);
    // the mask stands for a camera frame of aspect m.aspect: cover-fit it
    const dw = m.aspect > this.w / this.h ? this.h * m.aspect : this.w;
    const dh = m.aspect > this.w / this.h ? this.h : this.w / m.aspect;
    this.cctx.drawImage(this.maskCanvas, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh);
  }

  private composite(dt: number) {
    if (!this.active) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    // EMA toward the newest AI frame. smooth 0 -> k = 1 (hard cut).
    const tau = this.local.smooth * this.local.smooth * 1.0;
    const k = tau > 0.001 ? 1 - Math.exp(-dt / tau) : 1;
    const au = this.accMat.uniforms;
    au.uAi.value = this.aiTex ?? this.input!.tex;
    au.uPrev.value = this.acc[this.cur].texture;
    au.uK.value = this.hasAi ? k : 1;
    au.uHasPrev.value = this.hasPrev ? 1 : 0;
    const next = 1 - this.cur;
    r.setRenderTarget(this.acc[next]);
    r.render(this.accScene, this.camera);
    this.cur = next;
    this.hasPrev = true;
    // the current bitmap is on the GPU now: the older ones can go
    for (const b of this.staleBitmaps) b.close();
    this.staleBitmaps.length = 0;

    const mu = this.mixMat.uniforms;
    mu.uAcc.value = this.acc[this.cur].texture;
    mu.uSrc.value = this.input!.tex;
    const el = this.input!.el;
    const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    const srcAspect = sw > 0 && sh > 0 ? sw / sh : this.aspect;
    (mu.uSrcFit.value as THREE.Vector2).set(
      Math.min(1, this.aspect / srcAspect), Math.min(1, srcAspect / this.aspect),
    );
    // No answer yet (service down, model loading): show the source through.
    mu.uMix.value = this.hasAi ? this.local.mix : 1;
    r.setRenderTarget(this.out);
    r.render(this.mixScene, this.camera);
    r.setRenderTarget(prevTarget);
  }

  // ------------------------------------------------------------- network
  private connect() {
    const ws = new WebSocket(`ws://${this.host}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.sentAt.clear();
      this.status.connected = true;
      // the service keeps its own state; make it match what the panel shows
      this.send({ type: 'model', model: this.wanted.model, size: this.wanted.size });
      this.send({ type: 'params', ...this.wanted.params });
      this.onChange?.();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') this.onStatus(JSON.parse(ev.data));
      else this.onFrame(ev.data as ArrayBuffer);
    };
    ws.onclose = () => {
      this.ws = null;
      this.status.connected = false;
      this.status.ready = false;
      this.hasAi = false;
      this.onChange?.();
      const wait = Math.min(5000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => ws.close();
  }

  private send(obj: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private onStatus(s: Partial<AiStatus>) {
    const wasReady = this.status.ready;
    Object.assign(this.status, s, { connected: true });
    // a model switch resets the working size
    const [w, h] = this.status.size.split('x').map(Number);
    if (w > 0 && h > 0 && (w !== this.w || h !== this.h)) this.resize(w, h);
    if (!wasReady && this.status.ready) this.hasPrev = false;
    this.onChange?.();
  }

  private async onFrame(buf: ArrayBuffer) {
    const id = new DataView(buf).getUint32(0, true);
    const sent = this.sentAt.get(id);
    if (sent !== undefined) this.latencyMs = performance.now() - sent;
    // frames the service dropped never answer: everything up to this id is done
    for (const k of this.sentAt.keys()) if (k <= id) this.sentAt.delete(k);
    this.inflight = this.sentAt.size;
    const now = performance.now();
    this.rxTimes.push(now);
    this.rxTimes = this.rxTimes.filter((t) => t > now - 2000);
    this.rxFps = this.rxTimes.length / 2;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([buf.slice(4)], { type: 'image/jpeg' }), {
        imageOrientation: 'flipY',
      });
    } catch { return; }
    if (bitmap.width !== this.w || bitmap.height !== this.h) { bitmap.close(); return; }
    if (!this.aiTex) {
      this.aiTex = new THREE.Texture(bitmap);
      this.aiTex.flipY = false;
      this.aiTex.colorSpace = THREE.SRGBColorSpace;
      this.aiTex.minFilter = THREE.LinearFilter;
      this.aiTex.magFilter = THREE.LinearFilter;
      this.aiTex.generateMipmaps = false;
    } else {
      this.aiTex.image = bitmap;
    }
    this.aiTex.needsUpdate = true;
    // do not close the previous bitmap yet: two answers can land between two
    // renders, and three uploads a texture only when it renders
    if (this.lastBitmap) this.staleBitmaps.push(this.lastBitmap);
    this.lastBitmap = bitmap;
    this.hasAi = true;
    this.frames++;
  }

  private resize(w: number, h: number) {
    this.w = w; this.h = h;
    this.capture.width = w; this.capture.height = h;
    this.acc.forEach((t) => t.setSize(w, h));
    this.out.setSize(w, h);
    this.aiTex?.dispose();
    this.aiTex = null;
    this.hasAi = false;
    this.hasPrev = false;
    this.sentAt.clear();
    this.onChange?.();
  }

  // ------------------------------------------------------------ persistence
  private load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      if (s.local) Object.assign(this.local, s.local);
      if (s.wanted) Object.assign(this.wanted, s.wanted);
      if (typeof s.enabled === 'boolean') this.enabled = s.enabled;
    } catch { /* fresh */ }
  }

  private save() {
    localStorage.setItem(STORE, JSON.stringify({
      local: this.local, wanted: this.wanted, enabled: this.enabled,
    }));
  }
}
