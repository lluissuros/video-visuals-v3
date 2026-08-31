// Feedback pass. Each frame: sample the previous frame displaced along a curl
// field (plus swirl and a slow zoom), fade it by the feed macro, and inject a
// little fresh video. Abstraction happens here: the more abstract a scene, the
// chunkier and more posterized the injected video, so after a few seconds of
// feedback only color fields remain. The performer mask, when present, injects
// light at its edges - the flow then drags it outward into an aura.

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
uniform float uHasVideo;
uniform float uHasMask;
uniform vec2 uAspect;      // (aspect, 1) to keep the flow isotropic
uniform float uTime;

// macros
uniform float uFlow;
uniform float uFeed;
uniform float uWash;
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

uniform vec3 uAuraColor;

${NOISE}

void main() {
  vec2 uv = vUv;
  vec2 centered = (uv - 0.5) * uAspect;

  // --- displacement -------------------------------------------------------
  float t = uTime * uFlowSpeed;
  vec2 field = curl(centered * uFlowScale, t);
  // swirl: constant rotation around the center
  vec2 tangent = vec2(-centered.y, centered.x);
  field += tangent * uSwirl * 1.5;
  // audio pushes the flow harder; onset gives a visible kick
  float drive = uFlow * (0.5 + uTurnProb * 0.5)
              * (1.0 + uPulse * (uEnergy * 1.5 + uOnset * 2.0));
  vec2 displaced = uv + field * drive * 0.004;

  // wash: slow zoom into the feedback, so trails breathe outward
  displaced = (displaced - 0.5) * (1.0 - uWash * 0.006 - uLow * uPulse * 0.004) + 0.5;

  vec3 prev = texture2D(uPrev, displaced).rgb;

  // feed: 0 -> fast fade, 1 -> near-infinite trails (never quite 1, or the
  // buffer saturates to white and stays there)
  float keep = mix(0.86, 0.996, uFeed);
  vec3 acc = prev * keep;

  // --- fresh video injection ----------------------------------------------
  if (uHasVideo > 0.5) {
    vec2 vuv = (uv - 0.5) / uVideoZoom + 0.5;
    // abstraction: spatial posterize (mosaic) + tonal crush
    float cells = mix(640.0, 26.0, uAbstraction);
    vec2 quv = (floor(vuv * cells) + 0.5) / cells;
    vuv = mix(vuv, quv, smoothstep(0.15, 0.9, uAbstraction));
    vec3 vid = texture2D(uVideo, fract(vuv)).rgb;
    float levels = mix(64.0, 4.0, uAbstraction);
    vid = floor(vid * levels) / levels;
    vid = hueRotate(vid, uHueShift) * 1.35;
    float inj = uInject * (1.0 + uPulse * (uOnset * 2.5 + uEnergy))
              * (0.35 + uTurnProb * 0.65);
    acc = mix(acc, vid, clamp(inj, 0.0, 1.0));
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

  gl_FragColor = vec4(acc, 1.0);
}
`;
