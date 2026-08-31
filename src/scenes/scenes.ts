// Visual scene presets. The sequencer maps the granulizer's turn index onto
// these in series (song 1 -> scene 1, song 2 -> scene 2, ...), wrapping when
// there are more songs than scenes. Each preset changes the CHARACTER of the
// flow, not the macro sliders - macros stay in the performer's hands.

import type { ScenePreset } from '../types';

export const SCENES: ScenePreset[] = [
  {
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
    name: 'vortice',     // tight swirl, palette fields, almost no image left
    flowScale: 2.8,
    flowSpeed: 0.2,
    swirl: 0.8,
    inject: 0.045,
    videoZoom: 2.4,
    hueShift: -0.4,
    abstraction: 0.85,
  },
  {
    name: 'respira',     // near-still, breathing color washes
    flowScale: 0.4,
    flowSpeed: 0.03,
    swirl: 0.0,
    inject: 0.08,
    videoZoom: 1.2,
    hueShift: 0.1,
    abstraction: 0.7,
  },
];

export function lerpScene(a: ScenePreset, b: ScenePreset, t: number): ScenePreset {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    name: t < 0.5 ? a.name : b.name,
    flowScale: l(a.flowScale, b.flowScale),
    flowSpeed: l(a.flowSpeed, b.flowSpeed),
    swirl: l(a.swirl, b.swirl),
    inject: l(a.inject, b.inject),
    videoZoom: l(a.videoZoom, b.videoZoom),
    hueShift: l(a.hueShift, b.hueShift),
    abstraction: l(a.abstraction, b.abstraction),
  };
}
