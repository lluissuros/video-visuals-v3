// Mask preparation: the tracker's raw confidence mask (camera resolution,
// camera aspect) becomes a canvas-shaped, cover-fitted, soft-edged mask. The
// soft ramp lives here rather than on the CPU so it runs at full resolution;
// the dual-kawase passes in present.ts then smooth it by the `suavizar` param.

export const maskPrepFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uRaw;
uniform vec2 uFit;       // cover-fit scale, see Engine.coverFit
uniform float uInvert;
void main() {
  vec2 p = (vUv - 0.5) * uFit + 0.5;
  float c = texture2D(uRaw, p).r;
  if (uInvert > 0.5) c = 1.0 - c;
  // soft ramp around the model's decision point, never a hard threshold:
  // a hard edge at the model's resolution reads as staircases.
  float soft = smoothstep(0.35, 0.65, c);
  gl_FragColor = vec4(vec3(soft), 1.0);
}
`;

/** Copies the prepared mask into one tile of the history atlas (viewport set
 *  by the renderer). The atlas gives the shadow silhouettes their delay. */
export const maskCopyFragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
  gl_FragColor = vec4(vec3(texture2D(uTex, vUv).r), 1.0);
}
`;
