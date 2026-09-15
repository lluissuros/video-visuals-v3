// The render engine: an optional generative fractal pass, a ping-pong feedback
// buffer driven by the flow pass, presented through the grade pass. It knows
// nothing about WHERE control values come from - it consumes a ControlFrame
// and the active preset's Look.

import * as THREE from 'three';
import type { ControlFrame } from '../types';
import { GEN_TYPE_STARS } from '../types';
import { flowVertex, flowFragment } from './passes/flow';
import {
  presentFragment, kawaseDownFragment, kawaseUpFragment, finalFragment,
} from './passes/present';
import { genFragment } from './passes/generative';
import { maskPrepFragment, maskCopyFragment } from './passes/mask';

const MASK_W = 512;
// Mask history: an atlas of HIST_TILES tiles, one tile written every HIST_STEP
// seconds. 8x14 tiles at 10 Hz hold 11.2 s, enough for the 10 s max delay.
const HIST_TILES = { x: 8, y: 14 };
const HIST_TILE_W = 256;
const HIST_TILE_H = 144;
const HIST_STEP = 0.1;
const HIST_MAX_DELAY = 10;

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private genScene = new THREE.Scene();
  private presentScene = new THREE.Scene();
  private blurScene = new THREE.Scene();
  private finalScene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private genTarget: THREE.WebGLRenderTarget;
  private sceneTarget: THREE.WebGLRenderTarget;
  private downs: THREE.WebGLRenderTarget[];
  private ups: THREE.WebGLRenderTarget[];
  private current = 0;
  private flowMat: THREE.ShaderMaterial;
  private genMat: THREE.ShaderMaterial;
  private presentMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private finalMat: THREE.ShaderMaterial;
  private maskPrepMat: THREE.ShaderMaterial;
  private maskCopyMat: THREE.ShaderMaterial;
  private histTarget: THREE.WebGLRenderTarget;
  private histIdx = 0;
  private histAccum = 0;
  private auraTime = 0;
  private motion = 0;
  private blurMesh: THREE.Mesh;
  /** Mask chain: prep (full), down /2, down /4, up /2, up (full). */
  private maskTargets: THREE.WebGLRenderTarget[];
  private rawMask: THREE.Texture | null = null;
  private resScale: number;
  private paletteUniform: THREE.Vector3[];
  private genTime = 0;
  private aspect = 1;
  /** GPU timer: one query in flight at a time; null when unsupported. */
  private timerExt: any = null;
  private timerQuery: WebGLQuery | null = null;
  private timerActive = false;
  /** Last measured GPU time of one render, ms. NaN = no timer extension. */
  gpuMs = NaN;
  private sourceAspect = 16 / 9;
  private maskAspect = 16 / 9;

  constructor(canvas: HTMLCanvasElement, resScale: number, paletteColors: THREE.Vector3[]) {
    this.resScale = resScale;
    this.paletteUniform = paletteColors;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1); // the feedback look does not need retina
    this.timerExt = this.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2');

    const mk = () =>
      new THREE.WebGLRenderTarget(2, 2, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType, // trails accumulate; 8-bit posterizes them
        depthBuffer: false,
      });
    this.targets = [mk(), mk()];
    this.genTarget = mk();
    this.sceneTarget = mk();
    // dual-kawase pyramid: 1/2, 1/4, 1/8, 1/16 down, then back up to 1/2
    this.downs = [mk(), mk(), mk(), mk()];
    this.ups = [mk(), mk(), mk()];
    this.maskTargets = [mk(), mk(), mk(), mk(), mk()];
    this.histTarget = new THREE.WebGLRenderTarget(
      HIST_TILES.x * HIST_TILE_W, HIST_TILES.y * HIST_TILE_H, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
      });
    this.histTarget.scissorTest = true;

    this.genMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: genFragment,
      uniforms: {
        uAspect: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uZoom: { value: 1 },
        uType: { value: 1 },
        uHue: { value: 0 },
        uEnergy: { value: 0 },
        uOnset: { value: 0 },
        uTurnProb: { value: 0.5 },
        uVideo: { value: null },
        uHasVideo: { value: 0 },
        uVideoInf: { value: 0.35 },
        uVideoFit: { value: new THREE.Vector2(1, 1) },
        uChaos: { value: 0.5 },
        uMovement: { value: 0.3 },
        uQuantity: { value: 0.5 },
        uSize: { value: 0.4 },
      },
    });

    this.flowMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: flowFragment,
      uniforms: {
        uPrev: { value: null },
        uVideo: { value: null },
        uMask: { value: null },
        uGen: { value: this.genTarget.texture },
        uHasVideo: { value: 0 },
        uHasMask: { value: 0 },
        uAspect: { value: new THREE.Vector2(1, 1) },
        uVideoFit: { value: new THREE.Vector2(1, 1) },
        uTexel: { value: new THREE.Vector2(1 / 2, 1 / 2) },
        uTime: { value: 0 },
        uFlow: { value: 0 },
        uFeed: { value: 0 },
        uWash: { value: 0 },
        uBlur: { value: 0 },
        uPulse: { value: 0 },
        uEnergy: { value: 0 },
        uOnset: { value: 0 },
        uLow: { value: 0 },
        uTurnProb: { value: 0.5 },
        uFlowScale: { value: 1 },
        uFlowSpeed: { value: 0.1 },
        uSwirl: { value: 0 },
        uInject: { value: 0.05 },
        uVideoZoom: { value: 1 },
        uHueShift: { value: 0 },
        uAbstraction: { value: 0.5 },
        uGenMix: { value: 0 },
        uGenWarp: { value: 0 },
        uGenMask: { value: 0 },
        uGenGap: { value: 0.35 },
        uAuraColor: { value: new THREE.Vector3(1, 0.2, 0.1) },
        uColors: { value: paletteColors },
        uAuraMode: { value: 0 },
        uAuraHue: { value: 0.05 },
        uSilOpacity: { value: 0.75 },
        uSilTint: { value: 0.1 },
        uAura: { value: 0.6 },
        uAuraSize: { value: 0.5 },
        uAuraSpeed: { value: 0.5 },
        uMotion: { value: 0 },
        uAuraTime: { value: 0 },
        uMaskHist: { value: this.histTarget.texture },
        uHistTiles: { value: new THREE.Vector2(HIST_TILES.x, HIST_TILES.y) },
        uHistIdx: { value: 0 },
        uHistStep: { value: HIST_STEP },
        uAuraDelay: { value: 0 },
        uAuraMirror: { value: 0 },
        uAuraSpread: { value: 0 },
        uAuraGlow: { value: 0 },
      },
    });

    this.presentMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: presentFragment,
      uniforms: {
        uFeedback: { value: null },
        uTime: { value: 0 },
        uAspect: { value: new THREE.Vector2(1, 1) },
        uPalette: { value: 0.5 },
        uSat: { value: 0.36 },
        uPulse: { value: 0.5 },
        uEnergy: { value: 0 },
        uOnset: { value: 0 },
        uKaleido: { value: 0 },
        uKaleidoSpin: { value: 0 },
        uColors: { value: paletteColors },
      },
    });

    const kawaseUniforms = () => ({
      uTex: { value: null as THREE.Texture | null },
      uTexel: { value: new THREE.Vector2(1 / 2, 1 / 2) },
      uOffset: { value: 1 },
    });
    this.downMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: kawaseDownFragment,
      uniforms: kawaseUniforms(),
    });
    this.upMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: kawaseUpFragment,
      uniforms: kawaseUniforms(),
    });
    this.maskPrepMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: maskPrepFragment,
      uniforms: {
        uRaw: { value: null },
        uFit: { value: new THREE.Vector2(1, 1) },
        uInvert: { value: 0 },
      },
    });
    this.maskCopyMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: maskCopyFragment,
      uniforms: { uTex: { value: null } },
    });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: finalFragment,
      uniforms: {
        uScene: { value: null },
        uBlur: { value: null },
        uBlurMix: { value: 0 },
        uGrain: { value: 0.2 },
        uTime: { value: 0 },
      },
    });

    const quad = new THREE.PlaneGeometry(2, 2);
    this.scene.add(new THREE.Mesh(quad, this.flowMat));
    this.genScene.add(new THREE.Mesh(quad, this.genMat));
    this.presentScene.add(new THREE.Mesh(quad, this.presentMat));
    this.blurMesh = new THREE.Mesh(quad, this.downMat);
    this.blurScene.add(this.blurMesh);
    this.finalScene.add(new THREE.Mesh(quad, this.finalMat));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Feedback buffer scale relative to the canvas, live. Trails restart. */
  setResScale(scale: number) {
    if (!(scale > 0) || scale === this.resScale) return;
    this.resScale = scale;
    this.resize();
  }

  get resScaleValue(): number { return this.resScale; }

  /** Feedback buffer size in pixels. */
  get bufferSize(): { w: number; h: number } {
    return { w: this.targets[0].width, h: this.targets[0].height };
  }

  /** Starts a GPU timer query around this render if none is pending. */
  private beginGpuTimer() {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const ext = this.timerExt;
    if (!ext) return;
    if (this.timerQuery) {
      const done = gl.getQueryParameter(this.timerQuery, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      if (!done && !disjoint) return;
      if (done && !disjoint) {
        this.gpuMs = gl.getQueryParameter(this.timerQuery, gl.QUERY_RESULT) / 1e6;
      }
      gl.deleteQuery(this.timerQuery);
      this.timerQuery = null;
    }
    this.timerQuery = gl.createQuery();
    if (!this.timerQuery) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, this.timerQuery);
    this.timerActive = true;
  }

  private endGpuTimer() {
    if (!this.timerActive) return;
    (this.renderer.getContext() as WebGL2RenderingContext).endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this.timerActive = false;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    const fw = Math.max(2, Math.round(w * this.resScale));
    const fh = Math.max(2, Math.round(h * this.resScale));
    this.targets.forEach((t) => t.setSize(fw, fh));
    this.genTarget.setSize(fw, fh);
    this.sceneTarget.setSize(w, h);
    this.downs.forEach((t, i) => {
      const s = 2 ** (i + 1);
      t.setSize(Math.max(2, Math.round(w / s)), Math.max(2, Math.round(h / s)));
    });
    this.ups.forEach((t, i) => {
      const s = 2 ** (this.ups.length - i);
      t.setSize(Math.max(2, Math.round(w / s)), Math.max(2, Math.round(h / s)));
    });
    const aspect = w / h;
    this.aspect = aspect;
    (this.flowMat.uniforms.uAspect.value as THREE.Vector2).set(aspect, 1);
    (this.genMat.uniforms.uAspect.value as THREE.Vector2).set(aspect, 1);
    (this.presentMat.uniforms.uAspect.value as THREE.Vector2).set(aspect, 1);
    (this.flowMat.uniforms.uTexel.value as THREE.Vector2).set(1 / fw, 1 / fh);
    const mh = Math.max(2, Math.round(MASK_W / aspect));
    [1, 2, 4, 2, 1].forEach((s, i) => this.maskTargets[i].setSize(MASK_W / s, Math.round(mh / s)));
    this.setSourceAspect(this.sourceAspect);
    this.setMaskAspect(this.maskAspect);
  }

  /** Scale that crops a source of aspect `src` to cover the canvas ("cover" fit). */
  private coverFit(src: number, out: THREE.Vector2) {
    out.set(Math.min(1, this.aspect / src), Math.min(1, src / this.aspect));
  }

  /** Aspect (w/h) of the film source; anything not 16:9 is cropped, not stretched. */
  setSourceAspect(aspect: number) {
    if (!(aspect > 0)) return;
    this.sourceAspect = aspect;
    this.coverFit(aspect, this.flowMat.uniforms.uVideoFit.value as THREE.Vector2);
    this.coverFit(aspect, this.genMat.uniforms.uVideoFit.value as THREE.Vector2);
  }

  /** Aspect of the tracking camera, so the mask lands on the same crop. */
  setMaskAspect(aspect: number) {
    if (!(aspect > 0)) return;
    this.maskAspect = aspect;
    this.coverFit(aspect, this.maskPrepMat.uniforms.uFit.value as THREE.Vector2);
  }

  /** The shared WebGL renderer, for modules that render their own textures. */
  get gl(): THREE.WebGLRenderer { return this.renderer; }

  /** Linear filtering of float textures needs an extension; the tracker asks. */
  get floatLinear(): boolean {
    return this.renderer.extensions.has('OES_texture_float_linear');
  }

  setVideoTexture(tex: THREE.Texture | null) {
    this.flowMat.uniforms.uVideo.value = tex;
    this.flowMat.uniforms.uHasVideo.value = tex ? 1 : 0;
    this.genMat.uniforms.uVideo.value = tex;
    this.genMat.uniforms.uHasVideo.value = tex ? 1 : 0;
  }

  /** Performer movement 0..1: swells and widens the aura, speeds its waves. */
  setMotion(v: number) {
    this.motion = v;
    this.flowMat.uniforms.uMotion.value = v;
  }

  /** Raw tracker mask (camera-shaped). Null turns the performer layer off. */
  setMaskTexture(tex: THREE.Texture | null, invert = false) {
    this.rawMask = tex;
    this.maskPrepMat.uniforms.uInvert.value = invert ? 1 : 0;
    this.flowMat.uniforms.uHasMask.value = tex ? 1 : 0;
  }

  /** Cover-fit + soft ramp, then an optional dual-kawase smooth by silBlur. */
  private prepareMask(silBlur: number) {
    if (!this.rawMask) return;
    const [prep, d1, d2, u1, u2] = this.maskTargets;
    this.maskPrepMat.uniforms.uRaw.value = this.rawMask;
    this.blurMesh.material = this.maskPrepMat;
    this.renderer.setRenderTarget(prep);
    this.renderer.render(this.blurScene, this.camera);
    let tex: THREE.Texture = prep.texture;
    if (silBlur > 0.01) {
      const offset = 0.5 + silBlur * 3.0;
      tex = this.kawase(this.downMat, tex, d1, offset);
      tex = this.kawase(this.downMat, tex, d2, offset);
      tex = this.kawase(this.upMat, tex, u1, offset);
      tex = this.kawase(this.upMat, tex, u2, offset);
    }
    this.flowMat.uniforms.uMask.value = tex;
  }

  /** Every HIST_STEP seconds the prepared mask lands in the next atlas tile. */
  private recordMask(dt: number) {
    this.histAccum += dt;
    if (this.histAccum < HIST_STEP) return;
    this.histAccum = 0;
    this.histIdx = (this.histIdx + 1) % (HIST_TILES.x * HIST_TILES.y);
    const x = (this.histIdx % HIST_TILES.x) * HIST_TILE_W;
    const y = Math.floor(this.histIdx / HIST_TILES.x) * HIST_TILE_H;
    this.histTarget.viewport.set(x, y, HIST_TILE_W, HIST_TILE_H);
    this.histTarget.scissor.set(x, y, HIST_TILE_W, HIST_TILE_H);
    this.maskCopyMat.uniforms.uTex.value = this.flowMat.uniforms.uMask.value;
    this.blurMesh.material = this.maskCopyMat;
    this.renderer.setRenderTarget(this.histTarget);
    this.renderer.render(this.blurScene, this.camera);
    this.flowMat.uniforms.uHistIdx.value = this.histIdx;
  }

  private kawase(
    mat: THREE.ShaderMaterial, src: THREE.Texture, dst: THREE.WebGLRenderTarget, offset: number,
  ): THREE.Texture {
    this.blurMesh.material = mat;
    mat.uniforms.uTex.value = src;
    (mat.uniforms.uTexel.value as THREE.Vector2).set(1 / dst.width, 1 / dst.height);
    mat.uniforms.uOffset.value = offset;
    this.renderer.setRenderTarget(dst);
    this.renderer.render(this.blurScene, this.camera);
    return dst.texture;
  }

  render(frame: ControlFrame) {
    this.beginGpuTimer();
    this.renderPasses(frame);
    this.endGpuTimer();
  }

  private renderPasses(frame: ControlFrame) {
    const look = frame.look;
    const ov = frame.gen;

    // Overrides: a forced shader type turns the layer on even in looks that
    // ship without one; opacity 0.5 = the look's own level, 0 = off, 1 = 2x.
    const type = ov.type > 0 ? ov.type : look.gen;
    const opacity = ov.opacity * 2;
    const baseMix = ov.type > 0 ? Math.max(look.genMix, 0.5) : look.genMix;
    const baseWarp = ov.type > 0 ? Math.max(look.genWarp, 0.3) : look.genWarp;
    // estrellas gates the film instead of warping it: hard disc edges would
    // tear the sampling.
    const stars = type === GEN_TYPE_STARS;
    const genMix = type > 0 ? baseMix * opacity : 0;
    const genWarp = type > 0 && !stars ? baseWarp * opacity : 0;
    const genOn = type > 0 && genMix + genWarp > 0.001;

    // The layer keeps its own clock so the speed knob never jumps the phase.
    this.genTime += frame.dt * Math.pow(4, (ov.speed - 0.5) * 2);

    if (genOn) {
      const gu = this.genMat.uniforms;
      gu.uTime.value = this.genTime;
      gu.uZoom.value = Math.pow(3, (0.5 - ov.zoom) * 2);
      gu.uType.value = type;
      gu.uHue.value = rgbHue(this.paletteUniform[0]);
      // pulse gates the audio here too: at 0 the layer never flashes.
      gu.uEnergy.value = frame.audio.energy * frame.macros.pulse;
      gu.uOnset.value = frame.audio.onset * frame.macros.pulse;
      gu.uTurnProb.value = frame.wave.live ? frame.wave.turnProb : 0.6;
      gu.uVideoInf.value = ov.video;
      gu.uChaos.value = ov.chaos;
      gu.uMovement.value = ov.movement;
      gu.uQuantity.value = ov.quantity;
      gu.uSize.value = ov.size;
      this.renderer.setRenderTarget(this.genTarget);
      this.renderer.render(this.genScene, this.camera);
    }

    this.prepareMask(frame.cam.silBlur);
    if (this.rawMask) this.recordMask(frame.dt);
    // The aura's own clock: movement makes the colour waves race.
    this.auraTime += frame.dt * (1.0 + this.motion * 2.0);

    const fu = this.flowMat.uniforms;
    fu.uPrev.value = this.targets[this.current].texture;
    fu.uTime.value = frame.time;
    fu.uFlow.value = frame.macros.flow;
    fu.uFeed.value = frame.macros.feed;
    fu.uWash.value = frame.macros.wash;
    fu.uBlur.value = frame.macros.blur;
    fu.uPulse.value = frame.macros.pulse;
    fu.uEnergy.value = frame.audio.energy;
    fu.uOnset.value = frame.audio.onset;
    fu.uLow.value = frame.audio.low;
    fu.uTurnProb.value = frame.wave.live ? frame.wave.turnProb : 0.6;
    fu.uFlowScale.value = look.flowScale;
    fu.uFlowSpeed.value = look.flowSpeed;
    fu.uSwirl.value = look.swirl;
    fu.uInject.value = look.inject;
    fu.uVideoZoom.value = look.videoZoom;
    fu.uHueShift.value = look.hueShift;
    fu.uAbstraction.value = look.abstraction;
    fu.uGenMix.value = genOn ? genMix : 0;
    fu.uGenWarp.value = genOn ? genWarp : 0;
    fu.uGenMask.value = genOn && stars ? 1 : 0;
    fu.uGenGap.value = ov.video;
    (fu.uAuraColor.value as THREE.Vector3).copy(this.paletteUniform[0]);
    fu.uSilOpacity.value = frame.cam.silOpacity;
    fu.uSilTint.value = frame.cam.silTint;
    fu.uAura.value = frame.cam.aura;
    fu.uAuraSize.value = frame.cam.auraSize;
    fu.uAuraSpeed.value = frame.cam.auraSpeed;
    fu.uAuraMode.value = frame.cam.auraMode;
    fu.uAuraTime.value = this.auraTime;
    fu.uAuraDelay.value = frame.cam.auraDelay * HIST_MAX_DELAY;
    fu.uAuraMirror.value = frame.cam.auraMirror;
    fu.uAuraSpread.value = frame.cam.auraSpread;
    fu.uAuraGlow.value = frame.cam.auraGlow;
    // 0 -> frozen, 0.5 -> the old slow drift, 1 -> a full hue turn every ~4 s
    fu.uAuraHue.value = Math.pow(frame.cam.auraHue, 2.0) * 0.2 + Math.pow(frame.cam.auraHue, 6.0) * 1.4;

    const next = 1 - this.current;
    this.renderer.setRenderTarget(this.targets[next]);
    this.renderer.render(this.scene, this.camera);
    this.current = next;

    const pu = this.presentMat.uniforms;
    pu.uFeedback.value = this.targets[this.current].texture;
    pu.uTime.value = frame.time;
    pu.uPalette.value = frame.macros.palette;
    pu.uSat.value = frame.macros.sat;
    pu.uPulse.value = frame.macros.pulse;
    pu.uEnergy.value = frame.audio.energy;
    pu.uOnset.value = frame.audio.onset;
    pu.uKaleido.value = look.kaleido;
    pu.uKaleidoSpin.value = look.kaleidoSpin;
    this.renderer.setRenderTarget(this.sceneTarget);
    this.renderer.render(this.presentScene, this.camera);

    // End-of-chain blur: dual-kawase pyramid, offset and mix from the macro.
    const blur = frame.macros.blur;
    let blurTex: THREE.Texture = this.sceneTarget.texture;
    if (blur > 0.01) {
      const offset = 0.5 + blur * 1.8;
      let src = this.sceneTarget.texture;
      for (const t of this.downs) src = this.kawase(this.downMat, src, t, offset);
      for (const t of this.ups) src = this.kawase(this.upMat, src, t, offset);
      blurTex = src;
    }

    // Final pass: blend sharp/cloudy, grain last, to screen.
    const fin = this.finalMat.uniforms;
    fin.uScene.value = this.sceneTarget.texture;
    fin.uBlur.value = blurTex;
    // gentle at the bottom, full cloud at the top
    fin.uBlurMix.value = Math.min(1, Math.pow(blur, 1.6) * 1.35);
    fin.uGrain.value = frame.macros.grain;
    fin.uTime.value = frame.time;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.finalScene, this.camera);
  }
}

function rgbHue(c: THREE.Vector3): number {
  const max = Math.max(c.x, c.y, c.z);
  const min = Math.min(c.x, c.y, c.z);
  const d = max - min;
  if (d < 1e-5) return 0;
  let h: number;
  if (max === c.x) h = ((c.y - c.z) / d) % 6;
  else if (max === c.y) h = (c.z - c.x) / d + 2;
  else h = (c.x - c.y) / d + 4;
  return (h / 6 + 1) % 1;
}
