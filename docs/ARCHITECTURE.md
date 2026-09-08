# Architecture

One rule holds the design: **sources write into the ControlBus; the Engine
reads one ControlFrame per render.** New inputs (another sensor, OSC, a second
MIDI device) touch the bus, never the shaders. New looks are saved presets or
passes, never new wiring.

```
sources/                     control/                    engine/
  media (video/image/dnd) ──►  bus ── ControlFrame ──►    generative pass (fractal)
  palette (k-means)  ─────►    ▲                            │ light + warp field
  live ─┬─► media (as film)    │                            │
  (laptop/USB/phones) ─► tracking mask ───────────────►  flow pass (feedback)
  remote (WebRTC) ─► live      │                            │
  audio (FFT/onset) ───────────┤                          present pass ─► screen
  granulizer WS client ────────┤                            (kaleido, palette, sat)
  simulator ───────────────────┤   control/presets (saved looks = scenes)
  midi ────────────────────────┘
```

## The pieces

- `src/types.ts` — the contracts. `ControlFrame` is the whole engine input.
- `src/control/bus.ts` — merges macros (sliders/MIDI), audio signals and wave
  state; runs the preset sequencer (turn change → next saved preset, applied
  by the panel) and slow LFO drift so the piece moves with nobody touching it.
- `src/control/granulizer.ts` — read-only WebSocket client of granulizer-v3's
  existing GUI bridge. Reads `state.turn.probs` (the waves), `turn.index`,
  `rotating`. Reconnects forever; falls back to clock mode when not live.
- `src/control/simulator.ts` — same shape as lib/40-rotation.scd, no SC needed.
- `src/control/audio.ts` — band energies + spectral-flux onsets from any input.
- `src/sources/palette.ts` — k-means over a 64×36 downsample every few seconds,
  seeded from the previous palette so colors glide. Index 0 = most saturated.
- `src/sources/media.ts` — the catalogue: manifest + drag&drop + live
  cameras, video or image or camera, playback speed, loop-a-region.
- `src/sources/live.ts` — live cameras as one list: local devices
  (enumerateDevices) and phones. Refcounted `acquire/release` so the film
  source and the tracker can share one stream. One stable `<video>` per
  phone: a reconnect swaps `srcObject`, textures bound to it survive.
- `src/sources/remote.ts` — WebRTC receiver for phones. Signaling through
  `tools/phone-cam/server.mjs`, video direct over the LAN, no STUN/TURN.
  The phone page lives in `tools/phone-cam/index.html`; see
  [PHONE-CAMERA.md](PHONE-CAMERA.md).
- `src/engine/renderer.ts` — half-res ping-pong feedback buffer (HalfFloat),
  three passes:
  - `passes/generative.ts` — Nishitsuji-style fractal layer (interference
    tunnel / folded filaments / kali lace) plus `estrellas`, layered dot grids
    after XorDev's "Efficient Chaos". rgb = light, alpha = a scalar
    field. Runs only when the look (or a forced shader) asks for it.
  - `passes/flow.ts` — displace previous frame along curl noise (+ swirl,
    zoom, blur-diffusion), fade by `feed`, inject posterized video (warped by
    the fractal field - this braids the two), mix in fractal light
    (energy-conserving mix, NEVER additive: an additive term in a feedback
    loop multiplies by 1/(1-keep) and blows white), inject mask-edge light.
  - `passes/mask.ts` — the tracker's raw float mask (camera resolution)
    becomes a canvas-shaped mask: cover-fit, soft ramp, then dual-kawase
    smoothing by `silBlur`. Video is cover-fitted the same way in flow/gen.
    Every 0.1 s the prepared mask is also copied into one tile of a history
    atlas (8×14 tiles of 256×144, 11 s). The aura halo is 8 offset copies of
    the mask ("shadows"); each reads the atlas at its own delay (`auraDelay`),
    some mirrored left/right (`auraMirror`), each with its own hue
    (`auraSpread`). `auraGlow` marches from each pixel toward the body
    through the mask as a density field, saturated with tanh.
  - `passes/present.ts` — kaleidoscope fold (angle sectors + rippling
    radius), palette remap (nearest-two blend, luma preserved),
    exposure/tonemap, saturation, vignette, grain, performer silhouette.
- `src/control/presets.ts` — the saved presets, which are the scenes. Each
  carries a `Look` (flow field, inject, kaleido, base shader) plus macros,
  shader overrides, camera params and source. Switches are instant; the
  feedback buffer morphs between them. The old fixed scene table survives
  only as a migration map for presets saved with a scene index.
- `src/tracking/bodyTracking.ts` — MediaPipe PoseLandmarker on any live camera.
  It finds people first and segments second, so only bodies reach the mask.
  Per-person masks merge by max into one raw float texture at the model's
  resolution (no CPU resample); the 33 landmarks also give a movement energy
  that swells the aura. Self-contained; when it fails the app runs without it.

## Performance knobs

`?res=` (or the panel's `res` select, remembered per browser) scales the
feedback buffer; the panel's fps cap skips vsyncs on 120 Hz screens. All heavy
GPU work is in the flow fragment shader (the aura alone is ~24 mask taps plus
a 12-step raymarch per pixel); CPU work per frame is uniforms, the pose model
when the camera is on, and occasionally k-means (amortized). `src/debug/perf.ts`
measures frame / js / gpu / tracker time; the engine's GPU timer uses
`EXT_disjoint_timer_query_webgl2` when the browser exposes it.

## Verification hooks

`src/debug/snap.ts` + `tools/snap-server.mjs` (see README) — the app reports
its own pixels and state. `tools/mock-bridge.mjs` fakes the granulizer bridge
protocol on any port.
