# Granulizer link — two machines, zero granulizer changes

The visuals do not talk to SuperCollider. They subscribe to the **existing web
GUI bridge** in granulizer-v3 (`gui/bridge/index.mjs`), which already
broadcasts full engine state to every connected WebSocket client at up to
20 Hz. The GUI page is one client; the visuals are simply another.

## Same machine

```sh
# terminal 1, in ~/code/_personal_lluis/granulizer-v3
node gui/bridge/index.mjs          # WS on :8765
# SuperCollider: boot.scd, then the WEB GUI block (loads gui/sc/bridge.scd)

# terminal 2, in video-visuals-v3
npm run dev
# open http://localhost:5274/?structure=gz
```

## Two machines (M1 makes sound, M4 makes image)

1. Both machines on the same Wi-Fi (a phone hotspot works; no internet needed).
2. On the **music machine** (M1): run the bridge and the engine as above.
   Find its LAN address: `ipconfig getifaddr en0`.
3. On the **visuals machine** (M4): `npm run dev`, then open
   `http://localhost:5274/?structure=gz&ws=<M1-address>:8765`.

The bridge's WebSocket listens on all interfaces, so nothing else is needed.
If macOS asks about incoming connections for node on the M1, allow it.

## What flows

From `state` (pushed on every command and at least 4 Hz):

- `turn.probs` — one probability per active song: **the waves**. The winner's
  `prob` breathes through injection strength and flow drive.
- `turn.index` — which song holds the turn. A change advances the visual scene
  (song 1 → scene 1, song 2 → scene 2, … wrapping).
- `rotating` — false (or bridge down) drops the visuals to their internal clock.

## Audio on the visuals machine

The waves say *where* the music is; the actual sound still arrives as audio.
Give the M4 a line-in from the mixer (or its mic as a rough fallback) and keep
`audio=1`. `pulse` controls how deep that modulation goes.

## Testing without SuperCollider

`node tools/mock-bridge.mjs 8766` speaks the same protocol with three fake
songs; open `?structure=gz&ws=localhost:8766`. Verified end-to-end 2026-08-31:
turn changes advanced scenes, waves modulated the image.
