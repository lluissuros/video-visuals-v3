# video-visuals-v3

Generative visuals for live music performance. Movie scenes go in; abstract,
blurry color fields come out, moved by a flow field and driven by the music.
Made to project behind (and on) the performers, next to granulizer-v3.

Built and first verified 2026-08-31. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for how the pieces fit, and [docs/GRANULIZER-LINK.md](docs/GRANULIZER-LINK.md)
for the two-machine setup.

## Run

```sh
npm install
# drop a source clip into public/media/ (gitignored; it does not travel with the repo)
npm run dev          # http://localhost:5274, fullscreen with `f`
```

One-time, only for the performer-tracking prototype:

```sh
./tools/fetch-models.sh    # MediaPipe wasm + selfie segmenter into public/models/
```

## URL parameters

| param | default | meaning |
|---|---|---|
| `video` | `/media/almodovar-red.mp4` | source clip |
| `structure` | `sim` | what drives the wave cycle: `gz` (granulizer bridge), `sim` (built-in fake), `clock` (timer) |
| `ws` | `localhost:8765` | granulizer bridge host, for `structure=gz` |
| `audio` | `1` | external audio analysis (mic / line-in / BlackHole) |
| `camera` | off | `1` turns on the performer-tracking prototype |
| `res` | `0.5` | feedback buffer scale; lower it on the M1 if fps drops |
| `seek` | random | start position in the clip, seconds |

## Keys

`h` panel · `f` fullscreen · `m` mask debug view · `1`-`4` force a scene · `space` next scene

## The six macros

`flow` (distortion) · `feed` (trail persistence) · `wash` (blur/zoom drift) ·
`palette` (snap colors to the movie's own palette) · `pulse` (audio reactivity
depth) · `grain`. Each has a `midi` button: click it, move a knob, done.
Mappings persist per browser.

## Modes in one line each

- **sim** — a fake granulizer rotation, for developing alone.
- **gz** — follows the real engine: each song's turn selects a visual scene, in
  series, and the turn's probability breathes through the image. Needs the
  bridge running on the music machine (`node gui/bridge/index.mjs` in
  granulizer-v3). Zero changes on the granulizer side.
- **clock** — scenes advance on a timer; the piece runs by itself.
- **camera** (`?camera=1`) — MediaPipe masks the performers; the flow drags
  light out of their silhouette as an aura. Prototype: test it in the real
  space before trusting it (the camera also sees the projection).

## Verifying without eyes on the screen

`?snap=6,18&post=1` makes the app photograph its own canvas at those seconds
and POST the PNGs to `node tools/snap-server.mjs <outDir>` on :5299, with a
one-line JSON status (scene, waves, connection states). This exists because
headless Chromium crashes on WebGL on this machine; a normal browser window
plus these two hooks is the reliable loop.
