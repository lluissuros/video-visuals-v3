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
  /** 0 = the preset's base shader (Look.gen, often none); 1.. pick one explicitly. */
  type: number;
  /** Time multiplier: 0 -> 0.25x, 0.5 -> 1x, 1 -> 4x. */
  speed: number;
  /** Spatial zoom: 0 -> 0.33x, 0.5 -> 1x, 1 -> 3x. */
  zoom: number;
  /** Multiplies the look's genMix/genWarp: 0 -> off, 0.5 -> 1x, 1 -> 2x. */
  opacity: number;
  /** How much the source video tints and gates the fractal. For estrellas:
   *  brightness of the film between the dots (0 = film only through the dots). */
  video: number;
  /** estrellas: 0 = a regular grid of dots, 1 = jittered, layered, warped. */
  chaos: number;
  /** estrellas: share of the stars that wander (0 = all still). */
  movement: number;
  /** estrellas: star density. */
  quantity: number;
  /** estrellas: dot radius relative to its cell. */
  size: number;
}

export const DEFAULT_GEN: GenOverrides = {
  type: 0, speed: 0.5, zoom: 0.5, opacity: 0.5, video: 0.35,
  chaos: 0.5, movement: 0.3, quantity: 0.5, size: 0.4,
};

export const GEN_TYPE_NAMES = [
  'base', 'tunel', 'pliegue', 'kali', 'columnas', 'olas', 'orbita',
  'vidrio', 'solar', 'estrellas',
];
/** Index of the star layer in GEN_TYPE_NAMES; its extra knobs only show for it. */
export const GEN_TYPE_STARS = GEN_TYPE_NAMES.indexOf('estrellas');

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
  /** Mask smoothing: softens silhouette and aura edges (GPU blur of the mask). */
  silBlur: number;
  /** Aura colors: 0 = rainbow around the main palette color, 1 = the palette itself. */
  auraMode: number;
  /** How fast the aura (and body tint) colors change: 0 = frozen, 0.5 = slow drift. */
  auraHue: number;
  /** How much performer movement swells the aura. 0 = the aura ignores motion. */
  motion: number;
  /** Max delay of the shadow silhouettes: 0 = all move with the body, 1 = up to 10 s behind. */
  auraDelay: number;
  /** Share of the 8 shadows mirrored to the other side of the screen. */
  auraMirror: number;
  /** Colour spread between shadows: 0 = all the same colour, 1 = a full hue turn. */
  auraSpread: number;
  /** Volumetric contour glow (saturated raymarch toward the body). */
  auraGlow: number;
  /** People the tracker looks for: 0 = 1 person, 1 = 4 (posesFromParam). */
  poses: number;
  /** How sure the model must be before a shape counts as a body. Raise it when
   *  the camera sees the projection and invents performers. */
  confidence: number;
}

export const AURA_MODE_NAMES = ['arcoíris', 'paleta'];

export const DEFAULT_CAM: CamParams = {
  silOpacity: 0.75,
  silTint: 0.1,
  aura: 0.6,
  auraSize: 0.5,
  auraSpeed: 0.5,
  silBlur: 0.3,
  auraMode: 0,
  auraHue: 0.5,
  motion: 0.4,
  auraDelay: 0,
  auraMirror: 0,
  auraSpread: 0,
  auraGlow: 0,
  poses: 1 / 3,
  confidence: 0.5,
};

export interface ControlFrame {
  time: number;
  dt: number;
  macros: Macros;
  audio: AudioSignals;
  wave: WaveState;
  /** The character block the active preset carries. */
  look: Look;
  gen: GenOverrides;
  cam: CamParams;
}

/** The character of the piece under the macros: flow field, injection,
 *  kaleidoscope and a base generative layer. Not editable from the panel; each
 *  preset carries one (migrated from the old fixed scene table). */
export interface Look {
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

/** Slow ember drift, close to the film (the old first scene). */
export const DEFAULT_LOOK: Look = {
  flowScale: 1.6, flowSpeed: 0.06, swirl: 0.1, inject: 0.1, videoZoom: 1.0,
  hueShift: 0.0, abstraction: 0.35, gen: 0, genMix: 0, genWarp: 0,
  kaleido: 0, kaleidoSpin: 0,
};
