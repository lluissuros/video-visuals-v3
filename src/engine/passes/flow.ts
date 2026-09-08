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
uniform vec2 uVideoFit;    // cover-fit of the source onto the canvas
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
// estrellas: the gen alpha gates the film, gaps fall to uGenGap brightness
uniform float uGenMask;
uniform float uGenGap;

uniform vec3 uAuraColor;
uniform vec3 uColors[5];   // extracted palette, most saturated first
uniform float uAuraMode;   // 0 rainbow, 1 palette
uniform float uAuraHue;    // color change rate, radians/s (0 = frozen)

// camera / silhouette params
uniform float uSilOpacity;
uniform float uSilTint;
uniform float uAura;
uniform float uAuraSize;
uniform float uAuraSpeed;
uniform float uMotion;     // performer movement 0..1, already scaled by the param
uniform float uAuraTime;   // aura clock: runs faster while the performers move

// shadow silhouettes: 8 offset copies of the mask, each with its own delay
uniform sampler2D uMaskHist;  // atlas of past masks, one tile per HIST_STEP
uniform vec2 uHistTiles;      // tiles per row / column
uniform float uHistIdx;       // tile written most recently
uniform float uHistStep;      // seconds between tiles
uniform float uAuraDelay;     // max shadow delay, seconds (0 = all live)
uniform float uAuraMirror;    // share of the shadows mirrored left<->right
uniform float uAuraSpread;    // hue spread between shadows, turns
uniform float uAuraGlow;      // volumetric contour glow

${NOISE}

// Palette color at a continuous index (wraps), kept luminous for the aura.
vec3 paletteAt(float k) {
  k = mod(k, 5.0);
  float f = fract(k);
  vec3 a = uColors[0];
  vec3 b = uColors[0];
  for (int i = 0; i < 5; i++) {
    if (float(i) == floor(k)) {
      a = uColors[i];
      b = uColors[(i + 1) % 5];
    }
  }
  vec3 c = mix(a, b, f);
  return c * (1.1 / max(0.3, max(c.r, max(c.g, c.b))));
}

// Mask as shadow i sees it: mirrored for some, and read from the history
// atlas delay_i seconds ago. Delays spread over the 8 shadows in a
// non-adjacent order so neighbours never lag alike; shadow 0 is always live.
float shadowMask(int i, vec2 p) {
  float fi = float(i);
  float mirrored = step(mod(fi * 5.0, 8.0) + 0.5, uAuraMirror * 8.0);
  p.x = mix(p.x, 1.0 - p.x, mirrored);
  float delay = uAuraDelay * fract(fi * 0.375);
  if (delay < uHistStep * 0.5) return texture2D(uMask, p).r;
  float n = uHistTiles.x * uHistTiles.y;
  float k = mod(uHistIdx - floor(delay / uHistStep + 0.5) + n, n);
  vec2 tile = vec2(mod(k, uHistTiles.x), floor(k / uHistTiles.x));
  return texture2D(uMaskHist, (tile + clamp(p, 0.003, 0.997)) / uHistTiles).r;
}

float tanhF(float x) { return 1.0 - 2.0 / (exp(2.0 * x) + 1.0); }

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
    displaced += gm * (0.002 + uAuraSpeed * 0.008) * (1.0 + uMotion * 3.0);
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
    vec2 vuv = (uv - 0.5) * uVideoFit / uVideoZoom + 0.5;
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
    // estrellas: the film shows through the dots, the gaps go dark
    if (uGenMask > 0.5) vid *= mix(uGenGap, 1.0, gen.a);
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
  // different hue - while the advection above streams the light away. The
  // halo is built from 8 shadow silhouettes (offset copies of the mask), each
  // with its own delay, side and hue.
  if (uHasMask > 0.5) {
    float m = texture2D(uMask, uv).r;

    // wide soft halo: three rings of taps per shadow, reach set by the size
    // param and widened while the performers move
    float r1 = (0.025 + uAuraSize * 0.06) * (1.0 + uMotion * 1.5);
    float shadow[8];
    float prox = 0.0;
    vec2 toBody = vec2(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7854;
      vec2 d8 = vec2(cos(a), sin(a));
      float p = shadowMask(i, uv + d8 * r1) * 0.5
              + shadowMask(i, uv + d8 * r1 * 2.2) * 0.33
              + shadowMask(i, uv + d8 * r1 * 4.0) * 0.17;
      shadow[i] = p;
      prox += p;
      toBody += d8 * p;
    }
    prox /= 8.0;                          // ~1 at the body, fades with distance
    float outside = clamp(prox - m, 0.0, 1.0) * (1.0 - m);

    // crests move toward lower prox as time runs (= outward); the hue turns
    // along the same phase, so every new wave carries a new color
    float ph = prox * 9.0 + uAuraTime * (0.5 + uAuraSpeed * 4.0);
    float wave = 0.35 + 0.65 * (0.5 + 0.5 * sin(ph));
    float hueT = uTime * uAuraHue;
    vec3 auraCol = uAuraMode > 0.5
      ? paletteAt(ph * 0.4 + hueT)
      : hueRotate(uAuraColor, sin(ph * 0.5) * 1.2 + hueT);
    // colour spread: each shadow shifts the hue its own way, weighted by how
    // much of the halo here is its own
    if (uAuraSpread > 0.001 && prox > 0.001) {
      vec3 sum = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float off = (fract(float(i) * 0.375) - 0.5) * uAuraSpread;
        vec3 c = uAuraMode > 0.5
          ? paletteAt(ph * 0.4 + hueT + off * 5.0)
          : hueRotate(auraCol, off * 6.2832);
        sum += c * shadow[i];
      }
      auraCol = sum / (prox * 8.0);
    }
    float glow = outside * wave * uAura * 2.0
               * (0.8 + uEnergy * uPulse * 2.5 + uOnset * uPulse * 2.0)
               * (1.0 + uMotion * 5.0);
    acc = mix(acc, auraCol * 2.4, clamp(glow, 0.0, 1.0));

    // contour glow: march from this pixel toward the body through the mask
    // as a density field, then saturate (tanh) so it never blows white -
    // a steady volumetric light leaking out of the silhouette
    float lenB = length(toBody);
    if (uAuraGlow > 0.001 && lenB > 0.02 && m < 0.98) {
      vec2 dir = toBody / lenB;
      vec2 stepV = dir * r1 * 6.0 / 12.0;
      vec2 pos = uv;
      float vol = 0.0;
      for (int s = 0; s < 12; s++) {
        pos += stepV;
        vol += texture2D(uMask, pos).r;
      }
      float ray = tanhF(vol / 12.0 * 3.0 * uAuraGlow * (1.0 + uMotion * 2.0));
      ray *= (1.0 - m) * uAura * (0.7 + uEnergy * uPulse * 1.5);
      acc = mix(acc, auraCol * 2.0, clamp(ray * 0.7, 0.0, 1.0));
    }

    // body presence: dark or tinted toward the aura color, by its own opacity
    vec3 bodyCol = mix(acc * (1.0 - uSilOpacity * 0.85),
                       auraCol * (0.6 + uEnergy * uPulse), uSilTint);
    acc = mix(acc, bodyCol, m * clamp(uSilOpacity + uSilTint, 0.0, 1.0));
  }

  // safety: the buffer is float, nothing else stops a runaway
  gl_FragColor = vec4(min(acc, vec3(3.0)), 1.0);
}
`;
