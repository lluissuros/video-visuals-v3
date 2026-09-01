// The render engine: an optional generative fractal pass, a ping-pong feedback
// buffer driven by the flow pass, presented through the grade pass. It knows
// nothing about WHERE control values come from - it consumes a ControlFrame
// and the active ScenePreset.

import * as THREE from 'three';
import type { ControlFrame } from '../types';
import { SCENES } from '../scenes/scenes';
import { flowVertex, flowFragment } from './passes/flow';
import { presentFragment } from './passes/present';
import { genFragment } from './passes/generative';

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private genScene = new THREE.Scene();
  private presentScene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private genTarget: THREE.WebGLRenderTarget;
  private current = 0;
  private flowMat: THREE.ShaderMaterial;
  private genMat: THREE.ShaderMaterial;
  private presentMat: THREE.ShaderMaterial;
  private resScale: number;
  private paletteUniform: THREE.Vector3[];
  private genTime = 0;

  constructor(canvas: HTMLCanvasElement, resScale: number, paletteColors: THREE.Vector3[]) {
    this.resScale = resScale;
    this.paletteUniform = paletteColors;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1); // the feedback look does not need retina

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
        uAuraColor: { value: new THREE.Vector3(1, 0.2, 0.1) },
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
        uGrain: { value: 0.2 },
        uPulse: { value: 0.5 },
        uEnergy: { value: 0 },
        uOnset: { value: 0 },
        uKaleido: { value: 0 },
        uKaleidoSpin: { value: 0 },
        uColors: { value: paletteColors },
      },
    });

    const quad = new THREE.PlaneGeometry(2, 2);
    this.scene.add(new THREE.Mesh(quad, this.flowMat));
    this.genScene.add(new THREE.Mesh(quad, this.genMat));
    this.presentScene.add(new THREE.Mesh(quad, this.presentMat));

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    const fw = Math.max(2, Math.round(w * this.resScale));
    const fh = Math.max(2, Math.round(h * this.resScale));
    this.targets.forEach((t) => t.setSize(fw, fh));
    this.genTarget.setSize(fw, fh);
    const aspect = w / h;
    (this.flowMat.uniforms.uAspect.value as THREE.Vector2).set(aspect, 1);
    (this.genMat.uniforms.uAspect.value as THREE.Vector2).set(aspect, 1);
    (this.presentMat.uniforms.uAspect.value as THREE.Vector2).set(aspect, 1);
    (this.flowMat.uniforms.uTexel.value as THREE.Vector2).set(1 / fw, 1 / fh);
  }

  setVideoTexture(tex: THREE.Texture | null) {
    this.flowMat.uniforms.uVideo.value = tex;
    this.flowMat.uniforms.uHasVideo.value = tex ? 1 : 0;
    this.genMat.uniforms.uVideo.value = tex;
    this.genMat.uniforms.uHasVideo.value = tex ? 1 : 0;
  }

  setMaskTexture(tex: THREE.Texture | null) {
    this.flowMat.uniforms.uMask.value = tex;
    this.flowMat.uniforms.uHasMask.value = tex ? 1 : 0;
  }

  render(frame: ControlFrame) {
    const preset = SCENES[frame.scene];
    const ov = frame.gen;

    // Overrides: a forced shader type turns the layer on even in scenes that
    // ship without one; opacity 0.5 = the scene's own level, 0 = off, 1 = 2x.
    const type = ov.type > 0 ? ov.type : preset.gen;
    const opacity = ov.opacity * 2;
    const baseMix = ov.type > 0 ? Math.max(preset.genMix, 0.5) : preset.genMix;
    const baseWarp = ov.type > 0 ? Math.max(preset.genWarp, 0.3) : preset.genWarp;
    const genMix = type > 0 ? baseMix * opacity : 0;
    const genWarp = type > 0 ? baseWarp * opacity : 0;
    const genOn = type > 0 && genMix + genWarp > 0.001;

    // The layer keeps its own clock so the speed knob never jumps the phase.
    this.genTime += frame.dt * Math.pow(4, (ov.speed - 0.5) * 2);

    if (genOn) {
      const gu = this.genMat.uniforms;
      gu.uTime.value = this.genTime;
      gu.uZoom.value = Math.pow(3, (0.5 - ov.zoom) * 2);
      gu.uType.value = type;
      gu.uHue.value = rgbHue(this.paletteUniform[0]);
      gu.uEnergy.value = frame.audio.energy;
      gu.uOnset.value = frame.audio.onset;
      gu.uTurnProb.value = frame.wave.live ? frame.wave.turnProb : 0.6;
      gu.uVideoInf.value = ov.video;
      this.renderer.setRenderTarget(this.genTarget);
      this.renderer.render(this.genScene, this.camera);
    }

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
    fu.uFlowScale.value = preset.flowScale;
    fu.uFlowSpeed.value = preset.flowSpeed;
    fu.uSwirl.value = preset.swirl;
    fu.uInject.value = preset.inject;
    fu.uVideoZoom.value = preset.videoZoom;
    fu.uHueShift.value = preset.hueShift;
    fu.uAbstraction.value = preset.abstraction;
    fu.uGenMix.value = genOn ? genMix : 0;
    fu.uGenWarp.value = genOn ? genWarp : 0;
    (fu.uAuraColor.value as THREE.Vector3).copy(this.paletteUniform[0]);

    const next = 1 - this.current;
    this.renderer.setRenderTarget(this.targets[next]);
    this.renderer.render(this.scene, this.camera);
    this.current = next;

    const pu = this.presentMat.uniforms;
    pu.uFeedback.value = this.targets[this.current].texture;
    pu.uTime.value = frame.time;
    pu.uPalette.value = frame.macros.palette;
    pu.uSat.value = frame.macros.sat;
    pu.uGrain.value = frame.macros.grain;
    pu.uPulse.value = frame.macros.pulse;
    pu.uEnergy.value = frame.audio.energy;
    pu.uOnset.value = frame.audio.onset;
    pu.uKaleido.value = preset.kaleido;
    pu.uKaleidoSpin.value = preset.kaleidoSpin;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.presentScene, this.camera);
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
