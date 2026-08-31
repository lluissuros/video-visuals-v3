# Architecture

One rule holds the design: **sources write into the ControlBus; the Engine
reads one ControlFrame per render.** New inputs (another sensor, OSC, a second
MIDI device) touch the bus, never the shaders. New looks are scene presets or
passes, never new wiring.

```
sources/                     control/                    engine/
  media (video/image/dnd) ──►  bus ── ControlFrame ──►    generative pass (fractal)
  palette (k-means)  ─────►    ▲                            │ light + warp field
  camera ─► tracking mask ─────┼───────────────────────►  flow pass (feedback)
                               │                            │
  audio (FFT/onset) ───────────┤                          present pass ─► screen
  granulizer WS client ────────┤                            (kaleido, palette, sat)
  simulator ───────────────────┤   scenes/ (presets + turn→scene sequencer)
  midi ────────────────────────┘
```

## The pieces

- `src/types.ts` — the contracts. `ControlFrame` is the whole engine input.
- `src/control/bus.ts` — merges macros (sliders/MIDI), audio signals and wave
  state; runs the scene sequencer (turn change → crossfade) and slow LFO drift
  so the piece moves with nobody touching it.
- `src/control/granulizer.ts` — read-only WebSocket client of granulizer-v3's
  existing GUI bridge. Reads `state.turn.probs` (the waves), `turn.index`,
  `rotating`. Reconnects forever; falls back to clock mode when not live.
- `src/control/simulator.ts` — same shape as lib/40-rotation.scd, no SC needed.
- `src/control/audio.ts` — band energies + spectral-flux onsets from any input.
- `src/sources/palette.ts` — k-means over a 64×36 downsample every few seconds,
  seeded from the previous palette so colors glide. Index 0 = most saturated.
- `src/sources/media.ts` — the catalogue: manifest + drag&drop, video or
  image, playback speed, loop-a-region.
- `src/engine/renderer.ts` — half-res ping-pong feedback buffer (HalfFloat),
  three passes:
  - `passes/generative.ts` — Nishitsuji-style fractal layer (interference
    tunnel / folded filaments / kali lace). rgb = light, alpha = a scalar
    field. Runs only when the scene asks for it.
  - `passes/flow.ts` — displace previous frame along curl noise (+ swirl,
    zoom, blur-diffusion), fade by `feed`, inject posterized video (warped by
    the fractal field - this braids the two), mix in fractal light
    (energy-conserving mix, NEVER additive: an additive term in a feedback
    loop multiplies by 1/(1-keep) and blows white), inject mask-edge light.
  - `passes/present.ts` — kaleidoscope fold (angle sectors + rippling
    radius), palette remap (nearest-two blend, luma preserved),
    exposure/tonemap, saturation, vignette, grain, performer silhouette.
- `src/scenes/scenes.ts` — six presets (ascua, marea, espejo, cueva, puro,
  respira) that change the piece's character, not the performer's macros.
  Scene switches are instant; the feedback buffer morphs between them.
- `src/tracking/bodyTracking.ts` — MediaPipe selfie segmentation → mask
  texture. Self-contained; when it fails the app runs without it.

## Performance knob

`?res=` scales the feedback buffer. 0.5 on the M4 is comfortable; try 0.35 on
the M1 with music running. All heavy work is in the two fragment shaders; CPU
work per frame is uniforms + occasionally k-means (amortized).

## Verification hooks

`src/debug/snap.ts` + `tools/snap-server.mjs` (see README) — the app reports
its own pixels and state. `tools/mock-bridge.mjs` fakes the granulizer bridge
protocol on any port.
