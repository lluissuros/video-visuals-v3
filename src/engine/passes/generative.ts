// Generative fractal layer, after Yohei Nishitsuji's minimal raymarchers
// (tympanus.net/codrops "Rendering the Simulation Theory"): nested loops, trig
// interference instead of noise, log-polar space for infinite zoom, HSV glow
// accumulated along the ray. Written fresh here, tuned to be driven: uHue
// follows the movie palette, uEnergy is the music.
//
// Output: rgb = light to inject into the feedback, a = scalar field the flow
// pass uses to WARP the video sampling (this is what intertwines the two).

import { NOISE } from './glsl';

export const genFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform vec2 uAspect;
uniform float uTime;
uniform int uType;      // 1 tunel, 2 pliegue, 3 kali
uniform float uHue;     // base hue, from the extracted palette
uniform float uEnergy;
uniform float uOnset;
uniform float uTurnProb;

${NOISE}

// Interference tunnel: log-polar raymarch, trig-interference detail. The
// log2(length) axis makes the zoom endless; atan closes it into a tube.
vec4 tunel(vec2 uv, float t) {
  vec3 col = vec3(0.0);
  float e = 0.01, R = 1.0, s = 1.0, fieldAcc = 0.0;
  vec3 q = vec3(0.0, -1.0, -1.0);
  vec3 d = vec3(uv, 1.0);
  vec3 p;
  for (float i = 1.0; i < 56.0; i++) {
    col += hsv(uHue + R * 0.02, clamp(0.4 + R * 0.15, 0.0, 0.85),
               max(min(e * s, 0.65 - e), 0.0) / 60.0);
    s = 1.0;
    p = q += d * e * R * 0.3;
    R = max(length(p), 1e-4);
    p = vec3(log2(R) - t * 0.35, exp2(-p.z / R + 0.9), atan(p.y, p.x) + t * 0.15);
    p.y -= 1.0;
    e = p.y;
    for (; s < 250.0; s += s)
      e += dot(sin(p.xy * s) - 0.5, 0.5 - sin(p.zy * s)) / s * 0.3;
    fieldAcc += e;
  }
  col = tanh(col * 0.8) * 0.55;
  return vec4(col, clamp(fieldAcc * 0.15, 0.0, 1.0));
}

// Folded filaments: repeated abs-fold + rotation, exponential glow where the
// orbit lands near the surface. Sharp neon threads.
vec4 pliegue(vec2 uv, float t) {
  vec3 col = vec3(0.0);
  float g = 0.4, e, fieldAcc = 0.0;
  mat3 M = rot3(0.55 + sin(t * 0.13) * 0.05, vec3(1.0, 3.0, 1.5));
  vec3 f = vec3(1.05 + 0.25 * cos(t * 0.21), 1.9, 1.15);
  for (float i = 0.0; i < 60.0; i++) {
    vec3 p = vec3(uv * g, g - 3.0);
    p.zy *= rot2(t * 0.1);
    for (int j = 0; j < 7; j++) {
      p = abs(p + p) - f;
      p = M * p;
    }
    e = (length(p.yz) * 5.0 - 6.0) / 900.0;
    g += max(e, 1e-3);
    float hit = exp(-max(e, 0.0) * 800.0);
    col += hit * hsv(uHue + 0.45 + g * 0.02, 0.75, 0.011 + uEnergy * 0.008);
    fieldAcc += hit;
  }
  col = tanh(col * 1.2) * 0.5;
  return vec4(col, clamp(fieldAcc * 0.08, 0.0, 1.0));
}

// Kali IFS lace: 2D orbit trap, cheap and dense. More a living texture than a
// space - the best of the three as a warp field.
vec4 kali(vec2 uv, float t) {
  vec2 z = uv * (1.3 + 0.2 * sin(t * 0.043));
  z *= rot2(t * 0.04);
  vec2 c = vec2(0.84 + 0.09 * sin(t * 0.11), 0.62 + 0.07 * cos(t * 0.073));
  float trap = 1e9, tr2 = 1e9;
  for (int i = 0; i < 13; i++) {
    z = abs(z) / max(dot(z, z), 1e-6) - c;
    trap = min(trap, abs(z.y));
    tr2 = min(tr2, length(z - vec2(0.3, 0.2)));
  }
  float v = exp(-trap * 6.0);
  vec3 col = hsv(uHue + tr2 * 0.25, 0.65, v * (0.16 + uEnergy * 0.12));
  return vec4(col, v);
}

void main() {
  vec2 uv = (vUv - 0.5) * uAspect * 2.0;
  float t = uTime * (1.0 + uEnergy * 0.4) ;
  vec4 g;
  if (uType == 1)      g = tunel(uv, t);
  else if (uType == 2) g = pliegue(uv, t);
  else                 g = kali(uv, t);
  // onset flashes the layer a touch
  g.rgb *= 0.75 + uTurnProb * 0.5 + uOnset * 0.6;
  gl_FragColor = g;
}
`;
