// Display chain, all display-only (turning a knob down always recovers the
// untouched feedback):
//   present: kaleidoscope fold, palette remap, tone shaping, vignette
//   dual-kawase down/up passes: the blur macro, applied at the END of the
//     chain (per XorDev's "Blur Philosophy": downscale + few linear taps
//     per pass scales to huge, cloudy radii for almost nothing)
//   final: mix sharp/blurred, then grain last.

import { NOISE } from './glsl';

export const presentFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uFeedback;
uniform float uTime;
uniform vec2 uAspect;

uniform float uPalette;   // macro: remap strength
uniform float uSat;       // macro: saturation, way past tasteful on purpose
uniform float uPulse;
uniform float uEnergy;
uniform float uOnset;

uniform float uKaleido;      // sectors, 0 = off
uniform float uKaleidoSpin;  // radians/second

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

  // kaleidoscope: fold the angle into 2N mirrored sectors, slowly turning.
  // The radius ripples too, so the center pulls in content instead of showing
  // one flat disc of whatever sits mid-frame.
  if (uKaleido > 0.5) {
    vec2 d = (uv - 0.5) * uAspect;
    float R = length(d);
    float a = atan(d.y, d.x) + uTime * uKaleidoSpin;
    float sector = 3.14159265 / uKaleido;
    a = abs(mod(a, sector * 2.0) - sector);
    R = R * (0.7 + 0.3 * cos(R * 14.0 - uTime * 0.13)) + 0.05;
    d = vec2(cos(a), sin(a)) * R;
    uv = d / uAspect + 0.5;
  }

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
  // saturation: 0 -> grayscale, 0.29 -> neutral, 1 -> violent
  float l2 = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l2), c, uSat * 3.5);

  // vignette
  vec2 dv = uv - 0.5;
  c *= 1.0 - dot(dv, dv) * 0.4;

  gl_FragColor = vec4(c, 1.0);
}
`;

// Dual-kawase blur, downsample half: 5 linear taps at each halved resolution.
export const kawaseDownFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uOffset;
void main() {
  vec2 o = uTexel * uOffset;
  vec3 c = texture2D(uTex, vUv).rgb * 4.0;
  c += texture2D(uTex, vUv + vec2( o.x,  o.y)).rgb;
  c += texture2D(uTex, vUv + vec2(-o.x,  o.y)).rgb;
  c += texture2D(uTex, vUv + vec2( o.x, -o.y)).rgb;
  c += texture2D(uTex, vUv + vec2(-o.x, -o.y)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}
`;

// Dual-kawase blur, upsample half: 8 taps in a diamond.
export const kawaseUpFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uOffset;
void main() {
  vec2 o = uTexel * uOffset;
  vec3 c  = texture2D(uTex, vUv + vec2(-o.x * 2.0, 0.0)).rgb;
  c += texture2D(uTex, vUv + vec2(-o.x,  o.y)).rgb * 2.0;
  c += texture2D(uTex, vUv + vec2(0.0,  o.y * 2.0)).rgb;
  c += texture2D(uTex, vUv + vec2( o.x,  o.y)).rgb * 2.0;
  c += texture2D(uTex, vUv + vec2( o.x * 2.0, 0.0)).rgb;
  c += texture2D(uTex, vUv + vec2( o.x, -o.y)).rgb * 2.0;
  c += texture2D(uTex, vUv + vec2(0.0, -o.y * 2.0)).rgb;
  c += texture2D(uTex, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  gl_FragColor = vec4(c / 12.0, 1.0);
}
`;

// Last pass on screen: blend the graded image with its cloudy blur, then
// grain - the one thing that stays on top of everything.
export const finalFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBlur;
uniform float uBlurMix;
uniform float uGrain;
uniform float uTime;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 sharp = texture2D(uScene, vUv).rgb;
  vec3 soft = texture2D(uBlur, vUv).rgb;
  vec3 c = mix(sharp, soft, uBlurMix);
  float g = hash12(vUv * 1371.0 + fract(uTime) * 917.0) - 0.5;
  c += g * uGrain * 0.14;
  gl_FragColor = vec4(c, 1.0);
}
`;
