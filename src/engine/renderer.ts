// The render engine: a ping-pong feedback buffer driven by the flow pass,
// presented through the grade pass. It knows nothing about WHERE control
// values come from - it consumes a ControlFrame and a lerped ScenePreset.

import * as THREE from 'three';
import type { ControlFrame } from '../types';
import { SCENES, lerpScene } from '../scenes/scenes';
import { flowVertex, flowFragment } from './passes/flow';
import { presentFragment } from './passes/present';

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private presentScene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current = 0;
  private flowMat: THREE.ShaderMaterial;
  private presentMat: THREE.ShaderMaterial;
  private resScale: number;
  private paletteUniform: THREE.Vector3[];

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

    this.flowMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: flowFragment,
      uniforms: {
        uPrev: { value: null },
        uVideo: { value: null },
        uMask: { value: null },
        uHasVideo: { value: 0 },
        uHasMask: { value: 0 },
        uAspect: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uFlow: { value: 0 },
        uFeed: { value: 0 },
        uWash: { value: 0 },
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
        uAuraColor: { value: new THREE.Vector3(1, 0.2, 0.1) },
      },
    });

    this.presentMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: presentFragment,
      uniforms: {
        uFeedback: { value: null },
        uMask: { value: null },
        uHasMask: { value: 0 },
        uTime: { value: 0 },
        uPalette: { value: 0.5 },
        uGrain: { value: 0.2 },
        uPulse: { value: 0.5 },
        uEnergy: { value: 0 },
        uOnset: { value: 0 },
        uColors: { value: paletteColors },
      },
    });

    const quad = new THREE.PlaneGeometry(2, 2);
    this.scene.add(new THREE.Mesh(quad, this.flowMat));
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
    (this.flowMat.uniforms.uAspect.value as THREE.Vector2).set(w / h, 1);
  }

  setVideoTexture(tex: THREE.Texture | null) {
    this.flowMat.uniforms.uVideo.value = tex;
    this.flowMat.uniforms.uHasVideo.value = tex ? 1 : 0;
  }

  setMaskTexture(tex: THREE.Texture | null) {
    this.flowMat.uniforms.uMask.value = tex;
    this.flowMat.uniforms.uHasMask.value = tex ? 1 : 0;
    this.presentMat.uniforms.uMask.value = tex;
    this.presentMat.uniforms.uHasMask.value = tex ? 1 : 0;
  }

  render(frame: ControlFrame) {
    const preset = lerpScene(
      SCENES[frame.sceneA],
      SCENES[frame.sceneB],
      smooth(frame.sceneMix),
    );

    const fu = this.flowMat.uniforms;
    fu.uPrev.value = this.targets[this.current].texture;
    fu.uTime.value = frame.time;
    fu.uFlow.value = frame.macros.flow;
    fu.uFeed.value = frame.macros.feed;
    fu.uWash.value = frame.macros.wash;
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
    (fu.uAuraColor.value as THREE.Vector3).copy(this.paletteUniform[0]);

    const next = 1 - this.current;
    this.renderer.setRenderTarget(this.targets[next]);
    this.renderer.render(this.scene, this.camera);
    this.current = next;

    const pu = this.presentMat.uniforms;
    pu.uFeedback.value = this.targets[this.current].texture;
    pu.uTime.value = frame.time;
    pu.uPalette.value = frame.macros.palette;
    pu.uGrain.value = frame.macros.grain;
    pu.uPulse.value = frame.macros.pulse;
    pu.uEnergy.value = frame.audio.energy;
    pu.uOnset.value = frame.audio.onset;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.presentScene, this.camera);
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
