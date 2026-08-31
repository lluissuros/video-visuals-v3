# Architecture

One rule holds the design: **sources write into the ControlBus; the Engine
reads one ControlFrame per render.** New inputs (another sensor, OSC, a second
MIDI device) touch the bus, never the shaders. New looks are scene presets or
passes, never new wiring.

```
sources/                     control/                    engine/
  video  ──────────────────►  bus ── ControlFrame ────►   flow pass (feedback)
  palette (k-means)  ─────►    ▲                            │
  camera ─► tracking mask ─────┼────────────────────────►  present pass ─► screen
                               │
  audio (FFT/onset) ───────────┤
  granulizer WS client ────────┤   scenes/ (presets + turn→scene sequencer)
  simulator ───────────────────┤
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
- `src/engine/renderer.ts` — half-res ping-pong feedback buffer (HalfFloat),
  two passes only:
  - `passes/flow.ts` — displace previous frame along curl noise (+ swirl,
    zoom), fade by `feed`, inject posterized video, inject mask-edge light.
  - `passes/present.ts` — palette remap (nearest-two blend, luma preserved),
    exposure/tonemap, vignette, grain, performer silhouette.
- `src/scenes/scenes.ts` — four presets (ascua, marea, vortice, respira) that
  change the flow's character, not the performer's macros.
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
