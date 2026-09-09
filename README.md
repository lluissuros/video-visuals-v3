# video-visuals-v3

Generative visuals for live music performance. Movie scenes and images go in;
abstract color fields, fractal light and kaleidoscopic folds come out, moved by
a flow field and driven by the music. Made to project behind (and on) the
performers, next to granulizer-v3.

The generative layer follows Yohei Nishitsuji's minimal-GLSL raymarchers
(see his Codrops piece "Rendering the Simulation Theory"): trig-interference
noise, log-polar zooms, HSV glow accumulated along the ray. Fractal light and
film color inject into one shared feedback buffer, and the fractal field warps
where the film is read from - the two braid instead of stacking.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit,
[docs/GRANULIZER-LINK.md](docs/GRANULIZER-LINK.md) for the two-machine setup
and [docs/PHONE-CAMERA.md](docs/PHONE-CAMERA.md) for using a phone as camera.

## Run

```sh
npm install
npm run dev              # http://localhost:5274 - press `i` for instructions
npm run phone            # optional: phone cameras, see docs/PHONE-CAMERA.md
```

Assets live in `assets/` (gitignored, they do not travel with the repo):
`assets/input/` holds the sources, `assets/output/` receives the recordings.
Drop new videos or images into `input` and reload the page, or drag a file from
Finder onto the running page (that one lives only until the tab closes). The
folder button in the panel opens `assets/` in Finder.

One-time, only for the performer-tracking prototype:

```sh
./tools/fetch-models.sh    # MediaPipe wasm + pose models into public/models/
```

## Keys (also under `i` in the app)

`h` panel · `i` instructions · `f` fullscreen · `1-9` load preset N ·
`space` next preset · `p` hold (on at start; off = the sequencer changes presets) ·
`l` loop the last ~2 s of video · `m` camera-mask debug view ·
`q` QR for a phone to send its camera

## Panel

- **fuente** — source selector (clips, stills, and live cameras: laptop,
  USB, connected phones), playback speed (0.06x-2x), loop length + loop button.
- **shader** — force any generative shader (tunel, pliegue, kali, columnas,
  olas, orbita, vidrio, solar, estrellas) over any preset, with speed / zoom / opacity knobs and a
  `video` knob that recolors the fractal with the film's chroma and lets its
  shapes surface (needs opacity > 0 to be visible). `estrellas` (dots, after
  XorDev's "Efficient Chaos") adds chaos / movement / quantity / size knobs; the
  film shows only through the dots, and `video` sets how dark the gaps are.
- **cámara** — which camera the tracker looks through (laptop, USB or a
  phone), camera on/off, `móvil` (QR for phones); then `silueta` (body
  presence, 0 = invisible), `tinte` (dark body vs aura-colored), `suavizar`
  (mask smoothing: soft silhouette and aura edges), `aura` (emanation
  strength), `tamaño` (halo reach), `emanar` (speed of the color waves
  leaving the body), `color` (how fast aura and tint colors change),
  `moverse` (how much performer movement swells the aura: 0.5 normal, 1
  exaggerated), `retraso` (the 8 shadow silhouettes that form the halo each
  lag behind the body by their own delay, up to 10 s), `espejo` (how many of
  the 8 shadows are mirrored to the other side of the screen), `matices`
  (each shadow its own hue inside the aura), `brillo` (volumetric contour
  glow: a saturated raymarch toward the body), `personas` (how
  many people the model looks for, 1-4), `confianza` (how sure it must be
  that a shape is a body — raise it when the camera sees the projection), and
  an `aura` dropdown: `arcoíris` (hues around the main palette color) or
  `paleta` (the extracted palette itself). Cameras and clips are cropped to
  fill the canvas, never stretched. The film source and the tracker choose
  cameras independently: the same phone can be both, either, or neither.
- **macros** — `flow` (drag), `feed` (trails), `wash` (zoom drift), `blur`
  (end-of-chain dual-kawase blur, up to full fog; grain stays on top),
  `palette` (snap to extracted colors), `sat`
  (0.29 = neutral), `pulse` (audio depth), `grain`. Two XY pads on top move
  `palette`×`sat` and `flow`×`feed` at once. Each macro has a `midi`
  button: click, move a knob, done. Mappings persist per browser.
- **presets** (top of the panel) — the presets are the scenes. Picking one
  in the dropdown loads it; keys `1-9` and `space` move through them, and the
  sequencer advances them when HOLD is off. `save` stores the current state
  under a new name, `update` overwrites the selected preset. A preset captures
  the look, macros, shader overrides, camera/aura params, source, speed and
  the loop region.
- **rec** (below the preset row, or key `r`) — records what the screen
  shows (canvas only, no panel) plus the audio input when analysis is on;
  press again to stop and download a timestamped `.mp4` (H.264 + AAC;
  `.webm` on browsers that cannot mux mp4).
- **rendimiento** — a traffic light in the top-right corner (green/amber/red =
  share of each second the GPU or CPU spends drawing: <45 % / <75 % / above),
  with frame interval, JS ms, GPU ms (WebGL timer query, when
  Chrome exposes it), tracker ms and buffer size, plus an fps cap (screen /
  60 / 30) and the feedback buffer resolution, both remembered per browser.
  A 120 Hz screen with no cap doubles every cost.

## Presets are the scenes

The app starts on the first saved preset with HOLD on. With the granulizer
connected and HOLD off, each song's turn selects a preset in series; without
the granulizer they advance on a timer. `p` toggles HOLD.

Each preset carries a hidden *look* (flow field, injection, kaleidoscope and a
base generative layer) inherited from the old fixed scene table; presets saved
before this change were migrated to it on first load. The shader dropdown's
`base` entry means "whatever the preset's look brings".

## URL parameters

| param | default | meaning |
|---|---|---|
| `video` | `/media/almodovar-red.mp4` | source (video, image, or `live:local:default` for the laptop camera) |
| `structure` | `sim` | `gz` (granulizer bridge) / `sim` (fake) / `clock` |
| `ws` | `localhost:8765` | granulizer bridge host, for `structure=gz` |
| `hold` | `1` | `0` starts with the preset sequencer running (HOLD off) |
| `preset` | `1` | saved preset to start on (1-based) |
| `shader` | — | force a generative shader (1-9) on top of the preset |
| any macro | — | preset a macro slider: `?blur=0.8&feed=0.9` … |
| `audio` | `1` | external audio analysis |
| `camera` | off | `1` starts the performer tracking on load |
| `posemodel` | `full` | `lite` for a faster, rougher pose model on a slow machine |
| `phone` | `localhost:5276` | phone-cam signaling server, if it runs elsewhere |
| `res` | `1` | feedback buffer scale; drop to `0.5` on the M1 if fps suffers |
| `recbps` | `60` | recording bitrate in Mbps; the grain needs a lot, 16 looks soft |
| `seek` | random | start position in the clip, seconds |
| `maskinvert` | — | `1` flips the person mask if a model comes out inverted |

Every panel section folds; what you fold stays folded across reloads.

## Verifying without eyes on the screen

`?snap=6,18&post=1` makes the app photograph its own canvas at those seconds
and POST the PNGs to `node tools/snap-server.mjs <outDir>` on :5299, with a
one-line JSON status (preset, waves, connection states). This exists because
headless Chromium crashes on WebGL on this machine; a normal browser window
plus these two hooks is the reliable loop. `tools/mock-bridge.mjs` fakes the
granulizer bridge protocol on any port.
