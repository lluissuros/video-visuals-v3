// Shared contracts. Everything the engine reads each frame is a ControlFrame;
// everything that produces control data implements one of the provider interfaces.
// New input hardware (MIDI, OSC, sensors) writes into the bus, never into the engine.

/** The expressive macros. Every value is 0..1. */
export interface Macros {
  /** How hard the flow field displaces the image. */
  flow: number;
  /** Trail persistence of the feedback buffer. */
  feed: number;
  /** Dreaminess: slow zoom into the feedback. */
  wash: number;
  /** Diffusion radius: melts hard and pixelated edges. */
  blur: number;
  /** How hard colors snap to the extracted movie palette. */
  palette: number;
  /** Saturation, up to way-too-much on purpose. */
  sat: number;
  /** Depth of audio modulation on top of everything. */
  pulse: number;
  /** Film grain and noise floor. */
  grain: number;
}

export const MACRO_NAMES: (keyof Macros)[] = [
  'flow', 'feed', 'wash', 'blur', 'palette', 'sat', 'pulse', 'grain',
];

export interface AudioSignals {
  /** Smoothed overall energy 0..1. */
  energy: number;
  low: number;
  mid: number;
  high: number;
  /** 1 on a transient, decays fast. */
  onset: number;
}

/** Wave structure: what the granulizer (or the simulator) is doing. */
export interface WaveState {
  /** Per-song probability 0..1. Empty when no structure source is live. */
  waves: number[];
  /** Index of the song holding the turn, -1 when none. */
  turnIndex: number;
  /** The winner's probability (its wave height). */
  turnProb: number;
  /** True while the source is connected and rotating. */
  live: boolean;
}

/** Live overrides for the generative layer, adjustable from the panel and
 *  saved in presets. All 0..1; 0.5 means "neutral" for the multipliers. */
export interface GenOverrides {
  /** 0 = use the scene's own shader; 1..6 pick one explicitly. */
  type: number;
  /** Time multiplier: 0 -> 0.25x, 0.5 -> 1x, 1 -> 4x. */
  speed: number;
  /** Spatial zoom: 0 -> 0.33x, 0.5 -> 1x, 1 -> 3x. */
  zoom: number;
  /** Multiplies the scene's genMix/genWarp: 0 -> off, 0.5 -> 1x, 1 -> 2x. */
  opacity: number;
  /** How much the source video tints and gates the fractal. */
  video: number;
}

export const GEN_TYPE_NAMES = [
  'escena', 'tunel', 'pliegue', 'kali', 'columnas', 'olas', 'orbita',
  'vidrio', 'solar',
];

/** Performer-camera parameters, adjustable from the panel, saved in presets.
 *  All 0..1. */
export interface CamParams {
  /** Silhouette presence: 0 = invisible, 1 = solid dark figure. */
  silOpacity: number;
  /** Body fill: 0 = dark, 1 = filled with the aura color. */
  silTint: number;
  /** Emanation strength. */
  aura: number;
  /** Halo reach around the body. */
  auraSize: number;
  /** How fast the color waves travel outward. */
  auraSpeed: number;
}

export const DEFAULT_CAM: CamParams = {
  silOpacity: 0.75,
  silTint: 0.1,
  aura: 0.6,
  auraSize: 0.5,
  auraSpeed: 0.5,
};

export interface ControlFrame {
  time: number;
  dt: number;
  macros: Macros;
  audio: AudioSignals;
  wave: WaveState;
  /** Active visual scene index. Changes are instant; the feedback buffer
   *  carries the visual continuity. */
  scene: number;
  gen: GenOverrides;
  cam: CamParams;
}

export interface ScenePreset {
  name: string;
  /** Spatial scale of the flow noise. */
  flowScale: number;
  /** Speed of flow evolution. */
  flowSpeed: number;
  /** -1..1, constant angular drift added to the flow. */
  swirl: number;
  /** How much fresh video is injected per frame, 0..1. */
  inject: number;
  /** Zoom applied to the video sample, 1 = full frame. */
  videoZoom: number;
  /** Hue rotation applied to injected video, radians. */
  hueShift: number;
  /** 0 = keep video luma, 1 = pure palette fields. */
  abstraction: number;
  /** Generative fractal layer: 0 off, 1 tunel, 2 pliegue, 3 kali. */
  gen: number;
  /** How much fractal light injects into the feedback. */
  genMix: number;
  /** How much the fractal field warps the video sampling. */
  genWarp: number;
  /** Kaleidoscope sectors on the output, 0 = off. */
  kaleido: number;
  /** Kaleidoscope rotation speed, radians/second. */
  kaleidoSpin: number;
}
