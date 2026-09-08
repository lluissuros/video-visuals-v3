# Phone as camera

Any phone (Android or iPhone) becomes a camera for the visuals. Its video
reaches the laptop over WebRTC on the local network - no app, no account, no
internet. Once connected, the phone appears twice on the panel:

- in **fuente**, as a film source: the phone image is processed like a clip;
- in **cámara**, as the tracker's eye: the silhouette and aura come from it.

Use it for one, the other, or both at the same time. Several phones can
connect; each one is listed by the name typed on its page.

## Setup (once per venue)

1. **Network.** Everything must share one Wi-Fi. If the venue has none, make
   a hotspot on a phone and join the laptop to it (the hotspot phone can be
   one of the cameras: it reaches its own clients). Internet is not needed.
2. **Laptop.** Two terminals:
   ```sh
   npm run dev      # the visuals, http://localhost:5274
   npm run phone    # the phone link, prints https://<laptop-ip>:5276/
   ```
   The first run creates a self-signed certificate in `tools/phone-cam/.cert/`
   (needs `openssl`, present on every Mac).
3. **Phone.** On the visuals page press `q` (or the «móvil» button) and scan
   the QR, or type the printed address. The first time the browser warns
   about the certificate. Two ways past it:
   - *Quick:* Chrome/Brave → *Advanced → Proceed*; Safari → *Show details →
     visit this website*. Some browsers (Arc) offer no such button.
   - *Clean, once per phone:* install the local certificate authority. Open
     the «¿El navegador avisa…?» fold on the phone page and tap
     *certificado* (it is `/ca.crt`). Android: Settings → Security →
     Encryption & credentials → Install a certificate → CA certificate → pick
     the file; the "network may be monitored" notice is normal. iPhone: allow
     the profile download → Settings → Profile Downloaded → Install → then
     Settings → General → About → Certificate Trust Settings → enable
     *video-visuals phone-cam CA*. After this no browser warns, Arc included.
     The CA lives in `tools/phone-cam/.cert/` and never changes; the server
     re-issues its own certificate whenever the laptop's LAN address changes.
4. On the phone page type a name, pick the quality, press
   **enviar cámara** and allow the camera. The camera starts at its widest
   zoom; a **zoom** slider appears when the phone exposes a zoom range (below
   1x = ultra-wide lens). iPhones that list the ultra-wide lens as a separate
   camera get a **gran angular** button instead. The status line shows
   `1/1 pantallas · 1280×720 @30` when the link is up. Hold the phone
   **landscape**: the image is cropped to fill the canvas, never stretched,
   so a portrait stream loses its top and bottom.
5. On the laptop the phone is now in both selectors. The status line at the
   bottom of the panel reads `móvil N` = phones connected.

The phone keeps its identity across reloads, so a saved preset that uses it
as source finds it again. If the link drops, the selected phone stays selected
(marked *desconectado*) and resumes when it comes back.

## On stage

- The **square pad** under the buttons sends two macros to every screen:
  left-right is **palette**, up-down is **sat**. It works with or without the
  camera running, so a phone can be a pure controller. The panel sliders
  follow it, and the knob follows the screen: it shows the current values on
  connect and moves when a slider, MIDI, a preset or another phone changes
  them, so a touch never jumps. The page also asks the phone not to sleep.
- Keep the page in the foreground. Both platforms cut the camera when the
  browser goes to the background or the screen locks.
- Latency on a LAN is about 100-250 ms. Fine for the aura, which is flow-smeared
  anyway; noticeable if you expect a mirror.
- Battery: 720p at 30 fps for an hour is normal use. Plug the phone in if the
  set is long.

## Why HTTPS and a second server

Browsers only expose the camera on secure origins. `localhost` counts, so the
visuals page runs on plain http and keeps talking `ws://` to the granulizer
bridge on the music machine. The phone opens the laptop by IP, which is not
`localhost`, so its page must be https. `tools/phone-cam/server.mjs` serves
that page and relays the WebRTC signaling; it answers http and https on the
same port so the visuals page connects to it without trusting the certificate.
Video never passes through the server.

## Troubleshooting

| symptom | try |
|---|---|
| `móvil off` on the panel | `npm run phone` is not running, or the page was opened with `?phone=` pointing elsewhere |
| QR says *sin red* | the laptop has no LAN address: join the Wi-Fi / hotspot |
| phone: *página web no disponible* | the phone cannot reach the URL under the QR: both devices on the same Wi-Fi? Some venue/office networks isolate clients; use the phone hotspot instead |
| phone: *cámara no disponible … (usa https://)* | the page was opened over http by IP; use the https address |
| phone: *0/1 pantallas* for more than ~10 s | the two devices cannot reach each other directly (client isolation on the venue Wi-Fi). Use a phone hotspot instead |
| phone connected, black image on the laptop | phone page in the background or screen locked; bring it forward |
| only the middle of the picture shows | phone held in portrait: it is cropped to fill the canvas |
| choppy | drop quality to 360p on the phone; check `?res=0.5` for the visuals |

## Other cameras

The same selectors list every camera macOS knows: the built-in one, any USB
webcam, an iPhone via Continuity Camera (same Apple ID as the Mac), OBS's
virtual camera. Android 14+ phones can also act as a USB webcam over a cable
(*USB preferences → Webcam*): wired, no network, but no walking around.
