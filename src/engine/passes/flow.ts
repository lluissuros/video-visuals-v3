// Feedback pass. Each frame: sample the previous frame displaced along a curl
// field (plus swirl and a slow zoom), diffused by the blur macro, faded by the
// feed macro, and inject fresh video and generative light. Abstraction happens
// here: the more abstract a scene, the chunkier the injected video, so after a
// few seconds of feedback only color fields remain. The generative layer's
// scalar field also WARPS the video sampling, so fractal structure and film
// color braid into each other. The performer mask, when present, injects light
// at its edges - the flow then drags it outward into an aura.

import { NOISE } from './glsl';

export const flowVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const flowFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uPrev;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform sampler2D uGen;
uniform float uHasVideo;
uniform float uHasMask;
uniform vec2 uAspect;      // (aspect, 1) to keep the flow isotropic
uniform vec2 uTexel;       // 1 / feedback buffer size
uniform float uTime;

// macros
uniform float uFlow;
uniform float uFeed;
uniform float uWash;
uniform float uBlur;
uniform float uPulse;

// audio
uniform float uEnergy;
uniform float uOnset;
uniform float uLow;

// wave structure
uniform float uTurnProb;

// scene character
uniform float uFlowScale;
uniform float uFlowSpeed;
uniform float uSwirl;
uniform float uInject;
uniform float uVideoZoom;
uniform float uHueShift;
uniform float uAbstraction;
uniform float uGenMix;
uniform float uGenWarp;

uniform vec3 uAuraColor;

${NOISE}

// Diffused read of the previous frame: 5 rotating taps. Radius grows with the
// blur macro; the rotation per frame turns the pentagon into a disc over time.
vec3 prevBlur(vec2 uv, float radius) {
  if (radius < 0.05) return texture2D(uPrev, uv).rgb;
  vec3 acc = texture2D(uPrev, uv).rgb;
  float a0 = hash12(uv + fract(uTime)) * 6.2832;
  for (int i = 0; i < 4; i++) {
    float a = a0 + float(i) * 1.5708;
    vec2 off = vec2(cos(a), sin(a)) * uTexel * radius;
    acc += texture2D(uPrev, uv + off).rgb;
  }
  return acc / 5.0;
}

void main() {
  vec2 uv = vUv;
  vec2 centered = (uv - 0.5) * uAspect;

  vec4 gen = (uGenMix + uGenWarp > 0.001)
    ? texture2D(uGen, uv)
    : vec4(0.0);

  // --- displacement -------------------------------------------------------
  float t = uTime * uFlowSpeed;
  vec2 field = curl(centered * uFlowScale, t);
  // swirl: constant rotation around the center
  vec2 tangent = vec2(-centered.y, centered.x);
  field += tangent * uSwirl * 1.5;
  // audio pushes the flow harder; onset gives a visible kick.
  // Quadratic macro so the top half of the slider REALLY pushes.
  float drive = (uFlow * uFlow) * (0.5 + uTurnProb * 0.5)
              * (1.0 + uPulse * (uEnergy * 1.5 + uOnset * 2.0));
  vec2 displaced = uv + field * drive * 0.012;

  // wash: slow zoom into the feedback, so trails breathe outward
  displaced = (displaced - 0.5) * (1.0 - uWash * 0.006 - uLow * uPulse * 0.004) + 0.5;

  vec3 prev = prevBlur(displaced, uBlur * 3.0);

  // feed: 0 -> fast fade, 1 -> near-infinite trails (never quite 1, or the
  // buffer saturates to white and stays there)
  float keep = mix(0.86, 0.996, uFeed);
  vec3 acc = prev * keep;

  // --- fresh video injection ----------------------------------------------
  if (uHasVideo > 0.5) {
    vec2 vuv = (uv - 0.5) / uVideoZoom + 0.5;
    // the generative field bends where the film is read from
    if (uGenWarp > 0.001) {
      float f0 = gen.a;
      float fx = texture2D(uGen, uv + vec2(uTexel.x * 2.0, 0.0)).a;
      float fy = texture2D(uGen, uv + vec2(0.0, uTexel.y * 2.0)).a;
      vuv += vec2(fx - f0, fy - f0) * uGenWarp * 0.6;
      vuv += (gen.a - 0.5) * uGenWarp * 0.03;
    }
    // abstraction: spatial posterize (mosaic) + tonal crush
    float cells = mix(640.0, 40.0, uAbstraction);
    vec2 quv = (floor(vuv * cells) + 0.5) / cells;
    vuv = mix(vuv, quv, smoothstep(0.15, 0.9, uAbstraction));
    vec3 vid = texture2D(uVideo, fract(vuv)).rgb;
    float levels = mix(64.0, 6.0, uAbstraction);
    vid = floor(vid * levels) / levels;
    vid = hueRotate(vid, uHueShift) * 1.35;
    float inj = uInject * (1.0 + uPulse * (uOnset * 2.5 + uEnergy))
              * (0.35 + uTurnProb * 0.65);
    acc = mix(acc, vid, clamp(inj, 0.0, 1.0));
  }

  // --- generative light ----------------------------------------------------
  // Mix, not add: an additive term inside a feedback loop multiplies by
  // 1/(1-keep) - measured as a screen going white in under two seconds.
  if (uGenMix > 0.001) {
    float gInj = uGenMix * 0.12 * (0.5 + uTurnProb * 0.5)
               * (1.0 + uPulse * uOnset);
    acc = mix(acc, gen.rgb * 2.2, clamp(gInj, 0.0, 1.0));
  }

  // --- performer aura -----------------------------------------------------
  if (uHasMask > 0.5) {
    float m = texture2D(uMask, uv).r;
    // edge of the silhouette, a soft band
    float e = 0.02;
    float mR = texture2D(uMask, uv + vec2(e, 0.0)).r;
    float mU = texture2D(uMask, uv + vec2(0.0, e)).r;
    float edge = clamp(abs(m - mR) + abs(m - mU), 0.0, 1.0);
    acc += uAuraColor * edge * (0.5 + uEnergy * uPulse * 2.0);
    // inside the body, damp the buffer so the aura reads as coming FROM them
    acc *= 1.0 - m * 0.35;
  }

  // safety: the buffer is float, nothing else stops a runaway
  gl_FragColor = vec4(min(acc, vec3(3.0)), 1.0);
}
`;
