// Generative fractal layer, after Yohei Nishitsuji's minimal raymarchers
// (tympanus.net/codrops "Rendering the Simulation Theory"): nested loops, trig
// interference instead of noise, log-polar space for infinite zoom, HSV glow
// accumulated along the ray. Written fresh here, tuned to be driven: uHue
// follows the movie palette, uEnergy is the music, uVideoInf lets the source
// video tint and gate the fractal so the two share shapes and colors.
//
// Output: rgb = light to inject into the feedback, a = scalar field the flow
// pass uses to WARP the video sampling (this is what intertwines the two).
//
// Types: 1 tunel, 2 pliegue, 3 kali, 4 columnas, 5 olas, 6 orbita.

import { NOISE } from './glsl';

export const genFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform vec2 uAspect;
uniform float uTime;    // already speed-scaled on the CPU
uniform float uZoom;    // spatial scale multiplier
uniform int uType;
uniform float uHue;     // base hue, from the extracted palette
uniform float uEnergy;
uniform float uOnset;
uniform float uTurnProb;
uniform sampler2D uVideo;
uniform float uHasVideo;
uniform float uVideoInf;

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

// Kali IFS lace, restless version: the constant orbits widely, every
// iteration rotates by a time-varying angle, and the fold axis breathes -
// the lace keeps destructuring instead of settling into leaded glass.
vec4 kali(vec2 uv, float t) {
  vec2 z = uv * (1.1 + 0.45 * sin(t * 0.11));
  z *= rot2(t * 0.07);
  vec2 c = vec2(0.78 + 0.18 * sin(t * 0.23 + sin(t * 0.111) * 2.0),
                0.56 + 0.17 * cos(t * 0.157));
  float wob = 0.05 * sin(t * 0.19);
  float trap = 1e9, tr2 = 1e9;
  for (int i = 0; i < 13; i++) {
    z = abs(z) / max(dot(z, z), 1e-6) - c;
    z *= rot2(wob + float(i) * 0.03 * sin(t * 0.083));
    trap = min(trap, abs(z.y + 0.15 * sin(t * 0.29)));
    tr2 = min(tr2, length(z - vec2(0.3, 0.2)));
  }
  float v = exp(-trap * 6.0);
  vec3 col = hsv(uHue + tr2 * 0.25, 0.65, v * (0.16 + uEnergy * 0.12));
  return vec4(col, v);
}

// Grid of folded towers scrolling past (after the 1-aug tweet): each cell
// offsets by its own phase, box-folds carve the columns, glow at the walls.
vec4 columnas(vec2 uv, float t) {
  vec3 col = vec3(0.0);
  float g = 0.3, e, fieldAcc = 0.0;
  for (float i = 0.0; i < 70.0; i++) {
    vec3 p = vec3(uv * g, g + t * 2.0);
    vec2 n = floor(p.xz / 3.0);
    p.xz -= n * 3.0 + 1.8;
    p.y += 2.0 + sin(n.x + n.y * 1.571);
    for (float j = 1.0; j < 6.0; j++)
      p = abs(p + p) - vec3(0.6, 2.0 + j * 0.4, 1.0);
    e = (abs(max(abs(p.x), max(abs(p.y), abs(p.z))) * 6.0 - 15.0) + 0.1) / 900.0;
    g += e;
    float hit = exp(-e * 2000.0);
    col += hit * hsv(uHue + 0.06 + n.y * 0.02, 0.6, 0.014 + uEnergy * 0.01);
    fieldAcc += hit;
  }
  col = tanh(col * 1.1) * 0.5;
  return vec4(col, clamp(fieldAcc * 0.07, 0.0, 1.0));
}

// Wave terrain (after the 10-jul tweet): rotate2D per octave plus
// sin-interference builds a horizon of breathing ridges.
vec4 olas(vec2 uv, float t) {
  vec3 col = vec3(0.0);
  float e = 0.0, g = 0.2, s = 1.0, fieldAcc = 0.0;
  for (float i = 0.0; i < 70.0; i++) {
    vec3 p = vec3(uv * g, g);
    p.y += 0.7;
    e = p.y;
    for (s = 1.0; s < 500.0; s += s) {
      p.xz *= rot2(s);
      e += abs(dot(sin(p.zx * s + t), vec2(0.1))) / s;
    }
    g += e * 1.4;
    col += hsv(uv.y > 0.0 ? uHue + uv.y * 0.15 : uHue + 0.5,
               0.35, max(min(e * s - 0.05, 0.45 - e), 0.0) / 70.0);
    fieldAcc += e * 0.1;
  }
  col += hsv(uHue, 0.5, 1.0) * 0.05 / max(length(uv), 0.08);
  col = tanh(col * 0.9) * 0.55;
  return vec4(col, clamp(fieldAcc * 0.12, 0.0, 1.0));
}

// Orbiting folds (after the 13-aug tweet): the fold offset and the rotation
// axis both cycle with time, so the body keeps reassembling itself.
vec4 orbita(vec2 uv, float t) {
  vec3 col = vec3(0.0);
  float g = 0.3, e, fieldAcc = 0.0;
  float sway = 1.0 + sin(t * 0.5) * 0.5;
  mat3 M = rot3(1.5, normalize(vec3(1.0,
    5.0 * smoothstep(sway, 2.5, sin(t * 0.5)) - 1.0,
    sway - cos(t * 0.5))));
  for (float i = 0.0; i < 65.0; i++) {
    vec3 p = vec3(uv * g, g - 3.0);
    for (int j = 1; j <= 8; j++) {
      p = M * p;
      p = abs(p + p + 0.5) - (0.7 + 0.4 * cos(t * 0.7 + float(j + j)));
    }
    e = (length(p.yz) - 1.0) / 500.0;
    g += max(e, 1e-3);
    float hit = exp(-max(e, 0.0) * 2500.0);
    col += hit * hsv(uHue + 0.5 + g * 0.03, 0.7, 0.03 + uEnergy * 0.015);
    fieldAcc += hit;
  }
  col = tanh(col * 1.4) * 0.55;
  return vec4(col, clamp(fieldAcc * 0.07, 0.0, 1.0));
}

void main() {
  vec2 uv = (vUv - 0.5) * uAspect * 2.0 * uZoom;
  float t = uTime;
  vec4 g;
  if (uType == 1)      g = tunel(uv, t);
  else if (uType == 2) g = pliegue(uv, t);
  else if (uType == 3) g = kali(uv, t);
  else if (uType == 4) g = columnas(uv, t);
  else if (uType == 5) g = olas(uv, t);
  else                 g = orbita(uv, t);

  // The source video recolors the fractal with its own chroma (independent
  // of brightness, so a dark film still tints instead of just dimming) and
  // its shapes surface where the fractal glows. At knob 0: pure fractal.
  if (uHasVideo > 0.5 && uVideoInf > 0.001) {
    vec3 vid = texture2D(uVideo, vUv).rgb;
    float vl = dot(vid, vec3(0.299, 0.587, 0.114));
    vec3 chroma = vid / max(vl, 0.12);
    float gl = dot(g.rgb, vec3(0.299, 0.587, 0.114));
    vec3 filmed = g.rgb * chroma * (0.35 + 1.65 * vl) + vid * vid * gl * 2.5;
    g.rgb = mix(g.rgb, filmed, uVideoInf);
  }

  // onset flashes the layer a touch
  g.rgb *= 0.75 + uTurnProb * 0.5 + uOnset * 0.6;
  gl_FragColor = g;
}
`;
