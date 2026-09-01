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

// camera / silhouette params
uniform float uSilOpacity;
uniform float uSilTint;
uniform float uAura;
uniform float uAuraSize;
uniform float uAuraSpeed;

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

  // performers push the feedback outward: sample the previous frame from
  // slightly closer to the body, so its light streams away every frame
  if (uHasMask > 0.5) {
    vec2 gm = vec2(
      texture2D(uMask, uv + vec2(0.02, 0.0)).r - texture2D(uMask, uv - vec2(0.02, 0.0)).r,
      texture2D(uMask, uv + vec2(0.0, 0.02)).r - texture2D(uMask, uv - vec2(0.0, 0.02)).r);
    displaced += gm * (0.002 + uAuraSpeed * 0.008);
  }

  // A LITTLE in-loop diffusion still compounds into melt, but the blur macro
  // mainly drives the end-of-chain kawase blur now - so this stays subtle.
  vec3 prev = prevBlur(displaced, uBlur * uBlur * 4.0);

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
    // abstraction: a soft blur of the injected video (melts detail into
    // color fields, no mosaic - mosaic read as unwanted pixelation) plus a
    // gentle tonal crush. The blur compounds through the feedback.
    vec3 vid = texture2D(uVideo, fract(vuv)).rgb;
    float ab = smoothstep(0.1, 1.0, uAbstraction);
    if (ab > 0.01) {
      float r = ab * ab * 40.0;
      float a0 = hash12(uv + fract(uTime * 0.7)) * 6.2832;
      for (int i = 0; i < 4; i++) {
        float a = a0 + float(i) * 1.5708;
        vid += texture2D(uVideo, fract(vuv + vec2(cos(a), sin(a)) * uTexel * r)).rgb;
      }
      vid /= 5.0;
    }
    float levels = mix(64.0, 14.0, uAbstraction);
    vid = floor(vid * levels + 0.5) / levels;
    vid = hueRotate(vid, uHueShift) * 1.35;
    // performers enter HERE, as a source, so every later effect (fractal,
    // kaleido, trails) flows over them instead of being punched through:
    // inside the silhouette the injected image goes near-black with a breath
    // of the palette color.
    if (uHasMask > 0.5) {
      float mBody = texture2D(uMask, uv).r;
      vid = mix(vid, uAuraColor * 0.08, mBody * 0.9 * uSilOpacity);
    }
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

  // --- performer silhouette + emanation ------------------------------------
  // Body: a presence that darkens (or tints) the buffer, so every effect
  // flows OVER the figure. Emanation: color waves born at the body's edge
  // that travel outward through a wide soft halo - each crest a slightly
  // different hue - while the advection above streams the light away.
  if (uHasMask > 0.5) {
    float m = texture2D(uMask, uv).r;

    // wide soft halo: three rings of taps, reach set by the size param
    float r1 = 0.025 + uAuraSize * 0.06;
    float prox = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7854;
      vec2 d8 = vec2(cos(a), sin(a));
      prox += texture2D(uMask, uv + d8 * r1).r * 0.5;
      prox += texture2D(uMask, uv + d8 * r1 * 2.2).r * 0.33;
      prox += texture2D(uMask, uv + d8 * r1 * 4.0).r * 0.17;
    }
    prox /= 8.0;                          // ~1 at the body, fades with distance
    float outside = clamp(prox - m, 0.0, 1.0) * (1.0 - m);

    // crests move toward lower prox as time runs (= outward); the hue turns
    // along the same phase, so every new wave carries a new color
    float ph = prox * 9.0 + uTime * (0.5 + uAuraSpeed * 4.0);
    float wave = 0.35 + 0.65 * (0.5 + 0.5 * sin(ph));
    vec3 auraCol = hueRotate(uAuraColor, sin(ph * 0.5) * 1.2 + uTime * 0.05);
    float glow = outside * wave * uAura * 2.0
               * (0.8 + uEnergy * uPulse * 2.5 + uOnset * uPulse * 2.0);
    acc = mix(acc, auraCol * 2.4, clamp(glow, 0.0, 1.0));

    // body presence: dark or tinted toward the aura color, by its own opacity
    vec3 bodyCol = mix(acc * (1.0 - uSilOpacity * 0.85),
                       auraCol * (0.6 + uEnergy * uPulse), uSilTint);
    acc = mix(acc, bodyCol, m * clamp(uSilOpacity + uSilTint, 0.0, 1.0));
  }

  // safety: the buffer is float, nothing else stops a runaway
  gl_FragColor = vec4(min(acc, vec3(3.0)), 1.0);
}
`;
