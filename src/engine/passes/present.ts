// Present pass: feedback buffer -> screen. Palette remap, tone shaping,
// vignette, grain. Display-only, so turning the palette knob down always
// recovers the untouched feedback colors.

import { NOISE } from './glsl';

export const presentFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uFeedback;
uniform sampler2D uMask;
uniform float uHasMask;
uniform float uTime;

uniform float uPalette;   // macro: remap strength
uniform float uGrain;     // macro
uniform float uPulse;
uniform float uEnergy;
uniform float uOnset;

uniform vec3 uColors[5];  // extracted movie palette, most saturated first

${NOISE}

vec3 nearestPaletteMix(vec3 c) {
  float bestD = 1e9;
  float secondD = 1e9;
  vec3 best = c;
  vec3 second = c;
  for (int i = 0; i < 5; i++) {
    float d = dot(c - uColors[i], c - uColors[i]);
    if (d < bestD) {
      secondD = bestD; second = best;
      bestD = d; best = uColors[i];
    } else if (d < secondD) {
      secondD = d; second = uColors[i];
    }
  }
  // Blend the two nearest by inverse distance: fields instead of hard bands.
  float w = secondD / max(bestD + secondD, 1e-6);
  return mix(second, best, w);
}

void main() {
  vec2 uv = vUv;
  vec3 c = texture2D(uFeedback, uv).rgb;

  // remap toward the movie's own colors, keeping the buffer's luma so motion
  // stays readable even at full remap
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 mapped = nearestPaletteMix(c);
  float mappedLuma = dot(mapped, vec3(0.299, 0.587, 0.114));
  mapped *= (luma + 0.05) / (mappedLuma + 0.05);
  c = mix(c, mapped, uPalette);

  // exposure + soft-knee tonemap: lifts the dark movie material without
  // clipping the trails; audio adds a touch on top
  c *= 1.9 + uEnergy * uPulse * 0.8 + uOnset * uPulse * 0.3;
  c = c / (1.0 + c) * 1.55;
  // mild saturation push, the palette deserves it
  float l2 = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l2), c, 1.25);

  // performers: keep them dark holes with a warm rim (the aura around them is
  // already in the feedback)
  if (uHasMask > 0.5) {
    float m = texture2D(uMask, uv).r;
    c *= 1.0 - m * 0.85;
  }

  // vignette
  vec2 d = uv - 0.5;
  c *= 1.0 - dot(d, d) * 0.4;

  // grain
  float g = hash12(uv * 1371.0 + fract(uTime) * 917.0) - 0.5;
  c += g * uGrain * 0.14;

  gl_FragColor = vec4(c, 1.0);
}
`;
