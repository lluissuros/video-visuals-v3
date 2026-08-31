// Visual scene presets. The sequencer maps the granulizer's turn index onto
// these in series (song 1 -> scene 1, song 2 -> scene 2, ...), wrapping when
// there are more songs than scenes. Scene changes are instant - the feedback
// buffer morphs the image organically, no crossfade needed. Each preset
// changes the CHARACTER of the piece, not the macro sliders.

import type { ScenePreset } from '../types';

const base = {
  gen: 0,
  genMix: 0,
  genWarp: 0,
  kaleido: 0,
  kaleidoSpin: 0,
};

export const SCENES: ScenePreset[] = [
  {
    ...base,
    name: 'ascua',       // slow ember drift, close to the film
    flowScale: 1.6,
    flowSpeed: 0.06,
    swirl: 0.1,
    inject: 0.1,
    videoZoom: 1.0,
    hueShift: 0.0,
    abstraction: 0.35,
  },
  {
    ...base,
    name: 'marea',       // broad lateral waves, half abstract
    flowScale: 0.7,
    flowSpeed: 0.12,
    swirl: -0.35,
    inject: 0.06,
    videoZoom: 1.6,
    hueShift: 0.25,
    abstraction: 0.6,
  },
  {
    ...base,
    name: 'espejo',      // kaleidoscope over the film, slowly turning
    flowScale: 1.3,
    flowSpeed: 0.08,
    swirl: 0.3,
    inject: 0.14,
    videoZoom: 2.0,
    hueShift: 0.1,
    abstraction: 0.3,
    kaleido: 8,
    kaleidoSpin: 0.05,
  },
  {
    ...base,
    name: 'cueva',       // fractal filaments intertwined with the film
    flowScale: 1.4,
    flowSpeed: 0.1,
    swirl: 0.15,
    inject: 0.05,
    videoZoom: 1.8,
    hueShift: -0.2,
    abstraction: 0.7,
    gen: 2,
    genMix: 0.5,
    genWarp: 0.8,
  },
  {
    ...base,
    name: 'puro',        // generative only: the interference tunnel
    flowScale: 0.9,
    flowSpeed: 0.05,
    swirl: 0.05,
    inject: 0.0,
    videoZoom: 1.0,
    hueShift: 0.0,
    abstraction: 1.0,
    gen: 1,
    genMix: 1.0,
    genWarp: 0.2,
  },
  {
    ...base,
    name: 'respira',     // near-still, breathing color washes
    flowScale: 0.4,
    flowSpeed: 0.03,
    swirl: 0.0,
    inject: 0.08,
    videoZoom: 1.2,
    hueShift: 0.1,
    abstraction: 0.7,
    gen: 3,
    genMix: 0.15,
    genWarp: 0.35,
  },
];
