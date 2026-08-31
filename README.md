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

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit and
[docs/GRANULIZER-LINK.md](docs/GRANULIZER-LINK.md) for the two-machine setup.

## Run

```sh
npm install
./tools/scan-media.sh    # regenerate the source list from public/media/
npm run dev              # http://localhost:5274 - press `i` for instructions
```

Sources live in `public/media/` (gitignored, they do not travel with the repo).
Drop new videos or images there and re-run `tools/scan-media.sh` - or just drag
a file from Finder onto the running page.

One-time, only for the performer-tracking prototype:

```sh
./tools/fetch-models.sh    # MediaPipe wasm + selfie segmenter into public/models/
```

## Keys (also under `i` in the app)

`h` panel · `i` instructions · `f` fullscreen · `1-6` force scene ·
`space` next scene · `p` hold (freeze the scene sequencer) ·
`l` loop the last ~2 s of video · `m` camera-mask debug view

## Panel

- **fuente** — source selector, playback speed (0.06x-2x), loop button,
  camera on/off.
- **macros** — `flow` (drag), `feed` (trails), `wash` (zoom drift), `blur`
  (diffusion), `palette` (snap to extracted colors), `sat` (0.29 = neutral),
  `pulse` (audio depth), `grain`. Each has a `midi` button: click, move a
  knob, done. Mappings persist per browser.

## Scenes

1. `ascua` — slow ember drift, close to the film
2. `marea` — broad lateral waves, half abstract
3. `espejo` — kaleidoscope (8-fold, rippling radius) over the film
4. `cueva` — folded-fractal filaments braided with the film
5. `puro` — generative only: the interference tunnel, hue from the palette
6. `respira` — near-still washes, kali-lace warping underneath

With the granulizer connected each song's turn selects a scene in series;
without it they advance on a timer. `p` freezes them for study.

## URL parameters

| param | default | meaning |
|---|---|---|
| `video` | `/media/almodovar-red.mp4` | source (video or image) |
| `structure` | `sim` | `gz` (granulizer bridge) / `sim` (fake) / `clock` |
| `ws` | `localhost:8765` | granulizer bridge host, for `structure=gz` |
| `scene` | — | force a scene (1-6) and start with HOLD on |
| `audio` | `1` | external audio analysis |
| `camera` | off | `1` starts the tracking prototype on load |
| `res` | `0.5` | feedback buffer scale; lower on the M1 if fps drops |
| `seek` | random | start position in the clip, seconds |
| `maskinvert` | — | `1` flips the person mask if a model comes out inverted |

## Verifying without eyes on the screen

`?snap=6,18&post=1` makes the app photograph its own canvas at those seconds
and POST the PNGs to `node tools/snap-server.mjs <outDir>` on :5299, with a
one-line JSON status (scene, waves, connection states). This exists because
headless Chromium crashes on WebGL on this machine; a normal browser window
plus these two hooks is the reliable loop. `tools/mock-bridge.mjs` fakes the
granulizer bridge protocol on any port.
