// Shared GLSL chunks: simplex noise (Ashima/IQ standard), curl, hue rotation.

export const NOISE = /* glsl */ `
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Curl of a scalar noise field: divergence-free, so trails swirl instead of
// piling up in sinks.
vec2 curl(vec2 p, float t) {
  float e = 0.12;
  float nx1 = snoise(vec2(p.x, p.y + e) + t);
  float nx2 = snoise(vec2(p.x, p.y - e) + t);
  float ny1 = snoise(vec2(p.x + e, p.y) + t);
  float ny2 = snoise(vec2(p.x - e, p.y) + t);
  return vec2((nx1 - nx2), -(ny1 - ny2)) / (2.0 * e);
}

vec3 hueRotate(vec3 color, float angle) {
  const vec3 W = vec3(0.299, 0.587, 0.114);
  float c = cos(angle), s = sin(angle);
  vec3 gray = vec3(dot(color, W));
  vec3 u = color - gray;
  // Rodrigues rotation around the luma axis, cheap approximation.
  return gray + u * c + cross(vec3(0.57735), u) * s;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hsv(float h, float s, float v) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(vec3(h) + K.xyz) * 6.0 - K.www);
  return v * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), s);
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// Rodrigues rotation around an arbitrary axis.
mat3 rot3(float a, vec3 ax) {
  ax = normalize(ax);
  float c = cos(a), s = sin(a), k = 1.0 - c;
  return mat3(
    ax.x*ax.x*k + c,      ax.x*ax.y*k - ax.z*s, ax.x*ax.z*k + ax.y*s,
    ax.y*ax.x*k + ax.z*s, ax.y*ax.y*k + c,      ax.y*ax.z*k - ax.x*s,
    ax.z*ax.x*k - ax.y*s, ax.z*ax.y*k + ax.x*s, ax.z*ax.z*k + c
  );
}
`;
